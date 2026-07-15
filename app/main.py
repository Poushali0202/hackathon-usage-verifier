"""
FastAPI app — RocketRide Hackathon Usage Verifier.

Two modes (both stream NDJSON progress so the UI can show the local -> cloud hand-off):
  • Live   POST /api/verify/stream   {repos:[{github,...}]}     -> per-repo verdict cards
  • Batch  POST /api/batch           (CSV/XLSX upload)          -> full run + Excel download

Run locally (from the project folder):
  uvicorn app.main:app --reload
"""
from __future__ import annotations

import json
import tempfile
import uuid
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# load creds from the project-root .env BEFORE importing the service (GitHub + RocketRide)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

from .verifier_service import ClassifierPool, build_excel, verify_row  # noqa: E402
import run_batch as rb  # noqa: E402  (project root is on sys.path via verifier_service)

STATIC = Path(__file__).resolve().parent / "static"
DOWNLOADS: dict[str, str] = {}          # job id -> xlsx path (ephemeral, per-process)
pool = ClassifierPool()


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
        "names", "emails", "repo_accessible", "classify_failed")}
    out["layers"] = _layers(r)
    return out


def _summary(results: list) -> dict:
    return {"tags": dict(Counter(r.get("tag", "?") for r in results)),
            "backbone": dict(Counter(r.get("backbone", "?") for r in results))}


async def _run_stream(rows: list[dict], make_excel: bool):
    """Shared NDJSON generator for live + batch: stage/result events, then a done event."""
    results: list[dict] = []
    yield _ndjson({"event": "start", "total": len(rows)})
    for i, row in enumerate(rows, 1):
        async for kind, payload in verify_row(row, pool):
            if kind == "stage":
                yield _ndjson({"event": "stage", "index": i, **payload})
            else:
                results.append(payload)
                yield _ndjson({"event": "result", "index": i, "total": len(rows),
                               "result": _public(payload)})
    download = None
    if make_excel and results:
        rb.mark_duplicates(results)
        job = uuid.uuid4().hex[:12]
        out = Path(tempfile.gettempdir()) / f"rr_usage_{job}.xlsx"
        build_excel(results, str(out))
        DOWNLOADS[job] = str(out)
        download = f"/api/download/{job}"
    yield _ndjson({"event": "done", "count": len(results), "download": download,
                   "summary": _summary(results)})


@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.post("/api/verify/stream")
async def verify_stream(req: VerifyRequest):
    rows = [{"project": r.project or "", "github": r.github, "feedback": r.feedback or "",
             "demo": r.demo or "", "deployed": r.deployed or ""} for r in req.repos]
    return StreamingResponse(_run_stream(rows, make_excel=True),
                             media_type="application/x-ndjson")


@app.post("/api/batch")
async def batch(file: UploadFile = File(...)):
    suffix = Path(file.filename or "upload.csv").suffix or ".csv"
    tmp = Path(tempfile.gettempdir()) / f"rr_upload_{uuid.uuid4().hex[:8]}{suffix}"
    tmp.write_bytes(await file.read())
    try:
        rows = rb.load_rows(str(tmp))
    except SystemExit as e:                 # load_rows exits on an unreadable file
        raise HTTPException(400, f"Could not read submissions file: {e}")
    if not rows:
        raise HTTPException(400, "No rows found in the uploaded file.")
    return StreamingResponse(_run_stream(rows, make_excel=True),
                             media_type="application/x-ndjson")


@app.get("/api/download/{job}")
async def download(job: str):
    path = DOWNLOADS.get(job)
    if not path or not Path(path).exists():
        raise HTTPException(404, "Result expired or not found — re-run the verification.")
    return FileResponse(
        path, filename="RocketRide_Hackathon_Usage.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/health")
async def health():
    return {"ok": True, "classifier_ready": pool._token is not None}  # noqa: SLF001
