# Hack Judge frontend (Phase 2, M1)

React + Vite SPA over the existing FastAPI. Design is the approved Phase-2 mockup theme
(RocketRide Cloud design system: action blue #2975DD, red #F93822 reserved for brand/Pro/flags).

## Run it (demo)

```bash
# 1. backend (any shell where python works)
uvicorn app.main:app --port 8000        # from the repo root, .env loaded as in Phase 1

# 2. frontend
cd frontend
npm install
npm run dev                             # http://localhost:5173 - /api proxies to :8000
```

No local backend? Point the proxy at the deployed service instead:

```bash
VITE_API_TARGET=https://<render-url> npm run dev
```

## What works today

- O-Connect sign-in **stub** (local session; real App Marketplace flow replaces `src/auth.jsx`
  + the backend's `app/authn.py` - those two files are the entire integration surface)
- **M2 persistence**: targets, runs and results live in a real database (SQLite dev file
  `hackjudge.db`; `DATABASE_URL` switches to Supabase/AWS Postgres). Runs survive restarts.
- **Tenant isolation**: the dev identity header maps to an org; another user's org cannot
  see or fetch your targets/runs (404). Try `X-Dev-User: shashi` to see an empty second org.
- Full run flow: wizard (event date required, target select, pre-event penalty) → sheet upload
  or pasted URLs → live NDJSON streaming → results persisted as they arrive → dossier + Excel
- Targets page: RocketRide preset (read-only) + **create/edit/delete your own targets**
- Dashboard / Runs read from the server API

## Not yet (by design)

- Real O-Connect + org claims (mechanics TBC with Shashi)
- Target-agnostic engine - custom targets are stored but scoring still uses the RocketRide
  preset until M3; the run records which target was selected
- Alembic migrations (arrive with the Supabase switch), BYOK key encryption at rest
- Real billing (Stripe via App Marketplace; non-blocking, last)
