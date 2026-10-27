# Judge Hack → production

**Written 1 Oct 2026.** Judge Hack's mapping of Converge's `PROD-DEPLOY-2026-09-29.md`
(`C:\Users\Poushali\Downloads\PROD-DEPLOY-2026-09-29.md`).

Converge's file is a log — each entry a fact read off a screen. **This file is a plan**: nothing
below has been run against production. Facts observed in this tree are marked *observed*;
everything else is an instruction or an open question.

Nothing here is permission to deploy, `submitApp`, `publishApp @public`, `setEnv` on org/team,
flip `BILLING_LIVE`, or invent Stripe `price_*`.

---

## 0. Starting point (observed, 1 Oct 2026)

| | |
|---|---|
| Staging app id | `hackjudge.judge-hack`, publisher `hackjudge`, org **Poushali's Workspace**, `developerId=hackjudge` |
| Staging state | **v49** on `@me` and `@team/Development`; blue STORE pill = **in review** (`submit`) |
| Workspace `.env` | `ROCKETRIDE_URI`, `ROCKETRIDE_APIKEY`, `ROCKETRIDE_DEPLOY_URI`, `ROCKETRIDE_DEPLOY_APIKEY` — **both pairs point at the staging host.** No production pair exists in this tree. |
| Gate | `npm run typecheck` clean; `vitest` **122 passed / 1 skipped** |
| Pack | `judge-hack.rrapp`; `appManifest.projectId` `bde4acbb-7db2-4a97-8d01-28214a1bc284` |

Converge's production credentials came from one place: the owner pointed the **App Builder
extension** at production, and the extension rewrote `.env` so **both** pairs became production.
There were no production credentials anywhere else. Expect the same here — that repoint is step 1,
and it is the owner's action, not a script's.

**v49 does not transfer.** 49 is a staging registry integer. Production has its own registry and
Judge Hack's first production build will be **v1**. The staging review state is a property of the
staging deployment; production needs its own submission and its own review.

---

## 1. The production app id

Converge had to change its id: the staging id `demoapp.spaceport` sat outside the production
organization's developer namespace `mithilesh_app`, and an id outside the namespace renders the
Deploy tab read-only on "Nothing is deployed yet" (their log, entry 12).

So the first question is **what `organization.developerId` is on the production instance**:

| Probe result | Production app id | Action |
|---|---|---|
| `hackjudge` | `hackjudge.judge-hack` — unchanged | No patching. Deploy as-is. |
| something else, e.g. `rocketride_apps` | `<that>.judge-hack` | Deploy with `--app-id <that>.judge-hack` |
| `null` | — | **Blocker.** The org is not a developer org; a developer code must be redeemed first (staging used `HACKANAPP`). |

`tools/stage2-publish.mjs` now **fails** rather than deploys when the id's namespace and the
connected org's `developerId` disagree, and prints the id to re-run with.

### Where the id is spelled

Converge listed nine places. Judge Hack has **7 literals across 4 shipped files**, plus three tools
that used to hard-code it:

| File | What |
|---|---|
| `package.json` | `appManifest.id`, `appManifest.publisher`, and the three contributed settings keys `<id>.graceDays` / `.historyPenalty` / `.storeVariant` |
| `src/AppDescriptor.ts` | `descriptor.id` — the shell routes `?appid=` by it, and it must equal the manifest id |
| `src/billing.ts` | `APP_ID` (billing, entitlement reads, and `SETTING_*` are derived from it) |
| `judge-hack.rrapp` | the App Builder's pack id |
| `tools/stage2-publish.mjs`, `tools/where-app.mjs`, `tools/team-share.mjs` | the id passed to `listDeployments` / `publishApp` / `whereApp` |

**The settings keys are the trap.** `src/billing.ts` derives `SETTING_GRACE_DAYS` and friends from
`APP_ID`, but `package.json` spells those keys literally. Change one without the other and Settings
silently stops resolving. The patcher moves them together and a test pins that.

### What was built for this (done, 1 Oct)

Mirroring Converge's decision — one tree, two instances:

- **`tools/app-id.mjs`** — `resolveAppId()` (`--app-id` → `ROCKETRIDE_APP_ID` → staging default) and
  `patchAppId()`, which rewrites the id in the four shipped files and returns a restore function.
- **`tools/stage2-publish.mjs`** — takes `--app-id` and `--comment`; patches the id around
  `verifyApp` + `addApp` and restores in a `finally`, so a failed build cannot leave the tree
  holding the other instance's id; **prints the connected host** before any write; fails on a
  developer-namespace mismatch.
- **`tools/where-app.mjs`**, **`tools/team-share.mjs`** — resolve the id the same way.
- **`test/app-id.test.ts`** — 5 tests: resolution order, malformed ids rejected, manifest /
  descriptor / billing / pack all rewritten, settings keys moved, `projectId` and the npm package
  name untouched, byte-for-byte restore, idempotent restore.

Default behaviour is unchanged: with no flag and no env var every tool still says
`hackjudge.judge-hack` and still targets whatever `.env` points at.

**Not touched, deliberately:** `appManifest.projectId` and the three pipes' `project_id`s are stable
identities (Converge: never regenerate them). The npm package name stays `hackjudge-judge-hack`.

---

## 2. The manifest carries billing

`appManifest.mode` is `subscription` with three plans — **Developer $20 / Company $100 /
Organizers $200** (`amountCents` 2000 / 10000 / 20000, `interval: one_time`). Deploying to
production **registers those prices under the production app**, exactly as Converge registered Team
$12 and Scale $22.

Meanwhile `src/entitlement.ts` has `BILLING_LIVE = false`, so entitlement **fails open** to
`organizers`: every signed-in user gets the full product, no checkout, no plan cap. That is Josh's
instruction and it is what should ship.

**Owner's call before anyone is charged**, same as Converge's open item: the plans ride the deploy
whether or not enforcement is on. There are no Stripe `price_*` values in this tree and none should
be invented.

---

## 3. The pipelines are a second deploy

Three pipes, stable ids, deployed by `stage2-publish.mjs` (or with `--skip-pipes` to skip):

| Pipe | `project_id` | Why production needs it |
|---|---|---|
| `hackjudge_python_v1` | `3f6b9d2e-5c41-4a8f-9e07-6d2b8c1a4f53` | the evaluator; without it nothing scores |
| `hackjudge_explain_v1` | `cf2762a0-ee71-4f77-9d99-1296e81e71b4` | post-verdict prose; needs the Anthropic key |
| `hackjudge_sql_v1` | `8e2a6c14-b7f1-4d93-9a50-1c4e8f2d7b36` | runs / targets / the org lease pool |

They deploy with `deployTo <teamId>` and are then `enable`d for that team. Converge deployed its ops
pipeline **once per team** (Production and Development). Judge Hack should do the same for whichever
production teams will open the app.

**No schedules.** Judge Hack contributes none, so Converge's "a schedule resolves secrets from the
deploy server's environment, not your local `.env`" does not bite here. The equivalent for us is
§4: the pipes resolve `${ROCKETRIDE_ANTHROPIC_KEY}` from the **production** server's overlay.

---

## 4. Secrets on production are empty until the owner fills them

Converge observed (entry 56) that its production organization had **no environment variables at org
scope** while staging's org carried two. Assume the same: the production org starts blank.

| Secret | Scope | Who sets it | If missing |
|---|---|---|---|
| `ROCKETRIDE_ANTHROPIC_KEY` | **org** (or team) on production | **Owner**, in Account → Environment. Never `setEnv` from a script — it is a full-dict replace. | Verdicts are still correct; explain fails and the grid reads "Model explanation unavailable". Judge Hack handles it (`explain_failed`). |
| `ROCKETRIDE_GITHUB_TOKEN` | **user**, per judge | Each judge, in the app's Settings → GitHub access | Runs, prefill and repo tests **fail closed** with a link to Settings |

Her staging PAT does not exist on production — user-scope environments are per instance. She will
paste a PAT again on her first production session, and so will every other judge.

There is still a leftover org-scope `ROCKETRIDE_GITHUB_TOKEN` on **staging** that she should delete
herself. Do not create one on production: a shared GitHub secret is exactly what the per-judge
design removed.

---

## 5. The DB broker — resolved 1 Oct 2026

**Status: fixed.** The production engine now has `ROCKETRIDE_DB_BROKER_URL` and
`ROCKETRIDE_DB_BROKER_TOKEN`, so everything below is history rather than a plan. Judge Hack's SQL
store is expected to work on production from the first signed-in session: `ensureSchema()` creates
`hj_targets`, `hj_runs`, `hj_run_items` and `hj_sandbox_leases`, runs persist across reloads, and
`ORG_SLOTS=5` is a real cap again. The degradation table is retained because it is still the exact
symptom list to match against if a session ever falls back — see `PROD-CHECKLIST.md` step E6, which
is the check that confirms the fix reached the engine serving the app.

The original blocker, Converge's log entry 14:

> `ROCKETRIDE_CLIENT_ID is not set; RocketRide cloud DB nodes require a signed-in RocketRide cloud
> identity` — on production, for every path (browser session, API key, team run). Cause:
> `ROCKETRIDE_DB_BROKER_URL` and `ROCKETRIDE_DB_BROKER_TOKEN` are absent from the production engine
> server process, so tenant DSN resolution raises and nothing is injected. Staging got those two
> variables on 26 August. **Platform configuration, not an app defect; no app change fixes it.**

Judge Hack knows this message — it is the same one that blocked Stage 3 on staging
(`rocketride-server` #2203, Dmitrii) and `classifySqlError` already flags it as `broker`.

**Behaviour whenever those two variables are missing** (no longer expected, kept as the symptom
list):

| | |
|---|---|
| Verify a repo | **Works.** `tool_python` + `tool_http_request` need no broker. |
| Explain | **Works**, once the org Anthropic key exists. |
| Runs / custom targets persisted to `hj_runs` / `hj_targets` | **Fails.** `openSqlStore` throws, the app falls back to per-user workspace `appState` and the store banner reports it. |
| `ensureSchema()` creating the tenant tables | **Does not happen** — this is Judge Hack's equivalent of Converge's first-session engine install. |
| Org concurrency pool (`hj_sandbox_leases`, `ORG_SLOTS=5`) | Leases degrade to negative pseudo-slots; no real cap across sessions. |

Note that Judge Hack **degrades** rather than dying in this state — judges can still score sheets,
history just lives in the workspace blob. That makes the failure quiet, which is why E6 checks for
it explicitly instead of assuming a successful run means a successful store.

---

## 6. Where production serves the shell

Converge asked the hosts rather than the docs (entries 4 and 18):

| Host | Observed |
|---|---|
| `https://api.rocketride.ai/?appid=<id>` | 200, renders the shell |
| `https://cloud.rocketride.ai/?appid=<id>` | the address their evals used; the app loads directly, no launcher |
| `https://app.rocketride.ai` | 403 |
| `https://rocketride.ai` | redirects to `cloud.rocketride.ai` |

Judge Hack's production address will therefore be `https://cloud.rocketride.ai/?appid=<prod id>`.
Worth re-confirming by asking the hosts at deploy time — nothing in the platform docs names the
production shell host.

Note Converge entry 15: `@me` belongs to **the account that owns the deploy key**. If the
production key is a different login from the browser session, that session sees "App not found" for
a personal-rung-only app. Publish `@team` as well, or sign in as the key's account.

---

## 7. Order of work

Steps 1–3 are the owner's. Nothing after step 3 can start without them.

1. **Owner: point the App Builder extension at production.** This is the only source of production
   credentials; it rewrites workspace `.env` so **both** pairs are production. From that moment
   every tool run from this tree talks to production — `stage2-publish.mjs` now prints the host so
   that is visible rather than assumed.
2. **Read-only probe first** (Converge's entry 1, and the reason nothing on production can be
   broken by this): `whereApp` and `listDeployments` for the candidate id. Expect no deployments and
   no rungs. This also reads `organization.developerId`, which decides §1.
3. **Owner: decide the production app id** from that probe, and the billing question in §2.
4. **Gate:** `npm run build` from `apps/judge-hack-ui` (gen → `tsc --noEmit` → vitest → the Python
   evaluator tests → rsbuild). Converge gated every production version on typecheck plus tests.
5. **Deploy pipes + app, publish `@me` only** — so the build is seen before anyone else gets it:
   ```
   cd apps/judge-hack-ui
   npm.cmd run stage2 -- --app-id <prod id> --comment "v1 on production: catalog-only, per-judge GitHub token"
   ```
   PowerShell blocks `npm.ps1`; use `npm.cmd`. Expect registry **v1**, server build, then
   `publishApp @me` and a printed `whereApp`.
6. **Owner: open `https://cloud.rocketride.ai/?appid=<prod id>` once, signed in.** Confirm the build
   renders and the branding is right, paste a GitHub PAT in Settings, run one Quick verify. Expect
   the SQL store banner until §5 is fixed.
7. **Publish wider, both rungs together:** `tools/team-share.mjs --publish-only` publishes `@me`
   **and** `@team/<name>`. Converge's expensive lesson: the browser resolves the personal rung
   before the team rung, so eight deploys were invisible while `@me` lagged. Then print
   `tools/where-app.mjs` and read it rather than inferring.
8. **Store, only when she asks.** Production review is its own ladder: `submitApp(<prod id>, v)`
   flips the production deployment `private` → `submit`; a reviewer lands `ready` or `rejected`;
   only then `publishApp @public` **and** `@me`. `publishApp @public` before `ready` is refused by
   the platform.
9. **Afterwards: point the extension back at staging.** Until then every staging deploy from this
   tree would go to production instead.

---

## 8. Open for the owner

- **Production credentials** — repoint the extension (step 1). Blocks everything.
- **Production app id** — depends on the production org's `developerId` (§1).
- ~~**Billing**~~ — *settled 1 Oct: stays as staging. `BILLING_LIVE` stays `false`, no Stripe
  prices, entitlement fails open to `organizers`. The manifest still registers $20 / $100 / $200,
  but nothing is charged or gated.*
- **Org Anthropic key on production** — owner-set, in Account → Environment (§4). Without it
  explain degrades.
- ~~**DB broker on the production engine**~~ — *fixed 1 Oct (§5). Confirm with checklist step E6.*
- **Store on production** — a separate submission and review; staging's queue position means
  nothing there.
- **Staging's leftover org `ROCKETRIDE_GITHUB_TOKEN`** — delete it herself; do not recreate on
  production.

## 9. Differences from Converge worth knowing

| | Converge | Judge Hack |
|---|---|---|
| Id change | Forced: `demoapp.spaceport` → `mithilesh_app.converge` | Only if the production `developerId` is not `hackjudge` |
| Second deploy | `spaceport-ops` sandbox pipeline, once per team | Three catalog pipes, once per team |
| Schedules | sync cadence set per team | none |
| First-session side effect | `engineInstall.ts` writes the routing core | `ensureSchema()` creates the `hj_*` tables |
| Per-user secret | each workspace's own GitHub token, passed per call | each judge's PAT in user-scope env, read at run start |
| Broker outage | "Store unreachable", app unusable | degrades to workspace `appState`, scoring still works |
| Billing | Team $12 / Scale $22 per reviewer | Developer $20 / Company $100 / Organizers $200, enforcement off |
