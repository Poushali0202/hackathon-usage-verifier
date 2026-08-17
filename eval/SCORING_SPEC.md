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

## D. Disqualifiers / caps / event-integrity flags
| # | Rule | Effect |
|---|---|---|
| D1 | **scaffold only** (`.claude/rules/rocketride.md`, no dep/pipe/call) | Tag capped at **Less** |
| D2 | **overclaim** (feedback claims RocketRide, zero code evidence) | force **None** |
| D3 | **inaccessible** (repo 404 / private) | force **None**, flag for review |
| D4 | **reused pipeline** — a CALLED pipeline first committed before the event window (event date ± 2 days; only checked when an event date is set) | **−1.0** flat + ⚠ flag, "Built on" shown per pipeline |
| D5 | **project predates event** — ANY commit before the window start (old project + event-day commits; `?until=` query, so repo age can't hide it) | **−(judge-set penalty)** + loud ⚠ flag showing earliest commit + latest pre-window commit |
| D6 | **history tampered** — a commit's committer date is in/after the window but its author date is older (git's own record of a rebase/amend re-stamp) | **−(judge-set penalty)** + loud ⚠ flag with sha + both dates |

**Judge-set history penalty** (D5/D6): configurable per run (UI "Pre-event work penalty", CLI
`--history-penalty`; default **2.0**). `0` = flag only; a large value effectively disqualifies. The
verdict is never auto-forced — the deduction runs through the normal score → tag thresholds, so the
call stays with the judges. *Limit:* a forger who rewrites both git dates in a fresh repo leaves no
metadata trace — cloud run-telemetry (Phase 2) is the airtight check.

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

## G. Target-agnostic generic path (M3)

Any target that is not the RocketRide preset (`pipeline_scoring=false`) scores through a
target-agnostic path driven entirely by its TargetConfig (eval/target.py; user configs are
literal tokens, never raw regex). Signals and default weights:

| Signal | Points | Fires when |
|---|---|---|
| dependency | 1.0 | a dependency name appears in a manifest |
| invocation | 1.5 | >= 3 invocation call-sites in code |
| invocation_deep | 1.0 | >= 8 call-sites |
| api_usage | 1.5 | a runtime API host/path of the target is called |
| hosted | 0.5 | env/key markers wire the target in |
| file_spread | 0.5 | >= 2 files touch the target |
| artifact | 1.0 | a target config file/dir is committed |
| platform_deploy | 1.5 | a deploy-domain link in code/README |

Thresholds identical (Significant 4.0 / Moderate 2.0 / Less 1.0); backbone Yes/Partial/No via
the target's own competitor list; D5/D6 commit-history flags and the judge-set penalty apply
unchanged. The RocketRide preset path is byte-identical to pre-M3 (fixture parity: all 10
legacy fixtures + generic fixture `generic-target-baas.json`).
