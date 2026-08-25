"""Tenant-scoped persistence API: /api/targets CRUD + /api/runs read endpoints.

Every query filters by the caller's tenant_id (from authn.current_identity) - cross-tenant
ids 404, which is the isolation contract the eventual O-Connect swap inherits unchanged.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func, select

from datetime import datetime, timezone

from db.models import Result, Run, Target
from db.session import SessionLocal

from .authn import Identity, current_identity
from .runstate import ACTIVE as ACTIVE_RUNS

router = APIRouter(prefix="/api")

# The engine's current hardcoded behavior, expressed as the preset TargetConfig every
# tenant starts with. M3 makes the engine actually read from this shape.
ROCKETRIDE_PRESET = {
    "types": ["code", "platform"],
    "dependency_names": "rocketride, @rocketride/sdk",
    "artifacts": "*.pipe, pipeline-shaped JSON (components/nodes)",
    "invocation": "client.use | client.send | client.chat | RocketRideClient",
    "hosted_markers": "ROCKETRIDE_PIPELINE_*, api.rocketride.ai",
    "cli_verbs": "rocketride start",
    "competitors": "langchain, crewai",
    "neutral": "butterbase, supabase, pinecone, firebase",
}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "target"


def _target_out(t: Target) -> dict:
    return {"id": t.id, "slug": t.slug, "name": t.name, "config": t.config,
            "is_preset": t.is_preset}


async def _ensure_preset(s, tenant_id: str) -> None:
    q = select(Target).where(Target.tenant_id == tenant_id, Target.slug == "rocketride")
    if (await s.execute(q)).scalar_one_or_none() is None:
        s.add(Target(tenant_id=tenant_id, slug="rocketride", name="RocketRide",
                     config=ROCKETRIDE_PRESET, is_preset=True))
        await s.commit()


# ---------------- targets ----------------

class TargetIn(BaseModel):
    name: str
    config: dict = {}


@router.get("/targets")
async def list_targets(ident: Identity = Depends(current_identity)):
    async with SessionLocal() as s:
        await _ensure_preset(s, ident.tenant_id)
        rows = (await s.execute(
            select(Target).where(Target.tenant_id == ident.tenant_id)
            .order_by(Target.is_preset.desc(), Target.created_at))).scalars().all()
        return [_target_out(t) for t in rows]


@router.post("/targets")
async def create_target(body: TargetIn, ident: Identity = Depends(current_identity)):
    slug = _slugify(body.name)
    async with SessionLocal() as s:
        dup = (await s.execute(select(Target).where(
            Target.tenant_id == ident.tenant_id, Target.slug == slug))).scalar_one_or_none()
        if dup:
            raise HTTPException(409, f"A target named '{body.name}' already exists.")
        t = Target(tenant_id=ident.tenant_id, slug=slug, name=body.name.strip(), config=body.config)
        s.add(t)
        await s.commit()
        return _target_out(t)


@router.put("/targets/{tid}")
async def update_target(tid: str, body: TargetIn, ident: Identity = Depends(current_identity)):
    async with SessionLocal() as s:
        t = (await s.execute(select(Target).where(
            Target.id == tid, Target.tenant_id == ident.tenant_id))).scalar_one_or_none()
        if t is None:
            raise HTTPException(404, "Target not found.")
        if t.is_preset:
            raise HTTPException(400, "The RocketRide preset is read-only.")
        t.name, t.config = body.name.strip(), body.config
        await s.commit()
        return _target_out(t)


@router.delete("/targets/{tid}")
async def delete_target(tid: str, ident: Identity = Depends(current_identity)):
    async with SessionLocal() as s:
        t = (await s.execute(select(Target).where(
            Target.id == tid, Target.tenant_id == ident.tenant_id))).scalar_one_or_none()
        if t is None:
            raise HTTPException(404, "Target not found.")
        if t.is_preset:
            raise HTTPException(400, "The RocketRide preset cannot be deleted.")
        await s.delete(t)
        await s.commit()
        return {"ok": True}


# ---------------- runs ----------------

@router.get("/runs")
async def list_runs(ident: Identity = Depends(current_identity)):
    async with SessionLocal() as s:
        runs = (await s.execute(
            select(Run).where(Run.tenant_id == ident.tenant_id)
            .order_by(Run.created_at.desc()).limit(50))).scalars().all()
        counts = {rid: (n, f or 0) for rid, n, f in (await s.execute(
            select(Result.run_id, func.count(),
                   func.sum(case((Result.flagged, 1), else_=0)))
            .group_by(Result.run_id)))}
        sig = {rid: n for rid, n in (await s.execute(
            select(Result.run_id, func.count()).where(Result.tag == "Significant")
            .group_by(Result.run_id)))}
        tmap = {t.id: t.name for t in (await s.execute(
            select(Target).where(Target.tenant_id == ident.tenant_id))).scalars()}
        return [{
            "id": r.id, "name": r.name, "event_date": r.event_date,
            "target_name": tmap.get(r.target_id) or "RocketRide",
            "history_penalty": r.history_penalty, "status": r.status, "total": r.total,
            "summary": r.summary, "created_at": r.created_at.isoformat(),
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "done_count": counts.get(r.id, (0, 0))[0],
            "flagged_count": counts.get(r.id, (0, 0))[1],
            "significant_count": sig.get(r.id, 0),
        } for r in runs]


@router.post("/runs/{rid}/stop")
async def stop_run(rid: str, ident: Identity = Depends(current_identity)):
    """Stop a running verification from anywhere (not just the tab that started it).
    Live stream -> cancel its workers; stale 'running' row (e.g. the server restarted
    mid-run) -> mark it stopped so it stops showing as active."""
    async with SessionLocal() as s:
        r = (await s.execute(select(Run).where(
            Run.id == rid, Run.tenant_id == ident.tenant_id))).scalar_one_or_none()
        if r is None:
            raise HTTPException(404, "Run not found.")
        if r.status != "running":
            return {"ok": True, "status": r.status}
        ev = ACTIVE_RUNS.get(rid)
        if ev is not None:
            ev.set()                     # live: the stream's finally block persists 'stopped'
            return {"ok": True, "status": "stopping"}
        r.status = "stopped"             # stale: no live stream owns it anymore
        r.finished_at = datetime.now(timezone.utc)
        await s.commit()
        return {"ok": True, "status": "stopped"}


@router.get("/runs/{rid}")
async def get_run(rid: str, ident: Identity = Depends(current_identity)):
    async with SessionLocal() as s:
        r = (await s.execute(select(Run).where(
            Run.id == rid, Run.tenant_id == ident.tenant_id))).scalar_one_or_none()
        if r is None:
            raise HTTPException(404, "Run not found.")
        results = (await s.execute(select(Result).where(Result.run_id == rid)
                                   .order_by(Result.created_at))).scalars().all()
        tname = None
        if r.target_id:
            t = await s.get(Target, r.target_id)
            tname = t.name if t else None
        return {"id": r.id, "name": r.name, "event_date": r.event_date,
                "history_penalty": r.history_penalty, "status": r.status,
                "total": r.total, "summary": r.summary,
                "target_name": tname or "RocketRide",
                "created_at": r.created_at.isoformat(),
                "results": [x.payload for x in results]}
