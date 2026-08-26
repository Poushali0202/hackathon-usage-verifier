"""M2 schema — tenants, users, targets, runs, results.

Kept deliberately lean for v0: event fields live on the run (the wizard creates a run
directly), and each result row carries the full wire payload as JSON so the UI renders
exactly what streamed. Postgres (Supabase dev -> AWS at deploy) and local SQLite both
work — the JSON column maps to JSONB on Postgres and TEXT on SQLite.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    tier: Mapped[str] = mapped_column(String(20), default="developer")  # developer|company|organizers
    # set when the org signs in through O-Connect; dev-stub tenants leave it NULL
    marketplace_org_id: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    llm_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)   # BYOK (encrypted; wired later)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    # identity from the auth layer: "dev:<name>" now, O-Connect subject later
    external_id: Mapped[str] = mapped_column(String(200), unique=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(320), default="")
    role: Mapped[str] = mapped_column(String(40), default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Target(Base):
    __tablename__ = "targets"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_target_tenant_slug"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    slug: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(200))
    config: Mapped[dict] = mapped_column(JSON, default=dict)     # signal fields (M3 formalizes)
    is_preset: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    target_id: Mapped[str | None] = mapped_column(ForeignKey("targets.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    event_date: Mapped[str | None] = mapped_column(String(10), nullable=True)   # YYYY-MM-DD
    history_penalty: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")          # running|done|stopped
    total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)           # {tags:{...}, backbone:{...}}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Result(Base):
    __tablename__ = "results"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    project: Mapped[str] = mapped_column(String(300), default="")
    github: Mapped[str] = mapped_column(String(500), default="")
    tag: Mapped[str] = mapped_column(String(40), default="")
    backbone: Mapped[str] = mapped_column(String(20), default="")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)   # predates / tampered
    payload: Mapped[dict] = mapped_column(JSON, default=dict)       # full _public() wire result
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
