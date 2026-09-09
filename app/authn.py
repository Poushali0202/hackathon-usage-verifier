"""Pluggable authentication - the ONE place identity comes from.

Every /api route depends on `current_identity`. Modes (AUTH_MODE env):
  dev (default): trusts the X-Dev-User header (frontend sends the stub session's name).
                 First sight of a new dev user creates a tenant + user row, so tenant
                 isolation is real and demonstrable (X-Dev-User: shashi = separate org
                 that cannot see poushali's targets or runs).
  oconnect     : verifies a RocketRide App Marketplace O-Connect token and maps its org
                 claim to the tenant. NOT implemented yet - token format / org claims /
                 embed-vs-redirect are still being confirmed. Swapping this function is
                 the entire integration surface; nothing else changes.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import Header, HTTPException
from sqlalchemy import select

from db.models import Tenant, User
from db.session import SessionLocal

AUTH_MODE = os.getenv("AUTH_MODE", "dev")


@dataclass
class Identity:
    user_id: str
    tenant_id: str
    name: str


async def resolve_identity(handle: str) -> Identity:
    """Map a handle to its tenant/user, creating both on first sight (dev-mode identity)."""
    handle = (handle or "poushali").strip().lower()[:80] or "poushali"
    ext = f"dev:{handle}"
    async with SessionLocal() as s:
        user = (await s.execute(select(User).where(User.external_id == ext))).scalar_one_or_none()
        if user is None:
            tenant = Tenant(name="RocketRide Inc" if handle == "poushali" else f"{handle.title()}'s Org")
            s.add(tenant)
            await s.flush()
            user = User(external_id=ext, tenant_id=tenant.id, name=handle.title())
            s.add(user)
            await s.commit()
        return Identity(user_id=user.id, tenant_id=user.tenant_id, name=user.name)


async def current_identity(x_dev_user: str | None = Header(None)) -> Identity:
    if AUTH_MODE == "oconnect":
        raise HTTPException(501, "O-Connect auth is not integrated yet (mechanics TBC).")
    return await resolve_identity(x_dev_user or "poushali")
