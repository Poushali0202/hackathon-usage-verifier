# Hackathon Usage Verifier

A judging aid that verifies **how each hackathon project actually used RocketRide — from its code, not
its self-reported claims** — and produces a styled Excel sheet (and a live web UI) with a tag, a
backbone verdict, and a plain-English justification for every project.

Built for live RocketRide hackathon judging: it must run within the ~15-minute window between the
submission deadline and the start of judging, across 40+ repositories.

---

## How it works — the two-pipeline (hybrid) architecture

```
 repo URL ─▶  PIPELINE A (local)              ─▶  PIPELINE B (RocketRide Cloud)        ─▶  OUTPUT
             fetch_signals(): GitHub API,          verify_usage.pipe:                       verdict JSON →
             reads tree + manifests + source,      chat → llm_anthropic (Claude) →          styled Excel
             distils a small evidence digest       response_answers  (on api.rocketride.ai)  + live cards
```

- **Pipeline A — local, fast, reliable.** Python (`fetch_signals`) hits the GitHub API and distils each
  repo down to the RocketRide-specific signals — a `rocketride` / `@rocketride/sdk` dependency, `.pipe`
  files or a `pipelines/` folder, `RocketRideClient` / `client.use()` / `client.chat()` / engine calls,
  hosted-pipeline usage (`ROCKETRIDE_PIPELINE_` env + a `lib/rocketride` adapter), and which other
  platforms the repo uses. Small, complete, no truncation.
- **Pipeline B — RocketRide Cloud.** The digest is sent over the RocketRide SDK
  (`RocketRideClient` → `client.use()` → `client.chat()`, over `wss://api.rocketride.ai`) to the
  `verify_usage.pipe` pipeline, where Claude applies the rubric and returns a strict JSON verdict.

**Why hybrid?** No existing cloud node can fetch a remote repo in the data lane fast enough for the SLA
(every network-capable node is agent-invoked and slow). Full analysis in
[`FULLY_CLOUD_NODE_ANALYSIS.md`](FULLY_CLOUD_NODE_ANALYSIS.md).

---

## The classification rubric

Every accessible repo gets a **Tag** and a **Backbone** verdict, coupled to whether RocketRide is the
project's *primary orchestrator*:

| Tag | Meaning |
|---|---|
| **Significant** | Real RocketRide integration **and** RocketRide is the primary / co-primary orchestrator |
| **Moderate** | Real RocketRide artifacts exist, but another platform clearly runs the project |
| **Less** | Present only as branding / scaffold, or explicitly disabled |
| **None** | No real usage, overclaimed, or repo inaccessible |

| Backbone | Meaning |
|---|---|
| **Yes** | RocketRide runs the core AI / orchestration (the default whenever it's the AI engine, even if another platform handles data/gateway) |
| **Partial** | Scoped to one sub-feature, a true co-equal split, or a full non-RocketRide fallback exists |
| **No** | Present but not primary, or scaffold / branding / absent |

---

## Setup

Requires Python 3.11+. From this folder:

```bash
pip install rocketride openpyxl python-dotenv            # CLI
pip install -r app/requirements.txt                       # + web app (fastapi, uvicorn, ...)
```

Create a `.env` in this folder (see `.env.example`):

```
ROCKETRIDE_URI=https://api.rocketride.ai
ROCKETRIDE_APIKEY=<your key>
ROCKETRIDE_ANTHROPIC_KEY=<funded Anthropic key used by the cloud classifier>
ROCKETRIDE_GITHUB_TOKEN=<github PAT — needed for 40+ repos to beat GitHub's rate limit>
```

> These are live credentials — never commit `.env`.

---

## Usage

### CLI (`run_batch.py`)

```bash
# Full run — accepts .csv or .xlsx submissions
python run_batch.py "submissions.csv"

# Resubmit only the failed/inaccessible rows and MERGE them back into an existing sheet
python run_batch.py "needs_review.csv" --merge "RocketRide_Hackathon_Usage.xlsx"
```

Options: `--out FILE` · `--concurrency N` (default 2) · `--limit N`.

The tool auto-detects columns (project, team, emails, GitHub, feedback, deployed URL, demo/video),
handles CSV encoding fallbacks, flags inaccessible repos to `needs_review.csv`, and prints a summary
(tag/backbone counts + per-repo timing). Merges are **upserts** — matched by project name then repo.

### Web app

```bash
uvicorn app.main:app --reload      # → http://127.0.0.1:8000
```

- **⚡ Live** — paste repo URLs → watch each one fetch (local) then classify (cloud) as per-repo cards.
- **📄 Batch** — upload the submissions `.csv/.xlsx` → full run → download the styled Excel.

Deployment (Render) and the "Liquid Glass" UI details are in [`app/README.md`](app/README.md).

---

## Output — the Excel sheet

11 columns, colour-coded by tag/backbone, with clickable GitHub / demo / deployed links:

`Project Name` · `Team Details` · `Project Description` · `How RocketRide Was Used & How It Helped` ·
`RocketRide Usage Tag` · `RocketRide = Backbone?` · `GitHub Link` · `Additional Notes` ·
`Why This Classification (Justification)` · `Demo / Presentation / Video` · `Deployed URL`

---

## Project layout

| Path | What it is |
|---|---|
| `run_batch.py` | The CLI tool — fetch + classify + styled Excel (the source of truth for all logic) |
| `verify_usage.pipe` | **Pipeline B** — the cloud classifier (`chat → llm_anthropic → response_answers`) |
| `app/` | FastAPI web app (live + batch modes) — reuses `run_batch`; `app/README.md` covers deploy |
| `verify_usage_canvas.pipe` | Canvas-demo variant of Pipeline B (rubric in a `prompt` node) for the RocketRide Cloud builder |
| `verify_github.pipe` | Parked full-cloud experiment (`agent_rocketride` + `tool_github`) — accurate but too slow for the SLA |
| `rubric_for_prompt_node.txt` | The rubric text to paste into the canvas pipeline's prompt node |
| `live_monitor.py` | Probe that subscribes to RocketRide run events (`add_monitor`) — used to test canvas→webpage streaming |
| `FULLY_CLOUD_NODE_ANALYSIS.md` | Why a custom node is needed for a fully-cloud version (existing nodes vs custom) |
| `TWO_PIPELINE_DEMO_ARCHITECTURE.md` | The local-fetch + cloud-classify split, for the investor-pitch demo |
| `CLOUD_CANVAS_SETUP_GUIDE.md` | Step-by-step: build Pipeline B on the RocketRide Cloud canvas |

---

## Notes

- The verdict is **never hardcoded** — for any accessible repo, the tag/backbone/justification are the
  parsed JSON returned by Claude on RocketRide Cloud; only the no-repo / 404 / incomplete-fetch guards
  return fixed results (there's nothing to classify).
- The classifier calls the pay-as-you-go **Anthropic API** funded via `ROCKETRIDE_ANTHROPIC_KEY` — a
  Claude Max subscription does **not** fund it.
