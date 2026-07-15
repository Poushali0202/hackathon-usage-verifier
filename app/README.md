# Hackathon Usage Verifier — Web App (Pipeline A + B)

A deployable front-end for the verifier. Same proven logic as `run_batch.py`, packaged as
a web app so it can run the two-pipeline flow live for the investor-pitch demo.

- **Pipeline A — LOCAL:** `run_batch.fetch_signals(url)` gathers the GitHub evidence digest.
- **Pipeline B — CLOUD:** `verify_usage.pipe` (chat → `llm_anthropic` → answer) classifies it.
- The app is the orchestrator; the UI shows the **local → cloud hand-off** for each repo.

> No custom node required — Pipeline A uses the local fetch, Pipeline B is the existing cloud
> pipeline. The custom "GitHub Evidence" node stays a phase-2 item (only needed if the fetch must
> also move onto Cloud). See `../FULLY_CLOUD_NODE_ANALYSIS.md` and `../TWO_PIPELINE_DEMO_ARCHITECTURE.md`.

## Two modes
- **⚡ Live demo** — paste a few repo URLs → watch each one fetch (local) then classify (cloud) →
  per-repo cards with tag / backbone / justification. This is the pitch view.
- **📄 Batch** — upload the submissions `.csv/.xlsx` → full run → download the styled Excel
  (same columns, colors, and clickable GitHub/demo/deployed links as the CLI).

## Run locally
From the project folder (`Projects/hackathon-usage-verifier`), with your `.env` already there:

```bash
pip install -r app/requirements.txt
uvicorn app.main:app --reload
# open http://127.0.0.1:8000
```

`.env` must contain (already set locally):
```
ROCKETRIDE_URI=https://api.rocketride.ai
ROCKETRIDE_APIKEY=...
ROCKETRIDE_ANTHROPIC_KEY=...
ROCKETRIDE_GITHUB_TOKEN=...
```

## Deploy to Render
1. Make this folder (`hackathon-usage-verifier`) a git repo and push it (GitHub/GitLab).
2. In Render: **New → Blueprint**, point at the repo. It reads `render.yaml`
   (Docker, `app/Dockerfile`, health check `/api/health`).
3. Set the four secrets in the dashboard: `ROCKETRIDE_URI`, `ROCKETRIDE_APIKEY`,
   `ROCKETRIDE_ANTHROPIC_KEY`, `ROCKETRIDE_GITHUB_TOKEN`.
4. Deploy → open the Render URL.

### One dependency to resolve for deploy: the RocketRide SDK
`rocketride` is a **private** package (installed locally already). The Docker build needs it too —
edit `app/requirements.txt` to install it from your team's index or a git URL, e.g.
`rocketride @ git+https://<TOKEN>@github.com/rocketride/rocketride-python.git@main`.
Ask the engine team for the canonical install line.

> **Demo topology note (Shashidhar's "runs on local + cloud"):** the deployed app already shows
> Cloud (Pipeline B). To *also* showcase the local RocketRide engine, run `../verify_github.pipe`
> (agent + `tool_github`) on your local engine during the demo — that is Pipeline A as a genuine
> local RocketRide pipeline. The web app itself uses the faster Python fetch for reliability.

## Files
| File | Role |
|---|---|
| `main.py` | FastAPI routes, NDJSON streaming, CSV upload, Excel download |
| `verifier_service.py` | `ClassifierPool` (Pipeline B) + `verify_row` staged fetch→classify (reuses `run_batch`) |
| `static/index.html` | UI — live cards + batch, architecture ribbon, self-contained |
| `Dockerfile` / `../render.yaml` | container + Render blueprint |
