"""
FastAPI app — RocketRide Hackathon Usage Verifier.

Two modes (both stream NDJSON progress so the UI can show the local -> cloud hand-off):
  • Live   POST /api/verify/stream   {repos:[{github,...}]}     -> per-repo verdict cards
  • Batch  POST /api/batch           (CSV/XLSX upload)          -> full run + Excel download

Run locally (from the project folder):
  uvicorn app.main:app --reload
"""
from __future__ import annotations

import asyncio
import json
import tempfile
import uuid
from collections import Counter
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# load creds from the project-root .env BEFORE importing the service (GitHub + RocketRide)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

from .verifier_service import ClassifierPool, verify_row  # noqa: E402
import run_batch as rb  # noqa: E402  (project root is on sys.path via verifier_service)

STATIC = Path(__file__).resolve().parent / "static"
BATCH_CONCURRENCY = 4                    # how many repos to verify at once
pool = ClassifierPool(max_concurrency=BATCH_CONCURRENCY)


@asynccontextmanager
async def lifespan(app: FastAPI):
    rb.GH_TOKEN = rb.github_token()      # authenticate GitHub fetches (Pipeline A)
    try:
        await pool.start()               # open the cloud classifier (Pipeline B)
    except Exception as e:               # noqa: BLE001 — don't block startup if cloud is down
        print(f"[warn] classifier not reachable at startup: {e} (will retry per request)")
    yield
    await pool.aclose()


app = FastAPI(title="RocketRide Hackathon Usage Verifier", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")   # serves the branding bg image


class Repo(BaseModel):
    project: str | None = ""
    github: str
    feedback: str | None = ""
    demo: str | None = ""
    deployed: str | None = ""


class VerifyRequest(BaseModel):
    repos: list[Repo]
    event_date: str | None = None      # hackathon date (YYYY-MM-DD) → commit-freshness check
    history_penalty: float | None = None  # judge-set deduction for predates/tamper flags (0 = flag only)


def _ndjson(obj: dict) -> bytes:
    return (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")


_LAYER_KEYS = ("ingest", "retrieval", "orchestration", "reasoning", "output")
_LAYER_VALUES = {"rocketride", "other", "none"}


def _layers_from_backbone(backbone) -> dict:
    """Fallback layer map when the classifier didn't emit one — keep the load-bearing
    spine consistent with the backbone verdict so the UI tower never lies."""
    bb = backbone.strip().lower() if isinstance(backbone, str) else ""
    if bb == "yes":
        orch, reason = "rocketride", "rocketride"
    elif bb == "partial":
        orch, reason = "rocketride", "other"          # one load-bearing pillar
    else:
        orch, reason = "none", "none"
    return {"ingest": "none", "retrieval": "none",
            "orchestration": orch, "reasoning": reason, "output": "none"}


def _layers(r: dict) -> dict:
    """Normalise the classifier's layer map to exactly 5 keys / 3 values, falling back to a
    backbone-derived spine for any missing or invalid value."""
    raw = r.get("layers")
    derived = _layers_from_backbone(r.get("backbone"))
    if not isinstance(raw, dict):
        return derived
    return {k: (v if (v := str(raw.get(k, "")).strip().lower()) in _LAYER_VALUES else derived[k])
            for k in _LAYER_KEYS}


def _public(r: dict) -> dict:
    """Trim a result to the fields the UI renders (all snake_case, matching the wire)."""
    out = {k: r.get(k) for k in (
        "project", "github", "tag", "backbone", "description", "rocketride_usage",
        "justification", "notes", "evidence", "seconds", "demo", "deployed",
        "names", "emails", "repo_accessible", "classify_failed",
        # deterministic evaluation payload (ground-truth table + score + freshness/integrity)
        "score", "pipelines", "breakdown", "pipelines_called", "pipelines_total",
        "other_platforms", "explain_failed", "event_window", "reused_pipelines",
        "project_predates", "history_tampered", "earliest_commit", "repo_created_at",
        "history_penalty")}
    out["layers"] = _layers(r)
    return out


def _summary(results: list) -> dict:
    return {"tags": dict(Counter(r.get("tag", "?") for r in results)),
            "backbone": dict(Counter(r.get("backbone", "?") for r in results))}


async def _run_stream(rows: list[dict], concurrency: int = BATCH_CONCURRENCY,
                      event_date: str | None = None, history_penalty: float | None = None):
    """Shared NDJSON generator for live + batch. Repos are verified CONCURRENTLY (up to
    `concurrency` at a time); each verify_row's stage/result events are merged into one output
    stream via a queue, so a large batch finishes ~concurrency-times faster than one-at-a-time.
    The Excel is NOT built here — the browser builds it on demand via /api/export."""
    total = len(rows)
    yield _ndjson({"event": "start", "total": total})
    results: list[dict] = []
    q: asyncio.Queue = asyncio.Queue()
    sem = asyncio.Semaphore(max(1, concurrency))

    async def worker(i: int, row: dict):
        try:
            async with sem:
                async for kind, payload in verify_row(row, pool, event_date, history_penalty):
                    await q.put((kind, i, payload))
        except Exception as e:  # noqa: BLE001 — surface a failed row rather than hang the batch
            await q.put(("result", i, {**row, "repo_accessible": True, "classify_failed": True,
                         "tag": "None", "backbone": "No", "description": "", "rocketride_usage": "",
                         "notes": f"worker error: {e}", "evidence": [], "seconds": 0.0}))
        finally:
            await q.put(("__endrow__", i, None))

    tasks = [asyncio.create_task(worker(i, row)) for i, row in enumerate(rows, 1)]
    remaining = total
    while remaining:
        kind, i, payload = await q.get()
        if kind == "__endrow__":
            remaining -= 1
        elif kind == "stage":
            yield _ndjson({"event": "stage", "index": i, **payload})
        else:
            results.append(payload)
            yield _ndjson({"event": "result", "index": i, "total": total, "result": _public(payload)})
    await asyncio.gather(*tasks, return_exceptions=True)
    yield _ndjson({"event": "done", "count": len(results), "summary": _summary(results)})


@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.post("/api/verify/stream")
async def verify_stream(req: VerifyRequest):
    rows = [{"project": r.project or "", "github": r.github, "feedback": r.feedback or "",
             "demo": r.demo or "", "deployed": r.deployed or ""} for r in req.repos]
    rb.fill_project_labels(rows)
    return StreamingResponse(_run_stream(rows, event_date=req.event_date,
                                         history_penalty=req.history_penalty),
                             media_type="application/x-ndjson")


@app.post("/api/batch")
async def batch(file: UploadFile = File(...), event_date: str | None = Form(None),
                history_penalty: float | None = Form(None)):
    suffix = Path(file.filename or "upload.csv").suffix or ".csv"
    tmp = Path(tempfile.gettempdir()) / f"rr_upload_{uuid.uuid4().hex[:8]}{suffix}"
    tmp.write_bytes(await file.read())
    try:
        raw = rb.read_raw(str(tmp))
    except SystemExit as e:                 # unreadable / unsupported file
        raise HTTPException(400, f"Could not read submissions file: {e}")
    header_row, idx = rb.locate_columns(raw)
    if header_row is not None:
        rows = rb.build_rows(raw, header_row, idx)
    else:
        # deterministic detection failed → the LLM "sheet brain" maps the columns from the data
        # patterns, and its answer is verified deterministically before any row is used.
        answer = await pool.ask(rb.llm_mapping_prompt(raw))
        rows = rb.apply_llm_mapping(raw, answer)
        if rows is None:
            raise HTTPException(400, f"Could not read submissions file: {rb._no_columns_error(raw)} "
                                     "(LLM column mapping also failed to find a GitHub column.)")
    if not rows:
        raise HTTPException(400, "No rows found in the uploaded file.")
    rb.fill_project_labels(rows)
    return StreamingResponse(_run_stream(rows, event_date=event_date,
                                         history_penalty=history_penalty),
                             media_type="application/x-ndjson")


class ExportRequest(BaseModel):
    results: list[dict]


@app.post("/api/export")
async def export(req: ExportRequest):
    """Build the styled Excel on demand from the results the browser already holds — stateless,
    so it works regardless of instance restarts (there's no server-side job to expire)."""
    results = req.results
    if not results:
        raise HTTPException(400, "No results to export.")
    rb.mark_duplicates(results)
    buf = BytesIO()
    rb.write_sheet(results, buf)          # openpyxl writes the workbook into the in-memory buffer
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="RocketRide_Hackathon_Usage.xlsx"'})


@app.get("/api/health")
async def health():
    return {"ok": True, "classifier_ready": pool._token is not None}  # noqa: SLF001
