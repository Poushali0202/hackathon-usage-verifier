# Judge Hack — agent handoff

**Audience:** the next agent or human. One Cursor chat from **Sun 30 Aug 2026** through **Wed 9 Sep 2026**.

**Transcript:** `C:\Users\Poushali\.cursor\projects\c-Users-Poushali-OneDrive-RocketRide-Inc-Desktop-RocketRide-Repositories\agent-transcripts\a5685dc3-7935-49af-a64d-88de3fdd82f3\a5685dc3-7935-49af-a64d-88de3fdd82f3.jsonl`

**Earlier Claude backup ingested 30 Aug:** `C:\Users\Poushali\Downloads\claude-session-backup.jsonl`

Do **not** treat this file as permission to commit, push, publish `@team`/`@public`, attach personal Postgres, invent Stripe `price_*`, or start Stage 4 unless the user asks.

---

## 00. Update (23 Sep 2026) — Daytona and git clone retired

Everything below that says "Daytona", "sandbox", or "clone" is history. Current runtime:

- **Runtime:** catalog `tool_python` (`hackjudge_python_v1.pipe`, pin `3f6b9d2e-5c41-4a8f-9e07-6d2b8c1a4f53`, node `python_1`, `allowedModules: urllib, html`, `timeout 900`). The evaluator runs in-process on the engine under RestrictedPython. No sandbox, no subprocess, no disk. `tool_daytona`, `ROCKETRIDE_DAYTONA_KEY`, and `hackjudge_daytona_v1.pipe` are gone.
- **Fetch:** GitHub REST (`/repos`, recursive `git/trees` fail-closed on `truncated`, `/languages`, `/commits?until=`) + `raw.githubusercontent.com`, all through `restricted_shim.make_gh(token)`. This is the fix for Rod's clone concern.
- **Token (Josh/Shashi concern #2):** each judge stores their own PAT as `ROCKETRIDE_GITHUB_TOKEN` in **user** scope from Settings → GitHub access (`src/verify/githubToken.ts`: `getEnv('user')` → merge → `setEnv('user')`, same op as the shell's Environment page; validated with `GET /user` first). `RunsContext` reads it at run start with `getEnv('user')` and `session.ts` passes it as a Python string literal in the `code` input. Missing token ⇒ `GITHUB_TOKEN_MISSING_REASON`, run/prefill/test fail closed, `GithubTokenNotice` links to Settings. Not metered.
- **Bundle:** `tools/build_restricted_bundle.py` (AST transform of `eval/target.py`, `engine.py`, `extract.py` + `src/verify/restricted_shim.py` + `restricted_drivers.py`) → `src/verify/generated/evaluatorBundle.ts` `RESTRICTED_BUNDLE`. `npm run gen` needs a local Python 3. SoT edits for RestrictedPython (`acc[0]` instead of `nonlocal`, no `+=` on subscripts, no `str.format`, no star-tuples) are semantically identical; `eval` tests pass.
- **Result shape:** `{stdout, stderr, exit_code, timed_out, result}`; `parsePythonResult` reads `result` (schema `hackjudge.python.v1`), fails closed on `timed_out`/stderr. Removed `isDaytonaCpuLimit` and the retry-to-1 path.
- **Pool:** `pool.ts` → `workerCount`, `workerTtlSeconds`, `clonePipelineForWorker`, `ORG_SLOTS=5` (still SQL-leased).
- **Deploy:** `stage2-publish.mjs` PIPE_FILES `hackjudge_python_v1.pipe`; PIPE_SECRETS only `ROCKETRIDE_ANTHROPIC_KEY`. Python pipe must be deployed (`npm run stage2` without `--skip-pipes`) before the next `@me`.
- **Open:** confirm on staging that `tool_python` can reach `api.github.com` (local parity via the real `sandbox.py` passed; egress on the engine itself is unverified until the first live run).

---

## 0. Snapshot (10 Sep 2026)

| Item | Value |
|---|---|
| Workspace | `c:\Users\Poushali\OneDrive - RocketRide Inc\Desktop\RocketRide Repositories` |
| Live app (edit here) | `apps/judge-hack-ui` · `judge-hack.rrapp` |
| App id | `hackjudge.judge-hack` · npm `hackjudge-judge-hack@0.1.0` |
| Publisher / developerId | `hackjudge` |
| Staging | `https://staging.rocketride.ai` · org **Poushali's Workspace** |
| Publish | `publishApp @me` **v13** (10 Sep). Schema/execute uses `CAST(... AS jsonb)` instead of `::jsonb` (SQLAlchemy `text()` treats `:jsonb` as a bind and the server returns “SQL execution failed”). SQL pipe pin `8e2a6c14` v3. |
| Stage 0–2 | **Done.** Judging works end to end on `@me`. |
| Stage 3 | **Verified in-app 10 Sep** (published `@me` switcher). Broker fix claimed earlier the same day. Banner = staging-managed SQL; 1 run survived hard reload; custom target `Stage3 SQL Probe` survived reload; Settings → Account is Poushali. Inventory: `docs/STAGE3-INVENTORY.md`. Prod broker not claimed. |
| Stage 4 | **In progress (10 Sep).** Docs: `STAGE4-CHECKLIST.md`, `MIGRATION-NOTES.md`. Blocker before `@team`: copy the three pipe secrets from **user** overlay to **org** (owner, Account → Environment). Then republish `@me` (README + responsive CSS) and `publishApp @team/<name>`. Do not `submitApp` / `@public` unless asked. |
| OS | Windows; use `npm.cmd` / `node`, not `npm.ps1`. |

GitHub (9 Sep push): branch **`rocketride-shell`** on https://github.com/Poushali0202/hackathon-usage-verifier — folder `judge-hack-ui/`. Branch **`phase-2`** is the **old** FastAPI + Vite app (last commit 28 Aug). Local Hopper/`eval` edits in `Projects/hackathon-usage-verifier` were **not** committed.

---

## 1. What this app is

Judge Hack verifies how hackathon GitHub repos use a target product.

- RocketRide **preset** = pipeline/RAG rubric (deterministic Python). Custom targets = **eight generic signals**. Architecture templates only **relabel** a 5-layer isometric tower.
- LLM **never** writes tag, backbone, or score. Explain fills What it is / How used / Verdict rationale after the verdict.
- Original product: `Projects/hackathon-usage-verifier` (`app/` FastAPI, `frontend/` Vite, `eval/`). SoT for scoring: `eval/engine.py`, `target.py`, `extract.py`, `SCORING_SPEC.md` → bundled as `apps/judge-hack-ui/src/verify/generated/evaluatorBundle.ts`.
- Do **not** use `apps/hack-judge-ui` (`local.hack-judge`).
- **100% catalog usage is a hard rule.** No `hackjudge_*` nodes in v1. Daytona for clone+eval (`tool_python` has no network). Dummy `agent_rocketride` exists so `tool_daytona` / SQL execute can be `client.tool`; agent must not invent JSON.
- Fail-closed: never verdict on partial retrieval.

---

## 2. Hard constraints

- No invented Stripe `price_*`. Plans: Developer 2000¢ / Company 10000¢ / Organizers 20000¢, `one_time`.
- No `new RocketRideClient()` **in the app**. Tools under `tools/` may use workspace `.env`.
- No `localStorage`. Prefs: `usePrefs()` (`hj.theme`, `hj.view`, `hj.runId`, `hj.plan`).
- No `shell:loginRequest` from the app (Design preview spun forever). Checkout is `CheckoutHost`, not hanging `shell:subscribe`.
- Do **not** deploy `hackjudge_sql_v1.external.pipe` or set `storeVariant=external` / `ROCKETRIDE_HACKJUDGE_PG_*` unless the user overrides. 30 Aug throwaway used personal Supabase `db_postgres`; **reversed** for Stage 3.
- Pins in `tools/gen-pipes.mjs`. Tests and `stage2-publish.mjs` run `gen` first. Runtime Daytona **clones** `project_id` per sandbox.
- Do not `publishApp @team` until org-scope secrets exist. Do not `submitApp` / `@public` unless the user asks.

---

## 3. People

| Who | Role |
|---|---|
| Poushali | App owner |
| Shashidhar Babu | Migration checklist, taste, Rod thread |
| Dmitrii Karataev | Engine SQL broker, **rocketride-server #2203** |
| Rod Christensen | App Builder feedback (9 Sep). GitHub: OSS `rocketride-org/rocketride-{appid}`; SaaS unusual `rocketride-ai/rocketride-{appId}`. Parallel `use()`: he said `useExisting=true` (does **not** replace clone-per-worker for N sandboxes). Pipe ids: he said agent generated new ids / include pipe in app. Design preview: he does not understand (our proven issue is `shell:loginRequest` spin, not Full Screen). **Local SaaS `feat/app-2`:** admin bootstrap changed — see §3.1. |
| Dylan | Catalog-only; no Judge-Hack-specific custom node |
| Joe | Memory Meets Motion ~30-repo sheet |
| Mansi / Mithilesh | Shashi said they **can** use SQL on staging. Likely **`db_postgres` + credentials**, not `rocketride_sql` + broker. Ask which node before treating #2203 as org-specific. |

### 3.1 Local SaaS admin bootstrap (`feat/app-2`) — Rod, 9 Sep ~9:20 AM

**Does not apply to Judge Hack on `staging.rocketride.ai`.** Only if someone runs the **SaaS backend locally** on branch **`feat/app-2`**.

**Was:** list of admin emails; after login those users got admin.

**Now (multi-org):** a **`.bootstrap`** JSON file creates orgs, teams, roles, and subscriptions on **first creation of the SaaS database** only — not on every start, not for staging cloud.

Rod’s example (his file, not ours — do not copy his admin grants into Judge Hack):

```json
{
	"rod.christensen@rocketride.ai": {
		"sys": ["sys.admin", "sys.app"],
		"defaultOrg": "Platform",
		"orgs": [
			{
				"org": "Platform",
				"role": "admin",
				"devTeam": "Dev",
				"teams": ["Dev", "Prod"],
				"subscription": {
					"plan": "Pro",
					"credits": { "initial": { "tokens": 1000000 } }
				}
			}
		]
	}
}
```

Keys: email → `sys` roles, `defaultOrg`, `orgs[]` with `org`, `role`, `devTeam`, `teams`, `subscription.plan` / `credits.initial.tokens`.

No `.bootstrap` file exists in this workspace today. If Poushali ever runs local SaaS on `feat/app-2`, she needs her own file (her email, her org — e.g. Poushali's Workspace / `hackjudge`), and a **fresh** local SaaS DB create for it to apply.

---

## 4. Pipes (pinned in `tools/gen-pipes.mjs`)

| Pipe | Pin |
|---|---|
| Daytona | `bde4acbb-7db2-4a97-8d01-28214a1bc284` |
| Explain | `cf2762a0-ee71-4f77-9d99-1296e81e71b4` |
| SQL default `rocketride_sql` `sql_1` | `8e2a6c14-b7f1-4d93-9a50-1c4e8f2d7b36` |
| SQL external `db_postgres` (generated, **not deployed**) | `c5d9e2b8-1a47-4f06-8d3c-9b7e0a4f2c18` |

Canonical copies: `apps/judge-hack-ui/src/pipelines/`. Workspace `pipelines/` is Design-watched and **has drifted**.

Secrets (USER overlay today; **org** before `@team`): `ROCKETRIDE_ANTHROPIC_KEY`, `ROCKETRIDE_DAYTONA_KEY`, `ROCKETRIDE_GITHUB_TOKEN`.

---

## 5. Proven vs not (do not overclaim)

### Proven

- **`rocketride_sql` from signed-in `@me` does not store runs.** Banner: *Staging SQL did not get a signed-in cloud identity (broker)… Personal Postgres is not used.*
- **API-key** `npm run sql-probe`: exact `ROCKETRIDE_CLIENT_ID is not set; RocketRide cloud DB nodes require a signed-in RocketRide cloud identity`. Doc 05: API-key fail is by design.
- **Dmitrii:** engine broker `ROCKETRIDE_DB_BROKER_URL` unset on **staging and prod**. Data-core exists; wiring never done. #2203. 8 Sep: open, unassigned, no PR, no timeline; first test tenant when live; do not plan SQL e2e this week.
- **Parallel `client.use()`:** same pipe → `Pipeline is already running`. Staging keys owner + `project_id` + source. Docs (`ROCKETRIDE_APPS.md`) already say start once / `useExisting`. Gap: **N sandboxes need N `project_id`s.** Workaround: `clonePipelineForSandbox()` in `src/verify/pool.ts`. 4 sandboxes, ~30 repos, ~2m23s.
- **On-disk `project_id` drift (4 Sep)** vs generator pins: workspace `pipelines/` all four drifted; `src/pipelines` SQL + external drifted. **Actor not traced** (Design open, first index, or deploy write-back). Rod: “agent generated a new id.” Counter: ids were **pinned** and **still changed**.
- **Design preview + `shell:loginRequest`:** preview went to Sign in required and spun. App no longer emits it. `@me` not asking to sign in is **intended** (already in staging shell).
- **Dashboard 0 runs after SQL was green (10 Sep):** published `@me` skipped applying empty SQL (`if (latest.runs.length)`), so a late workspace hydrate never appeared. SQL store also cloned a new `project_id` per page load (Daytona pool helper — wrong for a durable DB). **Fixed on `@me` v11** (10 Sep): keep workspace rows when SQL is empty; `useExisting` on the pinned SQL pipe. Morning run + Stage3 SQL Probe were already gone from this tenant DB.

### Not proven / do not lead with

- Design vs `@me` **separate `appState`** as a measured two-scope fact. 3 Sep missing Dashboard runs: list is `appState` with no filter. Bidirectional Design↔switcher check **was not done**.
- “`.pipe` emptied by Design” — agent inference, no saved empty file.
- Judge Hack issue is a **connection timeout** — **Shashi mixed threads.** Ours is broker/identity, not timeout.
- Mansi/Mith “SQL works” ≠ `rocketride_sql` broker path until they confirm node + credentials + signed-in app vs canvas.
- `tool_python` “undocumented”: catalog says restricted sandbox; timeout text mentions “network scans” (misleading). Network fetch is Daytona.
- Full-screen vs Sidebar/Status/Tabs **is not Poushali’s issue.** Judge Hack wants `AppLayout`.

---

## 6. Stage 3 leftover

**Switcher verify + inventory done 10 Sep.** See `docs/STAGE3-INVENTORY.md`.

- Banner is staging-managed SQL (not the broker error). This `@me` `appState` was empty — no import, no old `nnnn` rows.
- 1 run and custom target `Stage3 SQL Probe` survived hard reload.
- Account card is Poushali; stamps inferred from that signed-in save path (Design canvas is not a SQL editor).
- Keep `storeVariant=default`. Do **not** deploy the external pipe. API-key `npm run sql-probe` may still fail (`ROCKETRIDE_CLIENT_ID`); that is OK.

Optional leftovers (not required to tick Stage 3): Design vs switcher same-run check; delete the throwaway target; republish `@me` for responsive CSS.

Do not switch to personal Postgres. Prod broker is out of Stage 3.

---

## 7. GitHub (9 Sep)

| | |
|---|---|
| Old app | `phase-2` — FastAPI + Vite, last push 28 Aug. https://github.com/Poushali0202/hackathon-usage-verifier |
| Current shell app | `rocketride-shell` — `judge-hack-ui/` copy of `apps/judge-hack-ui` (no node_modules/dist/.env). https://github.com/Poushali0202/hackathon-usage-verifier/tree/rocketride-shell/judge-hack-ui |
| Commit | `eba36a4` Add the RocketRide shell Judge Hack app… |

Edit **`apps/judge-hack-ui`** in the RocketRide workspace; re-copy/push if Shashi needs GitHub updated. Local verifier checkout may still be on `rocketride-shell` with dirty `eval/` — switch `git checkout phase-2` for old-app work.

Rod location guidance: public OSS `rocketride-org/rocketride-{appid}`; internal SaaS `rocketride-ai/rocketride-{appId}`. This share was Poushali’s personal GitHub for Shashi ASAP.

---

## 8. Scoring / Daytona (load-bearing)

Hopper 1.0 was too low: harvest missed workspace package manifests and in-code `client.use({ pipeline })`. Engine now: up to 24 manifests; synthetic `<in-code pipeline>`. Fixture `eval/fixtures/inline-monorepo.json`. Expected Hopper Significant / Yes / ~4.5. Live switcher confirmed.

Joe sheet ~30 URLs; 14 Significant on 30-repo runs. Known 404s: `KrambitPL/ai-native-trading`, `Mr-Shockwave/Trailbridge`, `jymiller/hack-memory-motion`, `catiemcnama/memoryhack`.

Workers: 4 default; 8 Company/Organizers.

Font: shell `--rr-font-family` only. No custom webfont.

---

## 9. File map and commands

| Path | Why |
|---|---|
| `tools/gen-pipes.mjs` | Pipe graphs + pinned IDs |
| `tools/gen-evaluator-bundle.mjs` | Python → `evaluatorBundle.ts` |
| `tools/stage2-publish.mjs` | validate, deployTo, verifyApp, addApp, `publishApp @me` |
| `tools/sql-probe.mjs` | API-key SELECT 1 |
| `tools/daytona-load-probe.mjs` | 4-sandbox probe |
| `src/verify/pool.ts` / `session.ts` | Clone per sandbox |
| `src/verify/sqlStore.ts` / `sqlSchema.ts` | Stage 3 store |
| `src/App.tsx` | No `loginRequest`; `useSidebarCollapsed` |
| `src/app.css` | Responsive 960/680/420 |
| `docs/CONTRACT.md` / `BINDINGS.md` | Pinned decisions |

From `apps/judge-hack-ui`:

```text
npm.cmd run gen
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run sql-probe
npm.cmd run stage2
```

Overlay docs: `C:\Users\Poushali\Downloads\app-development-docs\app-development-docs\` (`05-data-migration.md` Stage 3, `06-ready-to-deploy-checklist.md` Stage 4).

---

## 10. Chronology (compressed)

**30 Aug–1 Sep:** Stage 0 Cloud connect (`hackjudge`), scaffold `apps/judge-hack-ui`. Catalog vs custom node → Daytona v1. Throwaway `rocketride_sql` then personal `db_postgres` (later reversed). UI fidelity to original Phase 2. Fail-closed. Architecture templates for Laserdata/Butterbase (not RR RAG). Shashi taste pass except deploy-ops. `HACKANAPP` redeemed.

**2–3 Sep:** Stage 2 pipes, Joe sheet, parallel Daytona, explain-parse, Hopper harvest, clone-per-sandbox, `@me` v6–v10. Load-bearing CSS. Stage 3 SQL wiring. Signed-in banner = broker. Dmitrii #2203.

**4 Sep:** Agent handoff v1. Rod/Shashi builder feedback (SQL, parallel use, pipe ids, preview, tool_python, CLIENT_ID wording). Responsive CSS. Stage 3 leftover = wait on broker. Design vs `@me` appState **not** proven both ways.

**8 Sep:** Dmitrii: no movement on #2203. Shashi: thought issue was timeout + “use postgres SQL nodes.” Correction: we **do** use `rocketride_sql`; failure is broker, not timeout. Mansi/Mith “works” → ask node type.

**10 Sep:** Slack to Shashi: staging cloud-DB blocker fixed (TLS on datacore provisioner + engine wired to DB broker via staging ALB). Switcher verify later the same day: SQL banner, 1 run + `Stage3 SQL Probe` survived reload, Account is Poushali. Inventory in `docs/STAGE3-INVENTORY.md`. Prod not claimed.

**9 Sep:** Shashi wants GitHub + Rod engg thread. Pushed `rocketride-shell`. Rod feedback list: `useExisting=true` (does not replace clone-per-worker); pipe ids as agent coding issue (we have disk drift after pins); Design preview he doesn’t understand → **loginRequest spin**, not Full Screen frame. Rod also: local SaaS **`feat/app-2`** admin setup is now `.bootstrap` JSON on **initial SaaS DB create** (multi-org); old email-list-on-login path is gone. Not used on staging Judge Hack.

---

## 11. Paste-ready (keep current)

**Shashi status:** Judge Hack `@me` **v11** (10 Sep). Stage 3 SQL verified then tenant DB empty on later load; hydrate/`useExisting` fix republished. Stage 4 in progress: org-scope secrets then `@team`. Not submitting `@public`.

**Shashi GitHub:** Latest shell app: https://github.com/Poushali0202/hackathon-usage-verifier/tree/rocketride-shell/judge-hack-ui — `phase-2` is the old FastAPI app.

**Rod Design preview (one bullet we are sure of):** Design `.rrapp` is not `@me`. Emitting `shell:loginRequest` in preview spun on Sign in required; we removed it. `@me` not prompting login is intended. Do not claim split `appState` as proven.

**Mith/Mansi:** Which node (`rocketride_sql` vs `db_postgres`)? Host/password set? Canvas vs published app `client.database.query`? Signed-in vs API key?

---

## 12. Next if asked

1. Owner: org-scope the three pipe secrets (do not script `setEnv`).
2. Republish `@me` (README + responsive CSS), then `publishApp @team/<name>`.
3. Re-copy `apps/judge-hack-ui` → git `judge-hack-ui/` and push `rocketride-shell` after more edits.
4. Optional: delete throwaway target `Stage3 SQL Probe`.
5. Do not commit verifier `eval/` WIP unless asked.
6. Do not `@public` / invent `price_*` / flip to personal Postgres.
