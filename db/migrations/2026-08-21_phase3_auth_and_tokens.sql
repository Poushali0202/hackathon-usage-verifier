-- Phase 3 (backend-as-pipeline): app-owned auth + token-economy tables.
-- Additive only - existing app keeps working (authn.py dev mode untouched).
-- Run once against the Supabase Postgres (idempotent: IF NOT EXISTS throughout).

-- tiers land on the tenant (Rev 2: developer / company / enterprise)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'developer';

-- app-owned credentials (NULL password_hash = legacy dev-stub user, still valid)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(300);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_auth
    ON users (lower(email)) WHERE password_hash IS NOT NULL;

-- revocable DB-backed sessions (token stored only as SHA-256 hash)
CREATE TABLE IF NOT EXISTS sessions (
    id         VARCHAR(32) PRIMARY KEY,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    user_id    VARCHAR(32) NOT NULL REFERENCES users(id),
    tenant_id  VARCHAR(32) NOT NULL REFERENCES tenants(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_token_hash ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions (user_id);

-- prepaid balance per tenant, metered in KB (Stripe fields are placeholders, unwired)
CREATE TABLE IF NOT EXISTS balances (
    tenant_id          VARCHAR(32) PRIMARY KEY REFERENCES tenants(id),
    balance_kb         NUMERIC(14,2) NOT NULL DEFAULT 0,
    threshold_kb       NUMERIC(14,2) NOT NULL DEFAULT 0,
    auto_recharge      BOOLEAN NOT NULL DEFAULT FALSE,
    stripe_customer_id VARCHAR(64),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- the usage ledger: one row per metered event, unit = KB processed
CREATE TABLE IF NOT EXISTS usage_events (
    id           VARCHAR(32) PRIMARY KEY,
    tenant_id    VARCHAR(32) NOT NULL REFERENCES tenants(id),
    run_id       VARCHAR(32),
    kind         VARCHAR(40) NOT NULL DEFAULT 'verify',
    kb_processed NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_usage_tenant ON usage_events (tenant_id);
