"""Tier entitlements, enforced server-side on tenants.tier.

Identity still comes from the dev auth stub, so this is enforcement structure,
not tamper-proof security - that arrives when marketplace auth replaces the
header. Limits apply to NEW work only: existing rows are grandfathered, and
editing an existing target never trips the quota.
"""
from fastapi import HTTPException
from sqlalchemy import func, select

from db.models import Target, Tenant
from db.session import SessionLocal

# legacy names from earlier drafts map onto the final tiers
_ALIASES = {"enterprise": "organizers", "pro": "company", "free": "developer"}

LIMITS = {
    "developer":  {"targets": 1,    "rows": 25,   "freshness": False},
    "company":    {"targets": 5,    "rows": 250,  "freshness": True},
    "organizers": {"targets": None, "rows": None, "freshness": True},
}


async def tenant_tier(tenant_id: str) -> str:
    async with SessionLocal() as s:
        t = await s.get(Tenant, tenant_id)
    tier = ((t.tier if t else None) or "developer").lower()
    tier = _ALIASES.get(tier, tier)
    return tier if tier in LIMITS else "developer"


async def check_target_quota(tenant_id: str) -> str:
    tier = await tenant_tier(tenant_id)
    cap = LIMITS[tier]["targets"]
    if cap is None:
        return tier
    async with SessionLocal() as s:
        n = (await s.execute(select(func.count()).select_from(Target).where(
            Target.tenant_id == tenant_id, Target.is_preset == False))).scalar_one()  # noqa: E712
    if n >= cap:
        plural = "s" if cap != 1 else ""
        raise HTTPException(403, f"The {tier.title()} plan includes {cap} custom "
                                 f"target{plural}. Upgrade to add more.")
    return tier


def check_rows(tier: str, n: int) -> None:
    cap = LIMITS[tier]["rows"]
    if cap is not None and n > cap:
        raise HTTPException(403, f"The {tier.title()} plan verifies up to {cap} repos per "
                                 f"run (this one has {n}). Upgrade for larger sheets.")


def check_rubric(tier: str, config: dict | None) -> None:
    if LIMITS[tier]["freshness"]:      # rubric editing ships with the same tier
        return
    if (config or {}).get("weights") or (config or {}).get("thresholds"):
        raise HTTPException(403, "Custom rubric & weights are a Company feature. "
                                 "Remove the rubric overrides or upgrade.")


def clamp_freshness(tier: str, event_date, history_penalty):
    """Below Company, git-freshness checks and the judge-set penalty don't run:
    the run scores code usage only, exactly what the locked UI shows."""
    if LIMITS[tier]["freshness"]:
        return event_date, history_penalty
    return None, None
