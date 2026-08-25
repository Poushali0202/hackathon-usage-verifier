"""
FastAPI app - RocketRide Hackathon Usage Verifier.

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
from db.models import Result as DbResult, Run as DbRun, Target as DbTarget  # noqa: E402
from db.session import SessionLocal, init_db  # noqa: E402
from target import Target as EngineTarget  # noqa: E402  (eval/ on sys.path via verifier_service)
import extract as target_extract  # noqa: E402  ("Prefill from repo" - eval/extract.py)
import engine  # noqa: E402  (target test dry-runs)
from .node_api import JOBS as NODE_JOBS, create_job as node_create_job  # noqa: E402
from .node_api import router as node_router  # noqa: E402
import os  # noqa: E402
from .authn import Identity, current_identity  # noqa: E402
from .db_api import router as db_router  # noqa: E402
from .runstate import ACTIVE as ACTIVE_RUNS  # noqa: E402
from fastapi import Depends  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

STATIC = Path(__file__).resolve().parent / "static"
DIST = PROJECT_ROOT / "frontend" / "dist"           # built React app (served when present)
BATCH_CONCURRENCY = 4                    # how many repos to verify at once
pool = ClassifierPool(max_concurrency=BATCH_CONCURRENCY)
# M7 point 1: the in-node engine pipeline (agent + tool_python). Separate session so the
# explain pipeline and the engine pipeline never contend for one token.
repo_pool = ClassifierPool(pipe_path=str(PROJECT_ROOT / "verify_repo.pipe"), max_concurrency=4)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()                      # create tables on first boot (Alembic at Supabase)
    rb.GH_TOKEN = rb.github_token()      # authenticate GitHub fetches (Pipeline A)
    try:
        await pool.start()               # open the cloud classifier (Pipeline B)
    except Exception as e:               # noqa: BLE001 - don't block startup if cloud is down
        print(f"[warn] classifier not reachable at startup: {e} (will retry per request)")
    try:
        await repo_pool.start()          # warm the in-node engine pipeline (M7)
    except Exception as e:               # noqa: BLE001
        print(f"[warn] verify_repo pipeline not reachable at startup: {e} (will retry per request)")
    yield
    await pool.aclose()
    await repo_pool.aclose()


app = FastAPI(title="RocketRide Hackathon Usage Verifier", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")   # serves the branding bg image
app.include_router(db_router)            # /api/targets CRUD + /api/runs (tenant-scoped)
app.include_router(node_router)          # /api/node/* (in-node engine: bundle/job/result)


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
    run_name: str | None = None        # persisted run label (M2)
    target_id: str | None = None       # selected target (recorded now; engine reads it at M3)


def _ndjson(obj: dict) -> bytes:
    return (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")


_LAYER_KEYS = ("ingest", "retrieval", "orchestration", "reasoning", "output")
# neutral sentinel: a layer is powered by "target" (whatever product is being judged), "other",
# or "none". Legacy "rocketride" values are normalised to "target" for backward compatibility.
_LAYER_VALUES = {"target", "other", "none"}


def _layers_from_backbone(backbone) -> dict:
    """Fallback layer map when the classifier didn't emit one - keep the load-bearing
    spine consistent with the backbone verdict so the UI tower never lies."""
    bb = backbone.strip().lower() if isinstance(backbone, str) else ""
    if bb == "yes":
        orch, reason = "target", "target"
    elif bb == "partial":
        orch, reason = "target", "other"              # one load-bearing pillar
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
    out = {}
    for k in _LAYER_KEYS:
        v = str(raw.get(k, "")).strip().lower()
        if v == "rocketride":
            v = "target"                               # legacy sentinel
        out[k] = v if v in _LAYER_VALUES else derived[k]
    return out


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
        "history_penalty", "platform", "target_name", "tech")}
    out["layers"] = _layers(r)
    return out


def _summary(results: list) -> dict:
    return {"tags": dict(Counter(r.get("tag", "?") for r in results)),
            "backbone": dict(Counter(r.get("backbone", "?") for r in results))}


async def _engine_target(target_id: str | None, tenant_id: str) -> "EngineTarget | None":
    """Resolve a run's selected target into an engine Target. The RocketRide preset (or no
    selection) returns None -> the engine's legacy pipeline-scoring path. Any custom target
    compiles its saved editor config into the target-agnostic generic path."""
    if not target_id:
        return None
    async with SessionLocal() as s:
        t = await s.get(DbTarget, target_id)
    if t is None or t.tenant_id != tenant_id or t.is_preset or t.slug == "rocketride":
        return None
    return EngineTarget.from_ui_config(t.name, t.config or {})


async def _new_run(ident: Identity, run_name: str | None, total: int,
                   event_date: str | None, history_penalty: float | None,
                   target_id: str | None = None) -> str:
    """Create the run row up front so it exists even if the client disconnects mid-stream."""
    async with SessionLocal() as s:
        run = DbRun(tenant_id=ident.tenant_id, target_id=target_id,
                    name=(run_name or "").strip() or f"Run {datetime.now(timezone.utc):%Y-%m-%d %H:%M}",
                    event_date=event_date, history_penalty=history_penalty, total=total)
        s.add(run)
        await s.commit()
        return run.id


async def _run_stream(rows: list[dict], concurrency: int = BATCH_CONCURRENCY,
                      event_date: str | None = None, history_penalty: float | None = None,
                      run_id: str | None = None, target: "EngineTarget | None" = None):
    """Shared NDJSON generator for live + batch. Repos are verified CONCURRENTLY (up to
    `concurrency` at a time); each verify_row's stage/result events are merged into one output
    stream via a queue, so a large batch finishes ~concurrency-times faster than one-at-a-time.
    Each result is ALSO persisted to the run row as it arrives, so the run survives restarts
    and disconnects. The Excel is NOT built here - the browser builds it via /api/export."""
    total = len(rows)
    yield _ndjson({"event": "start", "total": total, "run_id": run_id})
    results: list[dict] = []
    q: asyncio.Queue = asyncio.Queue()
    sem = asyncio.Semaphore(max(1, concurrency))

    async def worker(i: int, row: dict):
        try:
            async with sem:
                async for kind, payload in verify_row(row, pool, event_date, history_penalty,
                                                      target):
                    await q.put((kind, i, payload))
        except Exception as e:  # noqa: BLE001 - surface a failed row rather than hang the batch
            await q.put(("result", i, {**row, "repo_accessible": True, "classify_failed": True,
                         "tag": "None", "backbone": "No", "description": "", "rocketride_usage": "",
                         "notes": f"worker error: {e}", "evidence": [], "seconds": 0.0}))
        finally:
            await q.put(("__endrow__", i, None))

    tasks = [asyncio.create_task(worker(i, row)) for i, row in enumerate(rows, 1)]
    remaining = total
    finished = stopped = False

    # server-side stop: /api/runs/{id}/stop sets this event from any request handler
    cancel_ev = asyncio.Event()
    if run_id:
        ACTIVE_RUNS[run_id] = cancel_ev

    async def canceller():
        await cancel_ev.wait()
        for t in tasks:
            t.cancel()
        await q.put(("__stop__", 0, None))

    cancel_task = asyncio.create_task(canceller())
    try:
        while remaining:
            kind, i, payload = await q.get()
            if kind == "__stop__":
                stopped = True
                yield _ndjson({"event": "stopped", "count": len(results),
                               "summary": _summary(results)})
                break
            if kind == "__endrow__":
                remaining -= 1
            elif kind == "stage":
                yield _ndjson({"event": "stage", "index": i, **payload})
            else:
                results.append(payload)
                pub = _public(payload)
                if run_id:
                    async with SessionLocal() as s:
                        s.add(DbResult(run_id=run_id, project=str(pub.get("project") or "")[:300],
                                       github=str(pub.get("github") or "")[:500],
                                       tag=str(pub.get("tag") or ""), backbone=str(pub.get("backbone") or ""),
                                       score=pub.get("score"),
                                       flagged=bool(pub.get("project_predates") or pub.get("history_tampered")),
                                       payload=pub))
                        await s.commit()
                yield _ndjson({"event": "result", "index": i, "total": total, "result": pub})
        if not stopped:
            await asyncio.gather(*tasks, return_exceptions=True)
            finished = True
            yield _ndjson({"event": "done", "count": len(results), "summary": _summary(results)})
    finally:
        cancel_task.cancel()
        for t in tasks:
            t.cancel()
        if run_id:
            ACTIVE_RUNS.pop(run_id, None)
            async with SessionLocal() as s:
                run = await s.get(DbRun, run_id)
                if run:
                    run.status = "done" if finished else "stopped"
                    run.summary = _summary(results)
                    run.finished_at = datetime.now(timezone.utc)
                    await s.commit()


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the built React app when present (Render/preview deploys); otherwise the
    Phase-1 static UI, which also stays available at /legacy either way."""
    if (DIST / "index.html").exists():
        return (DIST / "index.html").read_text(encoding="utf-8")
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.get("/legacy", response_class=HTMLResponse)
async def legacy_index():
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.post("/api/verify/stream")
async def verify_stream(req: VerifyRequest, ident: Identity = Depends(current_identity)):
    rows = [{"project": r.project or "", "github": r.github, "feedback": r.feedback or "",
             "demo": r.demo or "", "deployed": r.deployed or ""} for r in req.repos]
    rb.fill_project_labels(rows)
    run_id = await _new_run(ident, req.run_name, len(rows), req.event_date,
                            req.history_penalty, req.target_id)
    target = await _engine_target(req.target_id, ident.tenant_id)
    return StreamingResponse(_run_stream(rows, event_date=req.event_date,
                                         history_penalty=req.history_penalty, run_id=run_id,
                                         target=target),
                             media_type="application/x-ndjson")


@app.post("/api/batch")
async def batch(file: UploadFile = File(...), event_date: str | None = Form(None),
                history_penalty: float | None = Form(None), run_name: str | None = Form(None),
                target_id: str | None = Form(None),
                ident: Identity = Depends(current_identity)):
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
    run_id = await _new_run(ident, run_name or (file.filename or "").rsplit(".", 1)[0],
                            len(rows), event_date, history_penalty, target_id)
    target = await _engine_target(target_id, ident.tenant_id)
    return StreamingResponse(_run_stream(rows, event_date=event_date,
                                         history_penalty=history_penalty, run_id=run_id,
                                         target=target),
                             media_type="application/x-ndjson")


@app.post("/api/targets/extract")
async def extract_target(github_url: str | None = Form(None), docs_url: str | None = Form(None),
                         package: str | None = Form(None), extra_url: str | None = Form(None),
                         files: list[UploadFile] = File(default=[]),
                         ident: Identity = Depends(current_identity)):
    """Draft a TargetConfig from any mix of sources: the vendor's repo, their docs site,
    a registry package name (public even when the repo is private), or uploaded files.
    Deterministic candidates + LLM synthesis + the verification gate: nothing reaches the
    form unless it appears in the provided material. Drafting only - no DB write."""
    uploads = {}
    for f in files[:8]:
        data = await f.read()
        uploads[f.filename or "upload.txt"] = data[:300_000].decode("utf-8", "replace")
    if not (github_url or docs_url or package or uploads):
        raise HTTPException(400, "Provide a repo URL, docs URL, package name, or files.")
    ctx = await asyncio.to_thread(target_extract.prepare_sources, rb._gh,
                                  github_url, extra_url, docs_url, package, uploads)
    if ctx is None:
        raise HTTPException(400, "None of the provided sources could be read.")
    answer = await pool.ask(target_extract.build_prompt(ctx), timeout=90)
    return target_extract.finalize(ctx, answer)


class TargetTestRequest(BaseModel):
    repo_url: str
    name: str = "Target"
    config: dict = {}
    engine: str = "local"       # "cloud" = run the engine INSIDE verify_repo.pipe (M7)


def _test_response(res: dict, engine_used: str) -> dict:
    return {"tag": res["tag"], "score": res["score"], "backbone": res["backbone"],
            "breakdown": res["breakdown"], "sdk": res["sdk"],
            "platform": res.get("platform", {}), "tech": res.get("tech", []),
            "other_platforms": res.get("other_platforms", []),
            "engine_used": engine_used}


@app.post("/api/targets/test")
async def test_target(req: TargetTestRequest, ident: Identity = Depends(current_identity)):
    """Dry-run a DRAFT target config against a known consumer repo - deterministic engine,
    no LLM prose, no DB write. engine="cloud" executes the SAME engine inside the deployed
    RocketRide pipeline (tool_python node); any cloud failure falls back to in-process."""
    cloud_note = ""
    if req.engine == "cloud":
        base = (os.getenv("PUBLIC_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")
        if not base:
            cloud_note = " (cloud needs a public URL - Render sets one automatically)"
            req.engine = "local-fallback"
    if req.engine == "cloud":
        job_id, evnt = node_create_job({
            "repo_url": req.repo_url,
            "target_config": {**(req.config or {}), "name": req.name},
            "gh_token": rb.GH_TOKEN or "",
            "event_date": None, "history_penalty": None,
        })
        answer = ""
        try:
            answer = await repo_pool.ask(json.dumps({"base_url": base, "job_id": job_id}),
                                         timeout=300)
            await asyncio.wait_for(evnt.wait(), timeout=20 if answer else 120)
            res = NODE_JOBS[job_id]["result"]
            if res.get("error"):
                raise HTTPException(400, f"Cloud engine: {res['error']}")
            return _test_response(res, "rocketride-node")
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001 - cloud path failed; fall back in-process
            # Known platform limitation: agent-authored fetch+exec of the engine bundle trips
            # the model's code-safety refusal (see M7 notes). Verdict is identical either way.
            cloud_note = " (cloud engine pending platform support; verdict computed locally)"
            print(f"[warn] cloud engine fell back to local: {type(e).__name__}: {e} "
                  f"| agent: {str(answer)[:200]}")

    t = EngineTarget.from_ui_config(req.name.strip() or "Target", req.config or {})
    ev = await asyncio.to_thread(engine.gather, req.repo_url, rb._gh, None, None, t)
    if not ev.get("accessible"):
        raise HTTPException(400, f"Repo not accessible (HTTP {ev.get('status', '?')}).")
    res = engine.evaluate(ev, t)
    used = "local" if req.engine == "local" else f"local fallback{cloud_note}"
    return _test_response(res, used)


class ExportRequest(BaseModel):
    results: list[dict]


@app.post("/api/export")
async def export(req: ExportRequest):
    """Build the styled Excel on demand from the results the browser already holds - stateless,
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


# ---- credentials: RocketRide's encrypted environment keystore ------------------
# Pattern per the platform reference app (rocket-crm-ui): values live in the
# account environment, pipelines hold only ${VAR} references, presence is
# checked without values, blank input never erases, and there is no reader.
CREDENTIAL_KEYS = ("ROCKETRIDE_LLM_API_KEY", "ROCKETRIDE_GITHUB_TOKEN")


async def _account_session():
    """Short-lived cloud connection for account keystore calls."""
    from rocketride import RocketRideClient
    client = RocketRideClient()
    await client.connect()
    return client


@app.get("/api/credentials")
async def credentials_get(ident: Identity = Depends(current_identity)):
    """Presence (and masked lengths) of the app's credential keys. Values never
    leave the keystore; only names and lengths are derived."""
    out = {k: {"present": False, "length": 0} for k in CREDENTIAL_KEYS}
    client = None
    try:
        client = await _account_session()
        names = set(await client.account.get_environment_keys())
        for key in CREDENTIAL_KEYS:
            out[key]["present"] = key in names
        # lengths for the mask: org then user (user wins, mirroring resolution order)
        merged = {}
        for scope in ("org", "user"):
            try:
                merged.update(await client.account.get_env(scope) or {})
            except Exception:  # noqa: BLE001 - a scope may not exist for this account
                pass
        for key in CREDENTIAL_KEYS:
            value = merged.get(key)
            if value:
                out[key] = {"present": True, "length": len(str(value))}
        return {"keystore": True, "keys": out}
    except Exception as e:  # noqa: BLE001 - no keystore (plain engine): env fallback
        for key in CREDENTIAL_KEYS:
            out[key] = {"present": bool(os.environ.get(key)), "length": 0}
        return {"keystore": False, "keys": out, "note": f"keystore unavailable ({type(e).__name__})"}
    finally:
        if client is not None:
            try:
                await client.disconnect()
            except Exception:  # noqa: BLE001
                pass


class CredentialsBody(BaseModel):
    updates: dict = {}


@app.post("/api/credentials")
async def credentials_set(body: CredentialsBody, ident: Identity = Depends(current_identity)):
    """Store credentials at org scope. Read-modify-write the whole dict (set_env
    replaces it); blanks are left alone; values are never logged or echoed."""
    filled = {k: str(v).strip() for k, v in (body.updates or {}).items()
              if k in CREDENTIAL_KEYS and str(v or "").strip()}
    if not filled:
        raise HTTPException(400, "nothing to store")
    client = await _account_session()
    try:
        env = dict(await client.account.get_env("org") or {})
        env.update(filled)
        await client.account.set_env("org", env)
        return {"ok": True, "set": sorted(filled)}
    finally:
        try:
            await client.disconnect()
        except Exception:  # noqa: BLE001
            pass


@app.get("/api/health")
async def health():
    return {"ok": True, "classifier_ready": pool._token is not None,  # noqa: SLF001
            "repo_pipeline_ready": repo_pool._token is not None}  # noqa: SLF001


# SPA catch-all (declared last so every /api and /static route wins first): serves real
# files from the built frontend, and index.html for client-side routes like /runs/abc.
if DIST.exists():
    from fastapi.responses import FileResponse

    @app.get("/{spa_path:path}", include_in_schema=False)
    async def spa(spa_path: str):
        if spa_path.startswith(("api/", "static/", "legacy")):
            raise HTTPException(404, "Not found.")
        f = DIST / spa_path
        if spa_path and f.is_file():
            return FileResponse(str(f))
        return HTMLResponse((DIST / "index.html").read_text(encoding="utf-8"))
