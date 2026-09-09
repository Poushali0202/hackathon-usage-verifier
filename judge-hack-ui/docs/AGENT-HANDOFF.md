# Judge Hack — agent handoff (entire conversation)

**Audience:** the next agent (or human) continuing this work. Reconstructs **one Cursor chat** from Sunday 30 Aug 2026 11:47 PT through Friday 4 Sep 2026 08:53 PT.

**Transcript (192 user turns, 1385 JSONL lines, tool traces):**  
`C:\Users\Poushali\.cursor\projects\c-Users-Poushali-OneDrive-RocketRide-Inc-Desktop-RocketRide-Repositories\agent-transcripts\a5685dc3-7935-49af-a64d-88de3fdd82f3\a5685dc3-7935-49af-a64d-88de3fdd82f3.jsonl`

**Earlier Claude Code backup this chat ingested:** `C:\Users\Poushali\Downloads\claude-session-backup.jsonl`

Do **not** treat this file as permission to commit, push, publish `@team`/`@public`, attach personal Postgres, invent Stripe `price_*`, or start Stage 4 unless the user asks.

---

## 0. Snapshot right now (4 Sep 2026)

| Item | Value |
|---|---|
| Workspace | `c:\Users\Poushali\OneDrive - RocketRide Inc\Desktop\RocketRide Repositories` |
| App | `apps/judge-hack-ui` · preview `judge-hack.rrapp` |
| App id | `hackjudge.judge-hack` · npm `hackjudge-judge-hack@0.1.0` |
| Publisher / developerId | `hackjudge` |
| Staging org | **Poushali's Workspace** |
| Staging URL | `https://staging.rocketride.ai` |
| Coupon | `HACKANAPP` (redeemed 1 Sep) |
| Publish | `publishApp @me` **v10** (3 Sep) |
| Stage 0 | Done |
| Stage 1 | Done (deploy-ops / live metrics deferred by product) |
| Stage 2 | Done (`validate` / `deployTo` / `verifyApp` / `addApp` / `@me`) |
| Stage 3 | **Wired, not signed off.** Engine SQL broker unset staging **and** prod (`rocketride-server` **#2203**, Dmitrii). App correctly stays on workspace `appState`. Personal Postgres is **not** used. |
| Stage 4 | **Not started.** Marketplace sign-off + `@me` → `@team` → `@public` via review. |
| Tests last known | Vitest **51** passed, evaluator `test_stage1.py` OK, `tsc --noEmit` clean |
| OS | Windows 10; PowerShell — use `npm.cmd` / `node`, **not** `npm.ps1` |

Judging **works** on `@me`. The app is **not** stuck on first deploy. Official Stage 3 SQL is blocked on platform wiring, not app code.

---

## 1. What this app is

**Judge Hack** verifies how hackathon GitHub repos use a target product.

- **RocketRide preset** = pipeline/RAG rubric (deterministic Python).
- **Custom targets** = eight generic SDK/platform signals. Architecture templates are a **view** of those signals, not a new scorer. The UI tower is always **5 isometric layers**; only labels change.
- The LLM **never** writes tag, backbone, or score. Explain fills “What it is” / “How used” / “Verdict rationale” after the verdict.
- Original product: `Projects/hackathon-usage-verifier` (FastAPI + Vite). SoT for eval: `eval/engine.py`, `target.py`, `extract.py`, `SCORING_SPEC.md`. Snapshotted into `apps/judge-hack-ui/src/verify/generated/evaluatorBundle.ts` via `tools/gen-evaluator-bundle.mjs`.
- **Wrong/old scaffold:** do **not** use `apps/hack-judge-ui` (`local.hack-judge`).
- **100% RocketRide catalog usage is a hard rule** (user, 31 Aug). Custom `hackjudge_*` nodes are **not** for v1. A generic `repository_evidence`-style node was deferred to v2 if Daytona load-bearing fails in production.
- Fail-closed: never give a verdict on partial retrieval / truncated payload. Show failed.

Signed-in identities seen: `poushalipurkayastha24@gmail.com` (probes) and `poushali.debpurkayastha@gmail.com` (Dashboard).

---

## 2. Hard constraints (still in force)

- Never invent Stripe `price_*`. Manifest: Developer 2000¢ / Company 10000¢ / Organizers 20000¢ USD, `interval: "one_time"`.
- Never `new RocketRideClient()` **in the app**. Probe/publish scripts in `tools/` may construct a client from workspace `.env`.
- No `localStorage` for durable state. Prefs: `usePrefs()` (`hj.theme`, `hj.view`, `hj.runId`, `hj.plan` fallback).
- No `hackjudge_*` custom nodes. Catalog only. `tool_python` has **no network**; Daytona is the sandbox.
- Sign-in is shell-gated (`authenticated: true`). Checkout is in-app dialog (`CheckoutHost`), not a hanging `shell:subscribe` from Design preview. Live Stripe only if Store prices exist.
- Fail-closed on inaccessible / incomplete repos.
- Do not commit unless the user asks.
- Do **not** set `ROCKETRIDE_HACKJUDGE_PG_*` or deploy `hackjudge_sql_v1.external.pipe` / `storeVariant=external` unless the user **explicitly** overrides after the broker is still down **and** product agrees. **Today: do not.** Early in this chat (30 Aug) personal Supabase **was** used for a throwaway `db_postgres` probe; Stage 3 later reversed that.
- Do not start Stage 4 unless asked.
- Windows: `npm.cmd test`, `npm.cmd run stage2`, `npm.cmd run sql-probe`.
- Design canvas may rewrite `project_id` on watched `pipelines/` folders. Pins live in `tools/gen-pipes.mjs`. Runtime Daytona/SQL **clone** `project_id` on `client.use()`. Re-run `node tools/gen-pipes.mjs` to restore pins; tests run `gen` first.

---

## 3. People

| Who | Role |
|---|---|
| Poushali Deb Purkayastha | App owner; this conversation |
| Shashidhar Babu | App-side / Stage 1 taste + migration checklist (`shashidhar.babu@rocketride.ai`). Gemini notes: `C:\Users\Poushali\Downloads\Judge Hack App - Poushali - 2026_09_01 13_44 PDT - Notes by Gemini.md`. Design skills: https://github.com/shashidharbabu/claude-design-skills |
| Dmitrii Karataev | Staging outage, server build, **DB broker**, release train. Issue **rocketride-server #2203**. |
| Dylan | Catalog-only; rejected Judge-Hack-specific custom nodes for v1 |
| Joe | Memory Meets Motion sheet (~30 unique GitHub URLs) used as scale test |

**Shashi one-liner Poushali asked for (generic, not broker-jargon):**  
“Facing an issue signing in to the RocketRide managed database on staging, so run history can’t move off the workspace yet.”

---

## 4. Overlay docs (source of stages)

`C:\Users\Poushali\Downloads\app-development-docs\app-development-docs\`

- `00-INDEX.md` — stages 0–4
- `03-migration-to-staging.md` — Stage 2 = §6–§9
- `05-data-migration.md` — Stage 3
- `06-ready-to-deploy-checklist.md` — Stage 4 packet for Shashi

Also used: `C:\Users\Poushali\Downloads\docs` (browser docs dump). Platform: workspace `.rocketride/docs/` (`ROCKETRIDE_APPS.md`, `ROCKETRIDE_PIPELINES.md`, TypeScript API `client.database`). Public node doc: `https://docs.rocketride.org/nodes/rocketride_sql.md`.

---

## 5. Pipes, secrets, publish

Stable IDs pinned in `tools/gen-pipes.mjs` (`PROJECT_IDS`):

| Pipe | `project_id` | Notes |
|---|---|---|
| Judge Hack Daytona V1 | `bde4acbb-7db2-4a97-8d01-28214a1bc284` | Dummy `agent_rocketride` so `tool_daytona` can be `client.tool`. Agent must not invent JSON. |
| Judge Hack Explain V1 | `cf2762a0-ee71-4f77-9d99-1296e81e71b4` | Post-verdict prose only |
| Judge Hack SQL V1 | `8e2a6c14-b7f1-4d93-9a50-1c4e8f2d7b36` | `rocketride_sql`, node id **`sql_1`**, `allow_execute: true` |
| SQL external (generated only) | `c5d9e2b8-1a47-4f06-8d3c-9b7e0a4f2c18` | `db_postgres` placeholders `${ROCKETRIDE_HACKJUDGE_PG_*}` — **not deployed** |

Canonical copies: `apps/judge-hack-ui/src/pipelines/`. Workspace `pipelines/` is for disk tooling. After v10 publish, Design rewrote SQL default in `src/pipelines` to `116582bb-a601-42ef-ba54-bd654592850f` and the workspace copy to `e8f7e295-89fc-4630-931d-e65d830dcde6`. Runtime clones anyway.

**Secrets (Environment overlay; USER-scope historically, org needed before `@team`):**  
`ROCKETRIDE_ANTHROPIC_KEY`, `ROCKETRIDE_DAYTONA_KEY`, `ROCKETRIDE_GITHUB_TOKEN`.

Leftover `ROCKETRIDE_HACKJUDGE_PG_*` may still exist from the 30 Aug probe — **do not use**. `.env.example` comments them as unused.

No `deploy.setSchedule`.

Publish path: `node tools/stage2-publish.mjs` → gen → validate → `deploy.add({ deployTo })` → `verifyApp` → `addApp` → poll `buildStatus: 'ok'` → `publishApp(..., '@me')`. Flags: `--validate-only`, `--verify-only`, `--skip-pipes`, `--skip-app`. Known versions: v4 explain-parse, v6 Daytona clone-per-sandbox, v7/v8 Stage 2 packs, **v10** SQL wiring + tower CSS + store banner.

Design `.rrapp` preview is **not** the shareable app. Switcher `@me` is.

---

## 6. Scoring / evaluator (load-bearing product)

Evaluator SoT remains Python in the sandbox. TypeScript does not reimplement scoring.

**Hopper 1.0 was too low.** Harvest missed `rocketride` in workspace `packages/*/package.json` (only first 8 manifests) and missed `client.use({ pipeline })` without a canvas `.pipe`. Falkor `pipelines/*.pipe.json` (Cypher) correctly ignored.

Engine now (`eval/engine.py`, bundled):

- `_manifest_paths()` — up to 24 manifests, root then workspace packages
- Synthetic `<in-code pipeline>` when inline `client.use({ pipeline })` and no called RR pipe
- `import('rocketride')` counts toward file spread

Fixture: `eval/fixtures/inline-monorepo.json`. Expected Hopper: **Significant / Yes / ~4.5**.

Joe Memory Meets Motion sheet (~30 unique URLs). Known expected 404s: `KrambitPL/ai-native-trading`, `Mr-Shockwave/Trailbridge`, `jymiller/hack-memory-motion`, `catiemcnama/memoryhack`. Atrium **10.0 → Moderate / No** is spec (Significant gated on backbone). Live switcher: Hopper Significant / 4.5 / Backbone Yes, `in-code pipeline` (5 nodes), real explain prose. Later run **nnnn**: 30/30, 14 Significant, ~2m23s.

**Architecture templates** (Shashi, 1 Sep): do **not** judge Laserdata/Butterbase on RocketRide RAG layers. Custom products use 8 generic signals; 5-layer tower is branding with **labels only** changing. User insisted: do not restyle the isometric tower.

Shashi Slack label pass: product pills **Code / SDK**, **Platform / hosting**, **API / service**. Target tabs: **In their code**, **If they hosted on you**, **How we score**. Fields: `src/pages/Targets.tsx` (`CODE_FIELDS`, `PLATFORM_FIELDS`, `SCORE_SIGNALS`). Templates: `src/verify/architecture.ts` / `eval/target.py`.

Company/Organizers may persist per-target `weights` / `thresholds`. Developer uses team defaults. User asked that scoring not look “unchangeable” for organizers.

**Explain-parse (v3/v4):** dossiers showed stale “classifier unreachable.” Fix: `src/verify/explainParse.ts` prefers `answers`, sanitizes, never reads tag/backbone/score.

**Daytona pool:** staging keys tasks by `project_id + source`. Second `client.use()` on the same pipe → **Pipeline is already running**. Pool dropped to 1 sandbox. Fix: `clonePipelineForSandbox()` in `src/verify/pool.ts`; `openDaytona` clones pipe + fresh UUID. Probe: `tools/daytona-load-probe.mjs`. Live: 4 sandboxes, 8 repos, ~40s wall. Workers: 4 default; 8 Company/Organizers. One repo per sandbox.

Font: Shashi asked; app still uses `--rr-font-family` (shell). No custom Judge Hack webfont. Mono for scores.

---

## 7. Stage 3 SQL (wired, blocked)

Pathway: existing `rocketride_sql`. **No new node.** Docs: no host/user/password on that node; `allow_execute` required for `client.database.query` / execute. Catalog still requires `invoke.llm` min 1 (dummy agent in the graph).

Files:

- `tools/gen-pipes.mjs` — SQL default + external, shared `sql_1`
- `src/pipelines/hackjudge_sql_v1.pipe` + `.external.pipe`
- `src/verify/sqlSchema.ts` — `hj_runs`, `hj_targets` JSONB; mappers; `shouldImportAppState`; max 40 runs
- `src/verify/sqlStore.ts` — `openSqlStore`, clone pipe, `database.query` then `tool execute` fallback, schema, upsert, import, prune
- `tools/sql-probe.mjs` — `npm run sql-probe`
- `src/RunsContext.tsx` — hydrate SQL when connected; import appState if SQL empty; dual-write appState; `store` status
- `src/components/bits.tsx` — `StoreBanner`
- Dashboard, Runs, Settings store copy
- `package.json` — `hackjudge.judge-hack.storeVariant` enum `default` | `external`

**API-key probe:** `ROCKETRIDE_CLIENT_ID is not set; RocketRide cloud DB nodes require a signed-in RocketRide cloud identity`. Doc 05: API-key sessions fail by design.

**Signed-in switcher banner:** *“Staging SQL did not get a signed-in cloud identity (broker). Runs stay in this workspace until that is enabled. Personal Postgres is not used.”*

Dashboard “missing previous runs” is **not** a filter. Design preview vs `@me` can have **separate appState**. Cap 40. Until SQL works, history is workspace-local.

### Dmitrii Slack (3 Sep evening; pasted 4 Sep)

Poushali 3:53 PM: enable staging SQL broker for org (Poushali’s Workspace / `hackjudge`) so `rocketride_sql` works from signed-in app; `@me`; `ROCKETRIDE_CLIENT_ID`; no personal PG; need `SELECT 1`.

Dmitrii 7:30 PM: first thought = org `hackjudge` lacked a cloud SQL identity in staging data-core.

Dmitrii 8:13 PM: **platform-wide**. `rocketride_sql` reaches data-core via engine broker (`ROCKETRIDE_DB_BROKER_URL` + token). **Unset on staging and prod.** Data-core DB + provisioner exist; **engine→broker wiring never done.** No tenant can resolve a DB. Enabling is real integration + security (broker credential can resolve any tenant DB; TLS + scoping; signed-in identity must flow to the task). Plan: **rocketride-server #2203**. Will ping when staging cloud SQL is live. Not a tonight toggle.

**Clarifications already given:**

- Apps do **not** set `ROCKETRIDE_DB_BROKER_URL`; the **engine** does. Node asks broker “this org → which tenant DB?”
- Until resolved: workspace `appState`, **not** personal Postgres.
- App is **not** stuck on deployment; `@me` is live. Blocked: Stage 3 SQL history / checklist sign-off. Judging still works.
- Stage 4 = marketplace sign-off + `@me`→`@team`→`@public`, not first deploy.

### When Dmitrii says staging SQL is live

1. Open published Judge Hack from switcher (latest `@me`, no `dev` badge).
2. Banner should become: runs live in staging-managed SQL (maybe “imported N workspace row(s)”).
3. Confirm `nnnn` / other appState runs imported or re-run a small batch; Dashboard counts match.
4. Confirm Design and switcher see the same history.
5. API-key `sql-probe` may still fail; OK if signed-in app works.
6. Do **not** deploy external `db_postgres`.
7. Then tick Stage 3; Stage 4 only if asked. Finish leftover doc 05 boxes (inventory note, leftover PG env keys removed). Org secrets before `@team`.

CONTRACT gate 3 (SQL counts after import) is **open**.

---

## 8. Architecture (runtime)

```
Judge UI (shell AppLayout)
  → useAuthUser / useWorkspace / usePrefs / useSubscriptions
  → RunsContext: appState always; rocketride_sql if broker injects identity
  → Verify: client.use(cloned Daytona pipe) → client.tool Daytona → Python evaluator bundle
  → Explain: client.use(explain pipe) → Anthropic; parse answers only
```

Pages: Dashboard, Targets, New run, Quick verify, Runs / run detail, Settings, Plans.

Bindings inventory: `docs/BINDINGS.md`. Contract: `docs/CONTRACT.md`.

Plan is entitlement from `useSubscriptions()`, not a user-editable setting. Unsubscribed/past_due → Developer; `free`/`auth`/no prices → `hj.plan` pref so workspace stays usable. Company-gated features also unlock for Organizers (`isCompanyPlan`).

---

## 9. File map

| Path | Why |
|---|---|
| `tools/gen-pipes.mjs` | Only owner of `.pipe` graphs + pinned IDs |
| `tools/gen-evaluator-bundle.mjs` | Python → `evaluatorBundle.ts` |
| `tools/stage2-publish.mjs` | validate, deployTo, verifyApp, addApp, publish `@me` |
| `tools/sql-probe.mjs` | API-key SELECT 1 (expected fail until engine broker) |
| `tools/daytona-load-probe.mjs` | 4-sandbox load probe |
| `src/verify/session.ts` | Batch verify + pool |
| `src/verify/pool.ts` | Worker count + clonePipelineForSandbox |
| `src/verify/daytonaInvoke.ts` | Daytona tool invoke |
| `src/verify/explain.ts` / `explainParse.ts` | Post-verdict prose |
| `src/verify/architecture.ts` | 5-layer templates as view of signals |
| `src/verify/sqlSchema.ts` / `sqlStore.ts` | Stage 3 store |
| `src/RunsContext.tsx` | Runs/targets/settings/store hydrate |
| `src/components/Tower.tsx` + `app.css` | Backbone tower + Load-bearing layout |
| `src/components/ResultsGrid.tsx` | Run results |
| `src/components/bits.tsx` | `StoreBanner` |
| `src/pages/Targets.tsx` | Custom target editor / Shashi labels |
| `src/CheckoutHost.tsx` / `billing.ts` | Plans / subscribe dialog |
| `docs/CONTRACT.md` / `BINDINGS.md` | Pinned migration decisions |
| `package.json` `appManifest` | id, billing, settings including `storeVariant` |
| `Projects/hackathon-usage-verifier/eval/` | Evaluator SoT |

Commands from `apps/judge-hack-ui`:

```text
npm.cmd run gen
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run sql-probe
npm.cmd run stage2
```

---

## 10. Stage 4 (not started) — what it is

Doc `06-ready-to-deploy-checklist.md`:

- Switcher launch (no `dev`) — largely done for `@me`
- First-run / empty states for a fresh user
- Every write path; scheduled pipes (none here)
- Error states (broker banner already exists)
- Icon / README / categories in listing
- Publish: `@me` → `@team` → `@public` via review. **Org secrets before `@team`.**
- Migration notes to Shashi (diverge: no custom node; SQL blocked on #2203; `appState` until broker)

User asked 3 Sep: can they share / publish `@team` now? Answer then: `@me` only until Stage 4; `@team` needs org-scope secrets. Doc does require `@team` before `@public`, but **not** immediately after Stage 2.

---

## 11. Full chronology (this conversation)

Duplicate/system turns (dynamic-tool catalog injects, “Briefly inform the user”) omitted. Screenshots were frequent; outcomes are what the agent confirmed after looking at them.

### Sunday 30 Aug 2026 — Stage 0 environment + first pipe probes

1. User: analyze overlay docs and guide all steps. Agent walked Stages 0–4 against Judge Hack.
2. Ingest `claude-session-backup.jsonl`; continue from prior Claude session. Objective: migrate hackathon-usage-verifier into a RocketRide shell app on staging.
3. Dylan / Phase-2 vision: catalog nodes only; no Judge-Hack-specific custom node for v1.
4. First step: Stage 0 environment (extension, Cloud, developerId), not pipelines yet.
5–10. Cursor-new-user friction: do **not** open a nested folder as a new window (kills the chat). Keep parent workspace. Install RocketRide extension. Cloud connect, not Direct (Direct wants API key). Sign-in is in the RocketRide sidebar, not Cursor Account.
11–12. Follow overlay docs exactly. Browser dump at `C:\Users\Poushali\Downloads\docs`.
13–18. Direct Connect API-key confusion; Cloud mode succeeded; URL/org mismatch then Connected; empty Apps until developerId.
19–24. Deploy tab vs Apps tab. Hack Judge not listed until new app scaffold. User got `developerId=hackjudge`. **OK to create a new app** (`hackjudge.judge-hack` in `apps/judge-hack-ui`), not reuse `local.hack-judge`.
25. Agent ran scaffold/connect commands. 26. Stage 0 in progress. 27. `.rrapp` opened correctly → remaining Stage 0 then Stage 1.

Evening: catalog vs quality. User asked if catalog can do the whole app. Agent: yes for v1 with Daytona + explain + later SQL. User: go ahead with catalog/schema validation and throwaway staging probe.

32. Can PostgreSQL node be used instead? (of rocketride_sql / later of custom). 33–34. Next steps in order. 35. How to resolve database-node routing in staging. 36. Create `.pipe` yourself.

37–44. Canvas/pipe errors; user didn’t declare `ROCKETRIDE_HACKJUDGE_*` vars (agent invented names for probe). Switch probe to `rocketride_sql`. Pipe not visible until generated/opened. Errors then “fixed, run it.” `rocketride_sql` failed without cloud identity.

45. Can we migrate without it? Yes for Stage 1–2 (`appState`). SQL is Stage 3.

46–57. User preferred `db_postgres` and asked for credentials. They used **previous Supabase** credentials; agent switched probe to `db_postgres`; Design wouldn’t open pipe; user found Supabase dashboard secrets; paid-tier vs free-tier; probe eventually **Perfect**.

**Later product decision reversed this.** Do not treat that successful personal-PG probe as the production store.

58–60. Proceed with app migration; rebuild backend on catalog. Go ahead.

61. Agent+`tool_python` safer? 62. Custom node if needed must be **generic**, only if no catalog combo works. 63. Truncated data in Phase 0/1 with `tool_python` / `tool_github`. 64. USP = latency + accuracy + GitHub freshness. 65–67. Production B2B: Daytona vs custom; **100% RR usage is a hard rule**. Plan: **v1 Daytona**, v2 generic evidence node if needed. 68. Execute Daytona plan on `judge-hack.rrapp`. 69. Where to get Daytona key. 70. Overlay secrets added.

### Monday 31 Aug — Stage 1 UI fidelity, fail-closed, billing

71–76. Canvas/env UI confusion; “Fix it now.” 77. Preview looked unlike Judge Hack. Agent: scaffold was generic; need original Phase 2 UI. 78–79. Go ahead.

80. Cross-verify results; New target not clickable. 81–82. Summary cropped; target prefill from public repo/manifest missing. 83. Exact UI scaffolding complete? 84. Want **exact original** UI. 85–86. Dark theme toggle no-op; need original Phase 2 UI. 87. Preview error — fix. 88–90. LLM summary skipped; user wants What it is / How used back; still missing. 91–92. Almost all repos failed — debug.

93. Payment/auth/billing vs overlay docs. 94. Which stage? Stage 1 in progress. 95–96. Finish Stage 1 gaps. 97. No Sign In / checkout in preview (`authenticated: true` is shell-gated). 98. Checkout unclear; is migration complete? 99. Sign-in spin forever — Design vs published; in-app dialog instead of hanging `shell:subscribe`. 100. Conversational team update on Stage 1 + why v2 custom node. 101. Preview errored — fix.

102–104. UI “disoriented”; dashboard look changed; left panel (Run, Target) missing — restore AppLayout sidebar. 105. Platforms / API tabs not clickable on Targets. 106. Rubric/matrix LLM vs deterministic? **Deterministic engine**; LLM explain only. 107. Test Laserdata target vs Laserdata repo. 108. Failed — debug. 109. **Never verdict on partial retrieval; fail closed.** 110–111. Failed again — fix once and for all.

### Tuesday 1 Sep — architecture templates, Shashi Stage 1 close

112. Shashi: would Laserdata be judged by RAG pipelines? Butterbase too? 113. Many products, different layers. 114. How to test. **Decision:** generic 8 signals + architecture **templates as a view**; do not score Butterbase as RocketRide RAG.

115–116. 5-layer labels overflow into text box — fix. 117. Suggest another product category for label testing (Vercel-style hosting used). 118. Verdict + tower disoriented / not 5 layers — justify + fix. 119. **Do not change 5-layer isometric brand; only labels change.** 120. Draft Shashi reply (Vercel + Laserdata screenshots). 121. How unknown products are handled (templates + 8 signals, organizer describes product). 122–123. Stage vs overlay docs: **Stage 1**, Stage 0 already done. 124. Daytona load-bearing vs custom node necessity — probe later (done 3 Sep: clone-per-sandbox, no custom node).

125. Analyze Gemini notes of Shashi Stage 1 call. 126–128. Apply Shashi asks + https://github.com/shashidharbabu/claude-design-skills **except** “Deploy metrics need a backing pipeline.” Taste/copy pass; skills used as guidance, not a new webfont. 129. Scoring UI “unchangeable?” 130. Organizers/companies **should** customize weights/thresholds. 131–132. Finish remaining Stage 1 except deploy-ops. 133. `HACKANAPP` redeemed. 134. You can start (Stage 2 pipes).

### Wednesday 2 Sep — Stage 2, Joe sheet, parallel Daytona, explain-parse

137. Explain Stage 2 simply. 139. Where is deterministic eval; what must Poushali do for Stage 2? (eval in bundled Python; she sets org env secrets, opens Design, republishes). 140. Where is org Environment overlay. 141–142. 3-bullet scrum, conversational. 143. What are Stage 3 & 4? 144. Secrets under user Environment, not org. 145. Why this error (pipe/deploy). 146. Check Stage 2 terminal. 147. Shashi Slack: AI slop, billing/auth, Joe submissions at scale, other companies, Friday demo timeline. 148. 30 repos would take half a day? Sequential Daytona yes — **real issue**. 149. Parallel multiple Daytona sandboxes (USP = minutes for 40–50 repos). 150. Go ahead with pool.

152. Republish successful? 153. What is the app switcher? 154. Is Stage 2 complete? Not until switcher smoke. 155. Screenshot. 156. Multiple repos, **no LLM write-up**. 157. Fix robustly with guardrails. 159. Republish a pass? 160. Where is LLM write-up; is scoring correct? 161. Was latest run completely correct?

### Thursday 3 Sep — Hopper, load-bearing, sharing, Stage 3

162. Verdict + LLM write both correct? Hopper still low until engine harvest fix. 163. Go ahead and fix (manifest harvest + in-code pipeline). 164. Verify all repo runs in latest run. 165. Load-bearing Daytona / custom node decision now. 166. Is the real load-bearing bug fixed? (clone `project_id`; yes after v6). 167. Can I share the app for testing? `@me` / switcher for self; teammates need `@team`. 168. Publish `@team` now? Not yet. 169. Do docs require `@team`? Yes before `@public` (Stage 4), not immediately. 170–172. Slack copy for Shashi on target categories (Code/SDK, Platform, API) — more detailed Q&A structure; titles as categories in-app.

173. Tracking sheet copy-paste (do **not** leave “Getting PR merged for custom nodes / Need auth + billing”).

174/176. Did we mention changing the font? Shashi asked; **not shipped** as custom typeface. 177. Stage 2 completed end to end? Playbook yes; SQL/font/`@team` are other stages. 178. Staging switcher screenshot (MMM / Hopper Significant 4.5 Backbone Yes). 179. Load-bearing tag colliding with labels below — CSS fix (`Tower.tsx`, `app.css`). 180. Previous runs not on Dashboard — appState isolation, not a filter. 181. Go ahead with Stage 3. 182. Is everything in Stage 3 docs completed? Wired; probe failed. 183. App screenshot with broker banner. 184. What to ask Dmitrii. 185–186. One-line for Shashi, generic (not `ROCKETRIDE_CLIENT_ID`).

### Friday 4 Sep — broker understanding + this handoff

187. Pasted full Slack with Dmitrii (#2203, broker unset staging+prod). 188. Is understanding correct that org SQL hits staging shared DB via `ROCKETRIDE_DB_BROKER_URL` unset on staging & prod? **Engine** broker, not app env; data-core exists; wiring never done. 189. Until resolved, using personal Postgres? **No — `appState`.** 190. Stuck because next step is deployment? **No.** `@me` is deployed. Stuck on Stage 3 SQL checkbox. 191. What is Stage 4? Marketplace checklist + `@team`/`@public`. 192. **This file.**

---

## 12. Tracking sheet (copy-paste)

```
hack-judge	Judge Hack	Poushali	Tech	Active	Development	Stage 2 done. Published @me v10. Auth + billing declared. No custom node. Eval proven on Joe sheet + 4-sandbox Daytona. Stage 3 SQL wired but blocked: engine SQL broker unset on staging/prod (rocketride-server #2203, Dmitrii). Runs in appState. Next: broker then SQL verify; then @team.		Yes	Granted	No
```

---

## 13. What the next agent should not do

- Do not “fix” SQL with Supabase / personal PG / `DATABASE_URL` / `storeVariant=external`.
- Do not build `hackjudge_*` nodes.
- Do not treat Design preview as the published app.
- Do not claim Stage 3 complete until signed-in hydrate is green.
- Do not restyle the 5-layer isometric tower; labels only.
- Do not let the LLM write tag/backbone/score.
- Do not verdict on partial clone/payload.
- Do not publish `@team`/`@public` or commit unless the user asks.
- Do not skip `npm.cmd run gen` before tests/publish.

---

## 14. Remaining if asked

1. Wait for Dmitrii: staging cloud SQL live → switcher verify banner + import + CONTRACT gate 3.
2. Confirm leftover `ROCKETRIDE_HACKJUDGE_PG_*` removed from Environment overlay.
3. Promote secrets to **org** scope before `@team`.
4. Stage 4 only if asked: switcher smoke, first-run, write paths, listing, `@me`→`@team`→`@public` via review, notes to Shashi.
5. Optional later: custom typeface (shell-token exception); live Stripe prices; deploy-ops metrics pipeline (explicitly deferred).
6. v2 only if Daytona cannot meet production load: generic repository-evidence node (Dylan bar: not Judge-Hack-specific).
7. Do not commit unless asked.
