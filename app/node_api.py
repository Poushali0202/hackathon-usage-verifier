"""Endpoints backing the in-node engine (M7 point 1).

The tool_python node inside verify_repo.pipe runs a tiny loader stub that:
  1. GETs /api/node/job/{job_id}      -> params (repo, target config, GitHub token,
                                          bundle sha, callback token) over HTTPS -
                                          secrets never pass through the LLM
  2. GETs /api/node/bundle.py          -> the engine bundle, integrity-checked against
                                          the sha from step 1
  3. runs the engine in the sandbox and POSTs /api/node/result/{job_id}

These routes are deliberately outside the tenant-auth dependency (the node has no user
session): job ids and callback tokens are unguessable one-time secrets with a short TTL,
and the bundle itself contains no secrets (it is just our engine code).
"""
from __future__ import annotations

import asyncio
import secrets
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from node_bundle import build_bundle, bundle_sha  # eval/ on sys.path via verifier_service

router = APIRouter(prefix="/api/node")

_BUNDLE = build_bundle()
_SHA = bundle_sha(_BUNDLE)
JOBS: dict = {}
_TTL = 900


def create_job(params: dict):
    """Register a job; returns (job_id, event). The event fires when the node posts back."""
    now = time.time()
    for k in [k for k, v in list(JOBS.items()) if now - v["ts"] > _TTL]:
        JOBS.pop(k, None)
    job_id = secrets.token_urlsafe(16)
    ev = asyncio.Event()
    JOBS[job_id] = {
        "params": {**params, "bundle_sha": _SHA, "cb_token": secrets.token_urlsafe(16)},
        "event": ev, "result": None, "ts": now,
    }
    return job_id, ev


@router.get("/bundle.py", response_class=PlainTextResponse)
async def get_bundle():
    return _BUNDLE


@router.get("/job/{job_id}")
async def get_job(job_id: str):
    j = JOBS.get(job_id)
    if j is None:
        raise HTTPException(404, "Unknown job.")
    return j["params"]


class NodeResult(BaseModel):
    token: str
    result: dict


@router.post("/result/{job_id}")
async def post_result(job_id: str, body: NodeResult):
    j = JOBS.get(job_id)
    if j is None or body.token != j["params"]["cb_token"]:
        raise HTTPException(404, "Unknown job or bad token.")
    j["result"] = body.result
    j["event"].set()
    return {"ok": True}
