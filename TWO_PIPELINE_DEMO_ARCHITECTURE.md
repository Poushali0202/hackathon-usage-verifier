# Two-Pipeline Split — Local Fetch + Cloud Classify (Demo Architecture)

Per Shashidhar's suggestion: decouple the workflow so the **"issue node" (GitHub evidence fetch)**
is isolated in a **local** pipeline, the AI runs on the **cloud**, and a deployed app orchestrates
both — so the demo visibly shows *local + cloud* execution ("the breadth of the product") for the
investor pitch. This is the existing hybrid, re-architected as **two named RocketRide pipelines**.

---

## The split

### Pipeline A — "GitHub Evidence" — runs on the LOCAL engine
- **Input:** a repo URL (+ optional deployed-project URL)
- **Node(s):** the **GitHub Evidence** fetch node — the one that can't run cloud-native. For the demo
  this can be the custom node running in dev, or (interim) a `tool_github` agent — both work locally.
- **Output:** a small structured **evidence digest** (JSON)
- **Why local:** it's the data-lane fetch that has no cloud-native node yet (see
  `FULLY_CLOUD_NODE_ANALYSIS.md`). Locally you control the engine, so it just runs.

### Pipeline B — "Usage Classifier" — runs on RocketRide CLOUD  (= your existing `verify_usage.pipe`)
- **Input:** the evidence digest JSON (as the chat/question payload)
- **Nodes:** `chat` → `llm_anthropic` (claude-sonnet, the rubric prompt) → `response_answers`
- **Output:** the **verdict** JSON — `tag`, `backbone`, `justification`

---

## The hand-off contract (the interface between them)
The **evidence digest** — exactly what `fetch_signals()` already returns. This JSON is Pipeline A's
output and Pipeline B's input; nothing else crosses the boundary:

```json
{
  "repo": "github.com/team/project",
  "accessible": true,
  "pipe_files": ["pipelines/verify.pipe"],
  "rocketride_dependencies": ["rocketride==0.4.1"],
  "source_signals": ["RocketRideClient", "client.use(", "ROCKETRIDE_PIPELINE_"],
  "other_platforms": ["butterbase"],
  "hosted_pipeline": true
}
```

Small, serializable, human-readable — clean to show on screen during the demo.

---

## Orchestration — the app (deploy on Vercel / Render)
A thin app loops over repos and glues the two pipelines together:

1. `POST repo URL` → **Local Pipeline A** endpoint → evidence digest
2. send digest → **Cloud Pipeline B** (SDK `client.use()` + `client.chat()`) → verdict
3. collect → write the styled Excel (your existing `openpyxl` code)

The deployed app "uses the local endpoint to connect" — Shashidhar's exact framing.

```
                 App  (Vercel / Render)  — orchestrator + UI + Excel
                   │
   repo URL ──▶ (1)│──▶  LOCAL RocketRide ─ Pipeline A: GitHub Evidence node ──▶ digest
                   │                                                               │
                   │◀──────────────────────── digest ──────────────────────────────┘
                   │
             (2)   │──▶  CLOUD RocketRide ─ Pipeline B: chat→llm_anthropic→response ──▶ verdict
                   │
                   ▼
              styled Excel  (tag · backbone · justification · links)
```

**Two ways to wire A → B (pick one):**
- **Recommended — app-orchestrated:** the app calls the local engine, then the cloud pipeline. Local
  never has to be publicly reachable. Simplest and most robust for a live demo.
- **Tunnel (more "pipeline-to-pipeline"):** expose the local engine via ngrok; Cloud Pipeline B calls
  it with a `tool_http_request`. Flashier but adds a public tunnel as a failure point.

---

## Maps cleanly onto what you already have
| Existing asset | Becomes |
|---|---|
| `fetch_signals()` in `run_batch.py` | **Pipeline A** logic (wrapped as a local RocketRide pipeline / the custom node) |
| `verify_usage.pipe` | **Pipeline B** — unchanged |
| `run_batch.py` loop + upsert-merge + Excel | the **app** orchestrator (deploy on Vercel/Render) |

So ~80% is re-framing, not rebuild: the hybrid already does fetch-local + classify-cloud; this makes
Pipeline A an *actual local RocketRide pipeline* so the demo can show both engines side by side.

---

## Demo vs production (important distinction)
- **Demo (investor pitch):** 1–3 repos, so the 15-min SLA is irrelevant — even an agent-based
  `tool_github` fetch locally is fine. The story is "one real-time use case, running **local + cloud**,
  driven by a **deployed app**."
- **Production (live judging):** 40+ repos under the 15-min SLA still wants the **custom GitHub Evidence
  node** for speed (phase 2). Same two-pipeline shape — only Pipeline A's node gets faster.

---

## What to build for the demo
1. Wrap the fetch as a **local RocketRide Pipeline A** (start with `tool_github` agent or the custom
   node in dev) that emits the digest JSON.
2. Keep `verify_usage.pipe` as **Cloud Pipeline B**.
3. Stand up a **thin orchestrator app** (reuse `run_batch.py` logic) and deploy it on Vercel/Render.
4. Freeze the **digest JSON contract** once — both pipelines speak only that.
