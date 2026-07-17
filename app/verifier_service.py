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

# make the project root importable so `import run_batch` works from inside app/
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import run_batch as rb  # noqa: E402  fetch_signals, RUBRIC, extract_json, write_sheet, ...
from rocketride import RocketRideClient  # noqa: E402
from rocketride.schema import Question  # noqa: E402

PIPELINE_B = str(PROJECT_ROOT / "verify_usage.pipe")


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

    async def classify(self, digest: dict, project: str, repo: str, feedback: str) -> dict:
        prompt = (
            rb.RUBRIC
            + f"\n\nPROJECT: {project}\nREPO: {repo}\n"
            + "TEAM FEEDBACK (may over/under-claim — trust the evidence over this): "
            + f"{feedback or '(none provided)'}\n\nCODE EVIDENCE (gathered from GitHub):\n"
            + json.dumps(digest, indent=2)
        )
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
                    # On retries, re-send the FULL prompt (evidence included) + a JSON-only nudge —
                    # a bare "re-emit" reprompt can't recover if the first attempt timed out.
                    q.addQuestion(
                        prompt if attempt == 0 else
                        prompt + "\n\nREMINDER: reply with ONLY the strict JSON object — "
                        "start with { and end with }, no prose."
                    )
                    resp = await asyncio.wait_for(client.chat(token=token, question=q), timeout=90)
                except asyncio.TimeoutError:
                    continue                       # classifier hung — retry
                except Exception:
                    await self._reset()            # socket/token died — rebuild next attempt
                    continue
                answers = resp.get("answers", []) if isinstance(resp, dict) else []
                parsed = extract_verdict(answers[0] if answers else "")
                if parsed:
                    break
        if not parsed:
            return {"repo_accessible": True, "classify_failed": True, "tag": "None",
                    "backbone": "No", "description": "", "rocketride_usage": "",
                    "notes": "classifier returned no parseable JSON — resubmit this row",
                    "justification": "The cloud classifier did not return valid JSON after "
                    "retries; resubmit this row.", "evidence": []}
        parsed.setdefault("evidence", [])
        return parsed

    async def aclose(self) -> None:
        await self._reset()


# ---- Pipeline A + short-circuits (mirror run_batch.verify_one, split into stages) ----

def _no_repo(row: dict) -> dict:
    return {**row, "repo_accessible": False, "description": "", "rocketride_usage": "",
            "tag": "None", "backbone": "No",
            "notes": "No GitHub repo provided — flag for correction; scored as ZERO",
            "justification": "No GitHub repository was provided in the submission, so RocketRide "
            "usage cannot be verified from code — classified None / No and flagged for correction "
            "(score zero).", "evidence": []}


def _inaccessible(row: dict, sig: dict) -> dict:
    return {**row, "repo_accessible": False, "description": "", "rocketride_usage": "",
            "tag": "None", "backbone": "No",
            "notes": f"INACCESSIBLE (HTTP {sig.get('status', '?')}) — flag for correction: "
            "double-check the repo URL; scored as ZERO",
            "justification": f"The repository could not be accessed (HTTP {sig.get('status', '?')}), "
            "so RocketRide usage cannot be verified from code — classified None / No and flagged "
            "for correction (score zero).", "evidence": []}


def _incomplete(row: dict, sig: dict) -> dict:
    return {**row, "repo_accessible": None, "description": "", "rocketride_usage": "",
            "tag": "None", "backbone": "No",
            "notes": f"Evidence fetch incomplete ({sig.get('note', '')}) — resubmit this row",
            "justification": "Evidence gathering was incomplete this run, so classification was "
            "deferred — resubmit this row.", "evidence": []}


def _digest_summary(sig: dict) -> dict:
    """Small, human-readable slice of the evidence digest for the UI hand-off panel."""
    return {
        "accessible": sig.get("accessible"),
        "file_count": sig.get("file_count"),
        "pipe_files": sig.get("pipe_files", []),
        "rocketride_dependencies": sig.get("rocketride_dependencies", []),
        "source_signals": sig.get("source_signals", [])[:8],
        "other_platforms": sig.get("other_platforms", []),
    }


async def verify_row(row: dict, pool: ClassifierPool):
    """Async generator: yields ('stage', {...}) events then a final ('result', {...}).

    Stage A (fetch) runs the local Python digest off the event loop; stage B (classify)
    runs on the RocketRide Cloud pipeline. This is the local -> cloud hand-off the demo shows.
    """
    started = time.perf_counter()
    url = row.get("github", "")
    # Live mode submits only a URL; fall back to the repo name so cards/detail/Excel aren't "(unnamed)"
    if not (row.get("project") or "").strip():
        pr = rb.parse_repo(url)
        if pr:
            row = {**row, "project": pr[1]}
    project = row.get("project", "") or "(unnamed)"

    if rb.repo_missing(url):
        yield "result", {**_no_repo(row), "seconds": 0.0}
        return

    yield "stage", {"stage": "fetch", "engine": "local", "project": project,
                    "message": "Fetching GitHub evidence — local Pipeline A"}
    sig = await asyncio.to_thread(rb.fetch_signals, url)

    if not sig.get("accessible"):
        yield "result", {**_inaccessible(row, sig), "seconds": round(time.perf_counter() - started, 1)}
        return
    if sig.get("fetch_incomplete"):
        yield "result", {**_incomplete(row, sig), "seconds": round(time.perf_counter() - started, 1)}
        return

    yield "stage", {"stage": "classify", "engine": "cloud", "project": project,
                    "message": "Classifying on RocketRide Cloud — Pipeline B",
                    "digest": _digest_summary(sig)}
    parsed = await pool.classify(sig, project, url, row.get("feedback", ""))
    yield "result", {**row, **parsed, "seconds": round(time.perf_counter() - started, 1)}


# ---- Excel export (reuse run_batch styling verbatim) ---------------------------

def build_excel(results: list, out_path: str) -> None:
    rb.write_sheet(results, out_path)
