# Deterministic Scoring Spec — APPROVED

The evaluation engine (`eval/engine.py`) measures every signal below **deterministically** (parsing
pipeline files + scanning source across **12+ languages**, no LLM). The score → Tag; the LLM only
writes the human explanation. Backbone is a rule (bottom). Weights approved 2026-07; example values
are real, from `github.com/ramizik/constructor`.

Score is a **small-point scale** (a single real pipeline ≈ 4–7; multi-pipeline suites more, capped —
see the pipeline cap below). `Raw score = Σ(signal × weight) − penalties`, floored at 0.

**What counts as a pipeline** — a `.pipe` file, a committed `.json` pipeline, or an in-code pipeline
object (`client.use({ pipeline: {…} })`). Engineering confirmed a `.json` pipeline is valid usage as
long as it actually runs (it just doesn't render in the canvas). Parser accepts `components` or
`nodes`, `provider` or `type`, and unwraps a `{ "pipeline": {…} }` envelope like the SDK.

**What counts as "called"** — the pipeline is loaded/run via any of: its name next to a
`client.use/send/chat` (same file OR cross-file), a **generic runner** (`client.use(filepath=<var>)`),
an inline pipeline object, or `rocketride start`.

---

## A. Pipelines & complexity  *(is there a real, non-trivial pipeline?)*
| # | Signal (deterministic) | constructor | weight |
|---|---|---|---|
| A2 | **complexity of a called pipeline** — 4–8 nodes | 7 nodes | **+0.5** |
| A2 | **complexity of a called pipeline** — 9+ nodes | — | **+1.0** |
| A3 | **called pipeline has an agent node** (`agent_*` = real orchestration) | yes | **+1.0** |
| A4 | **called pipeline has a tool/LLM node** (`tool_*` / `llm_*`) | yes | **+0.5** |

## B. Call verification  *(is the pipeline actually USED, or just for show?)* — the core ask
| # | Signal (deterministic) | constructor | weight |
|---|---|---|---|
| B1 | **each pipeline actually called** (see "called" above) | 1 of 1 | **+2.0** each |
| B2 | **PENALTY: pipeline present but never called — ONLY when the repo shows *zero* invocation** (no SDK call-site, no engine/webhook call, no called pipe) | 0 | **−1.0** each |
| — | *A2/A3/A4 only score for **called** pipelines. An uncalled pipe in a repo that DOES invoke RocketRide earns nothing but is **not** penalised — so a big suite of experiments / generated / example pipes can never bury genuine usage.* | | |
| — | **Pipeline cap:** at most **6** called pipelines score (a large generated suite can't run the score away). | | |

## C. SDK / engine usage depth  *(how pervasive, and does it actually reach RocketRide?)*
| # | Signal (deterministic) | constructor | weight |
|---|---|---|---|
| C1 | **dependency in a manifest** (`rocketride` in package.json / requirements / Cargo.toml / go.mod / pom.xml / …) | yes | **+1.0** |
| C2 | **≥3 SDK call-sites** (`RocketRideClient`, `client.use/chat/send/connect` — any language) | 8 | **+0.5** |
| C3 | **≥2 files use RocketRide** (spread, not adapter-only) | 2 | **+0.5** |
| C4 | **hosted-pipeline usage** (`ROCKETRIDE_PIPELINE_*` / `ROCKETRIDE_*_URL/WEBHOOK/ENDPOINT` env, or a `lib/rocketride` adapter — a bare `ROCKETRIDE_API_KEY` is only auth and does NOT count) | yes | **+1.0** |
| — | **Real engine/webhook call** (`ws://localhost:5565`, `/v1/pipelines`, the hosted API host `api.rocketride.ai`, or a deployed-pipeline webhook URL) counts as genuine invocation (waives the B2 penalty + drives backbone), incl. SDK-less HTTP from any language. | | |

## D. Disqualifiers / caps
| # | Rule | Effect |
|---|---|---|
| D1 | **scaffold only** (`.claude/rules/rocketride.md`, no dep/pipe/call) | Tag capped at **Less** |
| D2 | **overclaim** (feedback claims RocketRide, zero code evidence) | force **None** |
| D3 | **inaccessible** (repo 404 / private) | force **None**, flag for review |

---

## Score → Tag thresholds  *(APPROVED)*
| Tag | Condition |
|---|---|
| **Significant** | score ≥ **4**  **AND** backbone ∈ {Yes, Partial} |
| **Moderate** | 2 ≤ score < 4  *(also: score ≥ 4 but backbone = No — another platform is the real engine)* |
| **Less** | 1 ≤ score < 2  *(scaffold / branding / minimal)* |
| **None** | score < 1, or overclaim, or inaccessible |

## Backbone rule  *(deterministic from the metrics)*
- **Yes** — ≥1 **called** pipeline that runs orchestration/reasoning (`agent_*` or `llm_*`), OR hosted/
  live-engine/webhook usage; AND no competing AI runtime. (A data/gateway platform like Butterbase/
  Supabase/Pinecone does **not** demote.)
- **Partial** — the above holds but a **competing AI runtime** (`langchain`, `crewai`) is also present.
- **No** — no called pipeline and no hosted/engine usage.
- **Coupled to the verdict:** if the Tag is **None or Less** (no real usage), backbone is forced to
  **No** — a project that barely uses RocketRide cannot be its backbone. So **None + Yes is impossible**.

---

### Worked examples (validated in `eval/engine.py` fixtures + live)
| Repo shape | Score | → |
|---|---|---|
| **constructor** (dep + 1 called agent-pipeline, 7 nodes, spread 2, 8 call-sites, hosted) | **7.0** | **Significant / Yes** |
| **NOUS** (11 agent pipes auto-generated + run via a generic runner `client.use(filepath=<var>)`) | ~23.5 (capped) | **Significant / Yes** |
| **persona** (4-node pipe called from **Rust** via a webhook — cross-language + SDK-less HTTP) | 2.0 | **Moderate / Yes** |
| **VibePairing** (in-code + committed `.json` pipeline, called via `client.use({pipeline:…})`) | 5.0 | **Significant / Yes** |
| **for-show** (a `.pipe` present, never called, **and no SDK/engine call anywhere**) | **0.0** | **None** (penalised) |
| **dead-code + phantom hosted** (empty `.pipe`, never called, bare hosted env only) | **0.0** | **None / No** |
| **scaffold-only** (`.claude/rules` only) | 0.0 | **Less** (capped) |
| **hosted-only** (Cloud usage, no local pipe) | 3.0 | **Moderate / Yes** |
