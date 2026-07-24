"""Deterministic RocketRide-usage evaluation engine.

Measures usage from a repo's CODE (parsed `.pipe` files + source scan), scores it against the
approved weights (SCORING_SPEC.md), and derives Tag + Backbone deterministically — no LLM. The
LLM (elsewhere) only writes the human-readable prose from this evaluation.

Split into:
  • pure functions  — parse_pipe / sdk_metrics / pipe_called / evaluate  (network-free, unit-tested)
  • gather(url, gh) — fetches the repo (given a `gh(url)->(status, text)` fetcher) into `evidence`
"""
from __future__ import annotations

import json
import re

# ---------------------------------------------------------------- approved weights (SCORING_SPEC.md)
W = {
    "dependency":       1.0,   # C1  rocketride in a manifest
    "pipeline_called":  2.0,   # B1  per pipeline proven to be called
    "agent_node":       1.0,   # A3  a called pipeline contains an agent_* node
    "complexity_mid":   0.5,   # A2  called pipeline has 4–8 nodes
    "complexity_high":  1.0,   # A2  called pipeline has 9+ nodes
    "tool_or_llm":      0.5,   # A4  called pipeline has a tool_* or llm_* node
    "hosted":           1.0,   # C4  hosted-pipeline usage (id/env + adapter)
    "sdk_callsites":    0.5,   # C2  >=3 SDK call-sites
    "file_spread":      0.5,   # C3  >=2 distinct files use RocketRide
    "uncalled_penalty": 1.0,   # B2  per pipeline present but NEVER called
}
THRESHOLDS = {"significant": 4.0, "moderate": 2.0, "less": 1.0}

_SDK_CALL = re.compile(r"\b(RocketRideClient|client\.use|client\.chat|client\.send|client\.connect)", re.I)
_MANIFEST = re.compile(r"(^|/)(package\.json|requirements\.txt|pyproject\.toml)$")
_SRC_EXT = re.compile(r"\.(ts|tsx|js|jsx|py|mjs)$")
_SRC_HINT = re.compile(r"rocket|pipeline|integration|agent|engine|config|api|route|server|main|index|app|relay|deploy", re.I)


# ---------------------------------------------------------------- pure detectors
def parse_pipe(text: str) -> dict | None:
    """Node metrics for one .pipe JSON. None if unparseable."""
    try:
        d = json.loads(text)
    except Exception:
        return None
    comps = d.get("components", []) or []
    providers = [str(c.get("provider", "")) for c in comps]
    return {
        "nodes": len(comps),
        "providers": providers,
        "has_agent": any(p.startswith("agent_") for p in providers),
        "has_llm": any(p.startswith("llm_") for p in providers),
        "tool_count": sum(p.startswith("tool_") for p in providers),
        "project_id": d.get("project_id") or "",
    }


def complexity_band(nodes: int) -> str:
    return "high" if nodes >= 9 else "medium" if nodes >= 4 else "low"


def pipe_called(pipe_path: str, source_files: list) -> tuple:
    """A pipeline is 'called' when a source file references its filename AND invokes the SDK
    (client.use/send/chat) — i.e. it's loaded and driven, not just sitting in the repo.
    Returns (called: bool, call_sites: [{file,line,snippet}])."""
    base = pipe_path.rsplit("/", 1)[-1].lower()
    for f in source_files:
        low = f["text"].lower()
        if base in low and any(k in low for k in ("client.use", "client.send", "client.chat")):
            sites = []
            for i, line in enumerate(f["text"].splitlines(), 1):
                ll = line.lower()
                if base in ll or "client.use" in ll or "client.send" in ll or "client.chat" in ll:
                    sites.append({"file": f["path"], "line": i, "snippet": line.strip()[:110]})
            return True, sites[:6]
    return False, []


def sdk_metrics(source_files: list) -> dict:
    """Deterministic SDK-depth metrics across the fetched source."""
    callsites = files_using = 0
    hosted = engine = False
    for f in source_files:
        t, low = f["text"], f["text"].lower()
        n = len(_SDK_CALL.findall(t))
        callsites += n
        if n or "from rocketride" in low or "import rocketride" in low or "@rocketride" in low:
            files_using += 1
        if "rocketride_pipeline" in low or "rocketride_api_key" in low or "lib/rocketride" in low:
            hosted = True
        if "ws://localhost:5565" in low or "/v1/pipelines" in low:
            engine = True
    return {"callsites": callsites, "file_spread": files_using, "hosted": hosted, "engine": engine}


# ---------------------------------------------------------------- backbone + tag (deterministic)
_AI_COMPETITORS = {"langchain", "crewai"}          # a competing AI runtime demotes to Partial
# butterbase/supabase/firebase/pinecone/etc. are data/gateway — they do NOT demote


def _backbone(pipelines: list, sdk: dict, evidence: dict) -> str:
    runs_orchestration = any(p["called"] and (p.get("has_agent") or p.get("has_llm"))
                             for p in pipelines)
    real = runs_orchestration or sdk["hosted"] or sdk["engine"]
    if not real:
        return "No"
    if any(o in _AI_COMPETITORS for o in evidence.get("other_platforms", [])):
        return "Partial"
    return "Yes"


def _tag(score: float, backbone: str, called: int, evidence: dict) -> str:
    if evidence.get("overclaim") or not evidence.get("accessible", True):
        return "None"
    if evidence.get("scaffold_only") and called == 0:
        return "Less"                                        # D1 cap: scaffold/branding only
    if score >= THRESHOLDS["significant"]:
        return "Significant" if backbone in ("Yes", "Partial") else "Moderate"   # gate
    if score >= THRESHOLDS["moderate"]:
        return "Moderate"
    if score >= THRESHOLDS["less"]:
        return "Less"
    return "None"


def evaluate(evidence: dict) -> dict:
    """Score the gathered evidence → deterministic Tag / Backbone / ground-truth table."""
    if not evidence.get("accessible"):
        return {"tag": "None", "backbone": "No", "score": 0.0, "pipelines": [], "sdk": {},
                "breakdown": [], "pipelines_called": 0, "reason": "inaccessible"}

    breakdown, score = [], 0.0

    def add(label, pts):
        nonlocal score
        score += pts
        breakdown.append({"signal": label, "points": pts})

    if evidence.get("dependency"):
        add("dependency in manifest", W["dependency"])

    pipelines, called = [], 0
    for p in evidence.get("pipes", []):
        m = p.get("metrics")
        nodes = m["nodes"] if m else 0
        entry = {"name": p["path"], "nodes": nodes,
                 "complexity": complexity_band(nodes),
                 "has_agent": bool(m and m["has_agent"]),
                 "has_llm": bool(m and m["has_llm"]),
                 "providers": (m["providers"] if m else []),
                 "called": p.get("called", False),
                 "call_sites": p.get("call_sites", [])}
        pipelines.append(entry)
        if entry["called"]:
            called += 1
            add(f"pipeline called: {entry['name']}", W["pipeline_called"])
            if entry["has_agent"]:
                add(f"agent node in {entry['name']}", W["agent_node"])
            if nodes >= 9:
                add(f"complexity high ({nodes} nodes)", W["complexity_high"])
            elif nodes >= 4:
                add(f"complexity mid ({nodes} nodes)", W["complexity_mid"])
            if m and (m["has_llm"] or m["tool_count"]):
                add(f"tool/llm node in {entry['name']}", W["tool_or_llm"])
        else:
            add(f"PENALTY pipeline never called: {entry['name']}", -W["uncalled_penalty"])

    sdk = evidence.get("sdk", {"callsites": 0, "file_spread": 0, "hosted": False, "engine": False})
    if sdk.get("hosted"):
        add("hosted-pipeline usage", W["hosted"])
    if sdk.get("callsites", 0) >= 3:
        add(f"SDK call-sites ({sdk['callsites']})", W["sdk_callsites"])
    if sdk.get("file_spread", 0) >= 2:
        add(f"SDK spread ({sdk['file_spread']} files)", W["file_spread"])

    score = max(0.0, round(score, 1))
    backbone = _backbone(pipelines, sdk, evidence)
    tag = _tag(score, backbone, called, evidence)
    return {"tag": tag, "backbone": backbone, "score": score, "pipelines": pipelines, "sdk": sdk,
            "breakdown": breakdown, "pipelines_called": called,
            "pipelines_total": len(pipelines), "other_platforms": evidence.get("other_platforms", [])}


# default deterministic-eval fields for short-circuit rows (no repo / inaccessible), so the UI +
# Excel never see a missing key. Kept here so the app and the CLI use the exact same shape.
ZERO_EVAL = {"score": 0.0, "pipelines": [], "breakdown": [], "pipelines_called": 0,
             "pipelines_total": 0, "other_platforms": []}


# ---------------------------------------------------------------- LLM prose helpers (shared: app + CLI)
# The verdict is deterministic (evaluate()); the cloud LLM's ONLY job is to explain it in plain
# English. These helpers build that prompt and parse the reply, so app and CLI never diverge.
EXPLAIN_PROMPT = """You are documenting how a hackathon project used RocketRide, for a judge.

The VERDICT has ALREADY been decided deterministically from the project's actual code — you must NOT
change it. Your only job is to explain it in plain English, grounded entirely in the evidence table
you are given (pipelines, their node counts, and whether each is actually CALLED in the code, with
call sites).

Return ONLY a strict JSON object — start with { and end with }, no prose outside it:
{
  "description": "<1-2 sentences: what the project does>",
  "rocketride_usage": "<1-2 sentences: concretely how it uses RocketRide — name the pipeline(s), the
                        node count, and whether/where they are called; ground every claim in the table>",
  "justification": "<2-3 sentences: why the code earns THIS tag and backbone, citing the table (e.g.
                     'the 7-node agent pipeline is loaded and run at relay.ts:83'). If a pipeline is
                     present but never called, say so explicitly.>"
}
Rules: cite ONLY what is in the evidence. Never contradict the verdict. If the tag is None, state that
the code shows no real RocketRide usage."""


def _iter_json_objects(text: str):
    depth, start = 0, None
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                yield text[start:i + 1]
                start = None


def extract_prose(text: str) -> dict:
    """Pull the {description, rocketride_usage, justification} object out of the LLM reply, tolerating
    any wrapping analysis. The verdict is NOT here — that's decided deterministically."""
    best: dict = {}
    for cand in _iter_json_objects(text or ""):
        try:
            obj = json.loads(cand)
        except Exception:
            continue
        if isinstance(obj, dict) and any(k in obj for k in ("description", "rocketride_usage", "justification")):
            best = obj
    return best


def explain_prompt(evaluation: dict, project: str, repo: str, feedback: str) -> str:
    """Build the prose prompt: the deterministic verdict + the ground-truth table as fixed context."""
    payload = {
        "verdict": {"tag": evaluation["tag"], "backbone": evaluation["backbone"],
                    "score": evaluation["score"]},
        "score_breakdown": evaluation.get("breakdown", []),
        "pipelines": [{"name": p["name"], "nodes": p["nodes"], "complexity": p["complexity"],
                       "has_agent": p["has_agent"], "called": p["called"],
                       "call_sites": [f"{s['file']}:{s['line']}" for s in p.get("call_sites", [])]}
                      for p in evaluation.get("pipelines", [])],
        "sdk": evaluation.get("sdk", {}),
        "other_platforms": evaluation.get("other_platforms", []),
    }
    return (EXPLAIN_PROMPT
            + f"\n\nPROJECT: {project}\nREPO: {repo}\n"
            + "TEAM FEEDBACK (context only — the verdict is already fixed from code): "
            + f"{feedback or '(none provided)'}\n\nDETERMINISTIC EVALUATION (do not change the verdict):\n"
            + json.dumps(payload, indent=2))


def evidence_lines(ev: dict) -> list:
    """Deterministic, judge-readable evidence bullets built straight from the metrics (no LLM)."""
    lines = []
    for p in ev.get("pipelines", []):
        where = "; ".join(f"{s['file']}:{s['line']}" for s in p.get("call_sites", [])[:3])
        status = (f"CALLED @ {where}" if p["called"] and where
                  else "CALLED" if p["called"] else "NOT called (present for show)")
        lines.append(f"{p['name']} — {p['nodes']} nodes ({p['complexity']}), "
                     f"{'agent' if p['has_agent'] else 'no agent'} — {status}")
    sdk = ev.get("sdk", {})
    lines.append(f"SDK: {sdk.get('callsites', 0)} call-site(s) across {sdk.get('file_spread', 0)} "
                 f"file(s)" + (", hosted/Cloud usage" if sdk.get("hosted") else ""))
    if ev.get("other_platforms"):
        lines.append("Other platforms in code: " + ", ".join(ev["other_platforms"]))
    return lines


def det_note(ev: dict) -> str:
    return (f"Deterministic score {ev['score']} -> {ev['tag']} / backbone {ev['backbone']}; "
            f"{ev['pipelines_called']}/{ev['pipelines_total']} pipeline(s) called.")


# ---------------------------------------------------------------- gather (network; `gh` injected)
def gather(url: str, gh) -> dict:
    """Fetch a repo into an `evidence` dict. `gh(url) -> (status, text)`."""
    import run_batch as rb  # lazy: reuse repo helpers/constants without a hard import cycle
    pr = rb.parse_repo(url)
    if not pr:
        return {"accessible": False, "note": "URL not parseable"}
    owner, repo = pr
    st, body = gh(f"https://api.github.com/repos/{owner}/{repo}")
    if st != 200:
        return {"accessible": False, "status": st}
    branch = json.loads(body).get("default_branch", "main")
    st, tbody = gh(f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1")
    if st != 200:
        return {"accessible": True, "fetch_incomplete": True, "note": f"tree fetch failed (HTTP {st})"}
    paths = [x.get("path", "") for x in json.loads(tbody).get("tree", [])]

    def raw(p):
        return gh(f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{p}")[1]

    pipes = [{"path": pp, "metrics": parse_pipe(raw(pp))}
             for pp in [p for p in paths if p.endswith(".pipe")][:12]]

    dependency, others = False, set()
    for mf in [p for p in paths if _MANIFEST.search(p)][:8]:
        txt = raw(mf)
        if re.search(r"rocketride|@rocketride/sdk", txt, re.I):
            dependency = True
        others.update(o for o in rb.OTHER_PLATFORMS if o in txt.lower())

    kw = [p for p in paths if _SRC_EXT.search(p) and _SRC_HINT.search(p)]
    rest = [p for p in paths if _SRC_EXT.search(p) and p not in kw]
    source_files = []
    for cf in (kw + rest)[:28]:
        txt = raw(cf)
        source_files.append({"path": cf, "text": txt})
        others.update(o for o in rb.OTHER_PLATFORMS if o in txt.lower())

    for pe in pipes:
        called, sites = pipe_called(pe["path"], source_files)
        pe["called"], pe["call_sites"] = called, sites

    scaffold = any(p.endswith(".claude/rules/rocketride.md") for p in paths)
    return {
        "accessible": True, "file_count": len(paths),
        "dependency": dependency, "pipes": pipes, "source_files": source_files,
        "other_platforms": sorted(others),
        "scaffold_only": scaffold and not (dependency or pipes),
        "sdk": sdk_metrics(source_files),
    }
