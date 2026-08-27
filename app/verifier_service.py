"""
Shared verification service for the RocketRide Hackathon Usage Verifier web app.

  Pipeline A  (LOCAL  · fast · reliable)   rb.fetch_signals(url)  -> evidence digest
  Pipeline B  (CLOUD · RocketRide)          verify_usage.pipe (chat -> llm_anthropic -> answer)

The app reuses the proven logic in run_batch.py (fetch, rubric, JSON parsing, Excel
styling) so the web app and the CLI can never drift. Nothing here modifies run_batch.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

# make the project root + eval/ importable so `import run_batch` / `import engine` work from app/
PROJECT_ROOT = Path(__file__).resolve().parent.parent
for _p in (PROJECT_ROOT, PROJECT_ROOT / "eval"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import run_batch as rb  # noqa: E402  fetch_signals, extract_json, write_sheet, ...
import engine  # noqa: E402  DETERMINISTIC evaluator: gather() + evaluate() -> tag/backbone/score/table
from rocketride import RocketRideClient  # noqa: E402
from rocketride.schema import Question  # noqa: E402

PIPELINE_B = str(PROJECT_ROOT / "verify_usage.pipe")

# The verdict (tag + backbone) is decided DETERMINISTICALLY by engine.evaluate(); the cloud LLM's
# only remaining job is to put that verdict into plain English. The prompt + prose parsing + evidence
# formatting all live in engine.py, so the app and the CLI (run_batch.verify_one) can never drift.


# ---- robust verdict extraction ------------------------------------------------
# The cloud canvas classifier can wrap the JSON in a prose analysis. A naive
# "first { to last }" grab breaks when the prose itself contains braces, so we
# scan every balanced top-level object and keep the LAST one that looks like a
# verdict (has a `tag`). Falls back to run_batch's simpler extractor.

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


def extract_verdict(text: str) -> dict:
    best: dict = {}
    for cand in _iter_json_objects(text or ""):
        try:
            obj = json.loads(cand)
        except Exception:
            continue
        if isinstance(obj, dict) and ("tag" in obj or "repo_accessible" in obj):
            best = obj                      # keep the last verdict-shaped object
    return best or rb.extract_json(text or "")


# ---- Pipeline B: the cloud classifier, held open for the app's lifetime --------

class ClassifierPool:
    """Keeps one RocketRide Cloud pipeline instance live and classifies digests on it.

    A web app can't afford to connect + use() per request, so we open the pipeline
    once and reuse the token, rebuilding transparently if the socket/token dies.
    """

    def __init__(self, pipe_path: str = PIPELINE_B, max_concurrency: int = 3):
        self.pipe_path = pipe_path
        self._client: RocketRideClient | None = None
        self._token: str | None = None
        self._lock = asyncio.Lock()                  # guards (re)connect
        self._sem = asyncio.Semaphore(max_concurrency)

    async def start(self) -> None:
        async with self._lock:
            await self._connect_locked()

    async def _connect_locked(self) -> None:
        if self._client is not None and self._token:
            return
        client = RocketRideClient()
        await client.connect()
        result = await client.use(filepath=self.pipe_path, use_existing=True)
        self._client, self._token = client, result["token"]

    async def _reset(self) -> None:
        async with self._lock:
            client, token = self._client, self._token
            self._client, self._token = None, None
        if client is not None:
            try:
                if token:
                    await client.terminate(token)
            except Exception:
                pass
            try:
                await client.disconnect()
            except Exception:
                pass

    async def explain(self, evaluation: dict, project: str, repo: str, feedback: str,
                      readme_head: str = "", target_name: str = "RocketRide") -> dict:
        """Put the DETERMINISTIC verdict into plain English for a judge. Returns prose only
        (description / rocketride_usage / justification, plus README-stated project_name /
        team_members) - it never sets the tag/backbone. Returns {"explain_failed": True} if the
        cloud classifier can't be reached; the verdict still stands."""
        prompt = engine.explain_prompt(evaluation, project, repo, feedback, readme_head,
                                       target_name=target_name)
        async with self._sem:
            parsed: dict = {}
            for attempt in range(3):
                if attempt:
                    await asyncio.sleep(1.0 * attempt)
                try:
                    async with self._lock:
                        await self._connect_locked()
                        client, token = self._client, self._token
                    q = Question()
                    q.addQuestion(prompt if attempt == 0 else
                                  prompt + "\n\nREMINDER: reply with ONLY the strict JSON object.")
                    resp = await asyncio.wait_for(client.chat(token=token, question=q), timeout=90)
                except asyncio.TimeoutError:
                    continue                       # classifier hung - retry
                except Exception:
                    await self._reset()            # socket/token died - rebuild next attempt
                    continue
                answers = resp.get("answers", []) if isinstance(resp, dict) else []
                parsed = engine.extract_prose(answers[0] if answers else "")
                if parsed:
                    break
        if not parsed:
            return {"explain_failed": True}
        return {k: parsed.get(k, "") for k in ("description", "rocketride_usage", "justification",
                                               "project_name", "team_members")}

    async def ask(self, prompt: str, timeout: int = 60) -> str:
        """One-shot generic question to the cloud pipeline (e.g. the sheet-brain column mapping).
        Returns the raw answer text, or '' if the cloud is unreachable."""
        async with self._sem:
            for attempt in range(2):
                if attempt:
                    await asyncio.sleep(1.0)
                try:
                    async with self._lock:
                        await self._connect_locked()
                        client, token = self._client, self._token
                    q = Question()
                    q.addQuestion(prompt)
                    resp = await asyncio.wait_for(client.chat(token=token, question=q), timeout=timeout)
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    await self._reset()
                    continue
                answers = resp.get("answers", []) if isinstance(resp, dict) else []
                if answers:
                    return answers[0]
        return ""

    async def aclose(self) -> None:
        await self._reset()


# ---- Pipeline A + short-circuits (mirror run_batch.verify_one, split into stages) ----

# deterministic default fields carried by every result (so UI + Excel never see a missing key)
_ZERO = {"score": 0.0, "pipelines": [], "breakdown": [], "pipelines_called": 0,
         "pipelines_total": 0, "other_platforms": [], "explain_failed": False,
         "classify_failed": False, "event_window": None, "reused_pipelines": [],
         "project_predates": None, "history_tampered": [], "earliest_commit": "",
         "repo_created_at": "", "history_penalty": None, "platform": {}, "tech": []}


def _no_repo(row: dict, tname: str = "RocketRide") -> dict:
    return {**row, **_ZERO, "repo_accessible": False, "description": "", "rocketride_usage": "",
            "tag": "None", "backbone": "No",
            "notes": "No GitHub repo provided - flag for correction; scored as ZERO",
            "justification": f"No GitHub repository was provided in the submission, so {tname} "
            "usage cannot be verified from code - classified None / No and flagged for correction "
            "(score zero).", "evidence": []}


def _inaccessible(row: dict, sig: dict, tname: str = "RocketRide") -> dict:
    return {**row, **_ZERO, "repo_accessible": False, "description": "", "rocketride_usage": "",
            "tag": "None", "backbone": "No",
            "notes": f"INACCESSIBLE (HTTP {sig.get('status', '?')}) - flag for correction: "
            "double-check the repo URL; scored as ZERO",
            "justification": f"The repository could not be accessed (HTTP {sig.get('status', '?')}), "
            f"so {tname} usage cannot be verified from code - classified None / No and flagged "
            "for correction (score zero).", "evidence": []}


def _incomplete(row: dict, sig: dict) -> dict:
    return {**row, **_ZERO, "repo_accessible": None, "description": "", "rocketride_usage": "",
            "tag": "None", "backbone": "No",
            "notes": f"Evidence fetch incomplete ({sig.get('note', '')}) - resubmit this row",
            "justification": "Evidence gathering was incomplete this run, so classification was "
            "deferred - resubmit this row.", "evidence": []}


def _eval_summary(ev: dict) -> dict:
    """Compact slice of the deterministic evaluation for the UI's local->cloud hand-off panel."""
    return {
        "score": ev.get("score"), "tag": ev.get("tag"), "backbone": ev.get("backbone"),
        "pipelines_called": ev.get("pipelines_called"), "pipelines_total": ev.get("pipelines_total"),
        "pipelines": [{"name": p["name"], "nodes": p["nodes"], "called": p["called"]}
                      for p in ev.get("pipelines", [])][:8],
        "sdk": ev.get("sdk", {}), "other_platforms": ev.get("other_platforms", []),
    }


async def verify_row(row: dict, pool: ClassifierPool, event_date: str | None = None,
                     history_penalty: float | None = None,
                     target: "engine.Target | None" = None):
    """Async generator: yields ('stage', {...}) events then a final ('result', {...}).

    Stage A (fetch + measure) runs the DETERMINISTIC engine off the event loop - it gathers the repo
    and computes the verdict (tag/backbone/score + the ground-truth pipeline table, plus the
    commit-freshness check when `event_date` is given). Stage B asks the RocketRide Cloud pipeline
    only to EXPLAIN that verdict in prose. The verdict never depends on the LLM, so a slow/offline
    classifier degrades to a missing explanation, not a wrong tag."""
    started = time.perf_counter()
    url = row.get("github", "")
    # Live mode submits only a URL; fall back to the repo name so cards/detail/Excel aren't "(unnamed)"
    label_from_repo = bool(row.get("_label_from_repo"))
    if not (row.get("project") or "").strip():
        pr = rb.parse_repo(url)
        if pr:
            row = {**row, "project": pr[1]}
            label_from_repo = True
    project = row.get("project", "") or "(unnamed)"

    tname = target.name if target else "RocketRide"
    if rb.repo_missing(url):
        yield "result", {**_no_repo(row, tname), "seconds": 0.0}
        return

    yield "stage", {"stage": "fetch", "engine": "local", "project": project,
                    "message": f"Gathering code + measuring {tname} usage - local Pipeline A"}
    evidence = await asyncio.to_thread(engine.gather, url, rb._gh, event_date, history_penalty,
                                       target)

    if not evidence.get("accessible"):
        yield "result", {**_inaccessible(row, evidence, tname), "seconds": round(time.perf_counter() - started, 1)}
        return
    if evidence.get("fetch_incomplete"):
        yield "result", {**_incomplete(row, evidence), "seconds": round(time.perf_counter() - started, 1)}
        return

    # a repo-slug label upgrades to the README's own title (sheet-provided names are never touched;
    # a title that's just the slug re-spelled is skipped so owner-suffixed duplicates stay distinct)
    pr = rb.parse_repo(url)
    repo_name = pr[1] if pr else ""
    if label_from_repo and rb.title_upgrades(repo_name, evidence.get("readme_title", "")):
        project = evidence["readme_title"][:80]
        row = {**row, "project": project}

    # DETERMINISTIC verdict (no LLM): tag, backbone, score, and the ground-truth pipeline table
    ev = engine.evaluate(evidence, target)

    yield "stage", {"stage": "classify", "engine": "cloud", "project": project,
                    "message": "Explaining the verdict on RocketRide Cloud - Pipeline B",
                    "digest": _eval_summary(ev)}
    prose = await pool.explain(ev, project, url, row.get("feedback", ""),
                               readme_head=evidence.get("readme_head", ""),
                               target_name=tname)
    explain_failed = bool(prose.get("explain_failed"))

    # README-stated names beat a repo-slug label / an empty team column (never a sheet-given value)
    if label_from_repo and rb.title_upgrades(repo_name, str(prose.get("project_name") or "")):
        project = str(prose["project_name"])[:80]
        row = {**row, "project": project}
    if not (row.get("names") or "").strip() and prose.get("team_members"):
        row = {**row, "names": str(prose["team_members"])[:200]}

    note = engine.det_note(ev)
    yield "result", {
        **row,
        "repo_accessible": True, "classify_failed": False,       # the verdict never fails now
        "tag": ev["tag"], "backbone": ev["backbone"], "score": ev["score"],
        "pipelines": ev["pipelines"], "breakdown": ev["breakdown"],
        "pipelines_called": ev["pipelines_called"], "pipelines_total": ev["pipelines_total"],
        "other_platforms": ev["other_platforms"], "explain_failed": explain_failed,
        "event_window": ev.get("event_window"), "reused_pipelines": ev.get("reused_pipelines", []),
        "project_predates": ev.get("project_predates"), "history_tampered": ev.get("history_tampered", []),
        "earliest_commit": ev.get("earliest_commit", ""), "repo_created_at": ev.get("repo_created_at", ""),
        "history_penalty": ev.get("history_penalty"),
        "platform": ev.get("platform") or {}, "target_name": tname,
        "tech": ev.get("tech", []),
        "description": prose.get("description", ""),
        "rocketride_usage": prose.get("rocketride_usage", ""),
        "justification": (prose.get("justification", "") if not explain_failed
                          else f"{note} (Plain-English explanation unavailable this run - the "
                               "deterministic verdict stands; see the evidence table.)"),
        "notes": note + (" [explanation pending - cloud classifier unreachable]" if explain_failed else ""),
        "evidence": engine.evidence_lines(ev),
        "seconds": round(time.perf_counter() - started, 1),
        "kb_processed": round(sum(len(f.get("text") or "") for f in
                                  (evidence.get("source_files") or [])) / 1024, 1),
    }


# ---- Excel export (reuse run_batch styling verbatim) ---------------------------

def build_excel(results: list, out_path: str) -> None:
    rb.write_sheet(results, out_path)
