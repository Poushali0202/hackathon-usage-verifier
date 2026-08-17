"""Async engine + session factory.

DATABASE_URL picks the backend:
  dev default : sqlite+aiosqlite:///./hackjudge.db   (file next to the repo root)
  Supabase    : postgresql+asyncpg://... (set in .env when the project exists)
  AWS (prod)  : same asyncpg URL at Dimitri's deploy
"""
from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

DB_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./hackjudge.db")
# Supabase (and most hosts) hand out postgres:// or postgresql:// URLs; SQLAlchemy async
# needs the asyncpg driver spelled out. Normalize so the .env can hold the URL verbatim.
if DB_URL.startswith("postgres://"):
    DB_URL = "postgresql+asyncpg://" + DB_URL[len("postgres://"):]
elif DB_URL.startswith("postgresql://"):
    DB_URL = "postgresql+asyncpg://" + DB_URL[len("postgresql://"):]

# Supabase's transaction pooler (port 6543) breaks asyncpg's prepared-statement cache;
# disabling the cache makes both pooler modes safe. Direct/session connections are fine.
_connect_args = {"statement_cache_size": 0} if "pooler.supabase" in DB_URL else {}

engine = create_async_engine(DB_URL, echo=False, connect_args=_connect_args)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    """Create tables that don't exist yet. Alembic takes over when we move to Supabase."""
    from .models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
