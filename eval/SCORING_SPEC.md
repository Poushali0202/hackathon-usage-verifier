# Deterministic Scoring Spec — APPROVED

The evaluation engine (`eval/engine.py`) measures every signal below **deterministically** (parsing
`.pipe` files + scanning source, no LLM). The score → Tag; the LLM only writes the human explanation.
Backbone is a rule (bottom). Weights approved 2026-07; example values are real, from
`github.com/ramizik/constructor`.

Score is a **small-point scale** (0 → ~7), not 0–100. `Raw score = Σ(signal × weight) − penalties`,
floored at 0.

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
| B1 | **each pipeline actually called** (proven `client.use/send/chat` referencing it) | 1 of 1 | **+2.0** each |
| B2 | **PENALTY: pipeline present but NEVER called** | 0 | **−1.0** each |
| — | *(A2/A3/A4 only score for **called** pipelines — an uncalled pipeline earns nothing + is penalised)* | | |

## C. SDK usage depth  *(how pervasive, vs a single relay file?)*
| # | Signal (deterministic) | constructor | weight |
|---|---|---|---|
| C1 | **dependency in a manifest** (`rocketride` in package.json / requirements) | yes | **+1.0** |
| C2 | **≥3 SDK call-sites** (`RocketRideClient`, `client.use/chat/send/connect`) | 8 | **+0.5** |
| C3 | **≥2 files use RocketRide** (spread, not adapter-only) | 2 | **+0.5** |
| C4 | **hosted / Cloud usage** (hosted-pipeline id/env, `ROCKETRIDE_API_KEY`, adapter) | yes | **+1.0** |

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
  live-engine usage; AND no competing AI runtime. (A data/gateway platform like Butterbase/Supabase/
  Pinecone does **not** demote.)
- **Partial** — the above holds but a **competing AI runtime** (`langchain`, `crewai`) is also present.
- **No** — no called pipeline and no hosted/engine usage.

---

### Worked examples (validated in `eval/engine.py`)
| Repo shape | Score | → |
|---|---|---|
| **constructor** (dep + 1 called agent-pipeline, 7 nodes, spread 2, 8 call-sites, hosted) | **7.0** | **Significant / Yes** |
| **for-show** (dep + a `.pipe` that is never called) | **0.0** | **None** (penalised) |
| **scaffold-only** (`.claude/rules` only) | 0.0 | **Less** (capped) |
| **hosted-only** (Cloud usage, no local `.pipe`) | 3.0 | **Moderate / Yes** |
