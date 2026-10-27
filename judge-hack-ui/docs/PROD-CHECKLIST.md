# Judge Hack → production: step-by-step

**Written 1 Oct 2026.** The do-it list for `docs/PROD-DEPLOY-PLAN.md` (which explains *why* each
step exists). Converge's log is `C:\Users\Poushali\Downloads\PROD-DEPLOY-2026-09-29.md`.

Every step says **who** does it. `YOU` = only you can (credentials, platform UI, owner decisions).
`AGENT` = ask me and I run it. `EITHER` = a command you can run yourself.

Run every command from `apps/judge-hack-ui`. PowerShell blocks `npm.ps1`, so always `npm.cmd`.

**Every command that writes names its target** (`--target cloud` for production). If `.env` points
somewhere else, the tool prints `REFUSED` and exits before doing anything. That is the safety net
for the whole of this document — see `docs/ENV-HANDLING.md`.

**Stop rules.** Each step has a *stop if*. If it trips, stop and fix before the next step — none of
this is safe to push through. Steps A–C cannot break production; D is the first write.

---

## Settled, 1 Oct — no longer open questions

**The production DB broker is fixed.** The engine now has `ROCKETRIDE_DB_BROKER_URL` and
`ROCKETRIDE_DB_BROKER_TOKEN`, so Judge Hack's SQL store works on production from the first signed-in
session: `hj_targets`, `hj_runs`, `hj_run_items` and `hj_sandbox_leases` are created automatically,
runs persist, and the 5-slot concurrency pool is a real org-wide cap. There is no degraded mode to
plan around — but **D3 and E6 are where you prove it on the engine that actually serves the app**,
and if either one falls back to the workspace blob you stop there.

**Billing stays exactly as staging.** `BILLING_LIVE = false`, no Stripe prices, `resolvePlan`
returns `organizers` for everyone, `can()` always true. The manifest still registers Developer $20 /
Company $100 / Organizers $200 against the production app on deploy, but nothing is charged and
nothing is gated. No code change is needed for this — it is already the state of the tree.

---

## Stage A — prep, before anything is pointed at production

- [ ] **A1 · YOU · Have the Anthropic key to hand** (you will paste it in E2). Do not paste it into
  chat, a script, or any file in this repo.

- [ ] **A2 · YOU · Have a GitHub PAT to hand** (fine-grained, read-only Contents + Metadata). You
  will paste it into the app on production in E4. Your staging PAT does not exist on production.

- [ ] **A3 · EITHER · Confirm the tree is clean and on the staging id.**
  ```
  npm.cmd run typecheck
  npx.cmd vitest run
  ```
  *Expect:* typecheck silent, **122 passed / 1 skipped**.
  *Stop if:* anything fails — do not deploy a tree that is not green.

---

## Stage B — point at production, then look without touching

- [ ] **B1 · YOU · Point the App Builder extension at the production backend.**
  This is the only source of production credentials — there are none in `~/.secrets` or anywhere
  else. The extension rewrites the workspace `.env`, and **both** connection pairs become
  production (that is what happened to Converge at 15:16 local).
  *After this moment every tool run from this tree talks to production.*

- [ ] **B2 · EITHER · Prove `.env` actually moved.**
  ```
  cd "c:\Users\Poushali\OneDrive - RocketRide Inc\Desktop\RocketRide Repositories"
  $s = (Get-Content ".env" | Select-String 'staging\.rocketride\.ai' | Measure-Object).Count
  $p = (Get-Content ".env" | Select-String '(api|cloud)\.rocketride\.ai' | Measure-Object).Count
  "staging lines: $s / prod lines: $p"
  cd apps\judge-hack-ui
  ```
  *Expect:* `staging lines: 0 / prod lines: 2`.
  *Stop if:* staging is still 2 — the extension did not repoint, and everything below would hit
  staging and republish over v49.

- [ ] **B3 · AGENT or EITHER · Read-only probe of production.**
  ```
  node tools\team-share.mjs
  ```
  This only reads: identity, teams, members, which secret names exist at user/org/team scope, and
  the deployment count. It never writes and never calls `setEnv`.
  *Write down three things from the output:*
  1. `developerId=` → decides the production app id (B4)
  2. the team list (`team <name> id=…`) → which teams get the pipes (D1)
  3. `deployments=` → should be **0**; this is a first deployment, so nothing on production can
     break
  *Stop if:* `developerId=null` — the production org is not a developer org and a developer code has
  to be redeemed before any app can be registered there (staging used `HACKANAPP`).

- [ ] **B4 · YOU · Settle the production app id** from B3's `developerId`:

  | `developerId` | Production app id | What to pass |
  |---|---|---|
  | `hackjudge` | `hackjudge.judge-hack` (unchanged) | nothing — omit `--app-id` |
  | anything else, e.g. `rocketride_apps` | `<that>.judge-hack` | `--app-id <that>.judge-hack` |

  Everything below writes `<PROD_ID>` where that id goes. The tools now refuse to deploy an id whose
  namespace does not match the org, and print the id to re-run with — so a wrong guess fails loudly
  instead of registering an app the org cannot own.

- [ ] **B5 · EITHER · Confirm production is empty for that id.**
  ```
  node tools\where-app.mjs --app-id <PROD_ID>
  ```
  *Expect:* `whereApp <PROD_ID>: (no rungs)`.
  *Stop if:* rungs already exist — something is deployed there and this is not a first deploy.

---

## Stage C — the gate

- [ ] **C1 · EITHER · Full build gate.**
  ```
  npm.cmd run build
  ```
  This runs: generate the evaluator bundle and pipes → `tsc --noEmit` → vitest → the Python
  evaluator tests → rsbuild. Needs Python 3 on `PATH` (the bundle generator and `test_stage1.py`).
  *Expect:* all green, `dist/` written.
  *Stop if:* anything fails. Converge gated every production version on typecheck plus tests.

- [ ] **C2 · EITHER · Confirm the three pipe ids are unchanged.**
  ```
  npx.cmd vitest run test/stage2-generated.test.ts
  ```
  *Expect:* pass — `project_id`s are stable identities and regenerating them breaks deploy history.

---

## Stage D — deploy (the first write to production)

- [ ] **D1 · AGENT or EITHER · Deploy pipes + app, publish `@me` only.**
  ```
  npm.cmd run stage2 -- --target cloud --app-id <PROD_ID> --comment "v1 on production: catalog-only, per-judge GitHub token"
  ```
  Omit `--app-id` entirely if B4 said the id is unchanged.
  *What it does, in order:* checks `--target cloud` against **both** configured hosts and refuses on
  a mismatch before touching anything → regenerates bundle and pipes → prints `[dev] host=…
  target=…` → validates the three pipes against the dev connection → connects the deploy pair and
  checks `developerId` on the instance being written to → checks which pipe secrets exist →
  `deployTo` + `enable` the three pipes for one team → `verifyApp` → `addApp` → polls the server
  build → `publishApp @me` → prints `whereApp`.
  *Expect:* `registry version 1`, build `ok`, `publishApp @me v1 ok`, and a `whereApp` line for the
  personal rung at v1.
  *Expect also:* `Pipe secrets missing from overlay: ROCKETRIDE_ANTHROPIC_KEY` — correct at this
  point, you set it in E2.
  *Stop if:* `REFUSED` (B1 did not take — `.env` is still staging); or the build fails (the script
  prints the tail of the server build log — read it rather than guessing).

- [ ] **D2 · AGENT or EITHER · Enable the pipes for every other production team that will open the app.**
  `stage2` deploys the pipes to **one** team only (`ROCKETRIDE_DEPLOY_TEAM`, else your dev team,
  else the first team). Converge deployed its ops pipeline once per team. For each additional team
  id from B3:
  ```
  $env:ROCKETRIDE_DEPLOY_TEAM = "<other team id>"
  npm.cmd run stage2 -- --target cloud --app-id <PROD_ID> --skip-app
  Remove-Item Env:\ROCKETRIDE_DEPLOY_TEAM
  ```
  `--skip-app` means pipes only — no second app version. Use a team id from **B3** (production); a
  staging team id is now rejected rather than silently deploying nowhere useful.
  *Expect:* three `deployed pipe … version=…` lines.
  *Skip if:* only one team will ever open Judge Hack on production.

- [ ] **D3 · AGENT or EITHER · Confirm the broker fix from the command line, before the browser.**
  ```
  npm.cmd run sql-probe -- --target cloud
  ```
  Deploys `hackjudge_sql_v1`, starts a short-lived session and runs `SELECT 1` through
  `rocketride_sql`. This is the exact probe that failed on staging in August and the fastest
  unambiguous answer on whether the broker is wired.
  *Expect:* `Stage 3 probe PASS: rocketride_sql SELECT 1`.
  *Stop if:* `Stage 3 probe FAIL` with `ROCKETRIDE_CLIENT_ID is not set` or
  `cloud DB nodes require a signed-in RocketRide cloud identity` — the fix has not reached this
  engine. The script prints that diagnosis itself. Go back to whoever applied it; do not work around
  it and **do not** deploy a personal `db_postgres`.
  *Note:* this writes one extra registry version of the SQL pipe (same `project_id`). Harmless.

---

## Stage E — first production session

- [ ] **E1 · EITHER · Find the production address.** Converge asked the hosts rather than the docs:
  `cloud.rocketride.ai/?appid=<id>` is what their evals used, `api.rocketride.ai/?appid=<id>`
  answers 200, `app.rocketride.ai` is 403, and `rocketride.ai` redirects to `cloud`.
  Your address: **`https://cloud.rocketride.ai/?appid=<PROD_ID>`**

- [ ] **E2 · YOU · Set `ROCKETRIDE_ANTHROPIC_KEY` on the production org.**
  Account → Environment → **org** scope → add the name and paste the value → save.
  Do this in the platform UI. Never from a script: `setEnv` is a full-dict replace and would wipe
  the rest of the overlay. Expect the production org's environment to start completely empty —
  Converge's did.
  *Why:* the explain pipe resolves `${ROCKETRIDE_ANTHROPIC_KEY}` server-side. Without it verdicts
  are still correct but every row reads "Model explanation unavailable".

- [ ] **E3 · YOU · Open the production address, signed in.**
  *Expect:* Judge Hack loads, astronaut lockup top-left, Dashboard with **0 runs**.
  *Stop if:* "App not found: this server has no app with the id …" — `@me` belongs to whichever
  account owns the production deploy key. If your browser session is a different login from that
  key, either sign in as the key's account or finish Stage F first so a team rung serves you
  (Converge log entry 15).

- [ ] **E4 · YOU · Settings → GitHub access → paste your PAT → Save token.**
  *Expect:* `Saved for @<your login> · N API calls left this hour`, and status reads
  *your token is saved*. The box empties itself.
  *Stop if:* GitHub rejects it (401) — the token is expired, revoked, or lacks read access.

- [ ] **E5 · YOU · Smoke one repository through Quick verify.**
  *Expect:* a tag, a backbone verdict, a score, and — if E2 is done — real prose in the dossier.
  *Stop if:* the dossier reads "Model explanation unavailable" — E2 did not take.

- [ ] **E6 · YOU · Prove the SQL store is live for a real browser session.** Reload the page.
  *Expect:* the run from E5 is still there. No store-unavailable banner anywhere.
  *Why it matters even though D3 passed:* D3 proved the API-key path. This proves the browser
  session path, which is the one judges use and the one that creates the schema. The four `hj_*`
  tables are created on the first signed-in session, so a persisted run means provisioning, schema
  and migrations all succeeded.
  *Stop if:* the run vanishes or a store banner appears — the app has fallen back to the workspace
  blob, which means the engine serving your session still has no broker. Do not widen to teams on a
  degraded store; go back to whoever applied the fix with the exact banner text.

- [ ] **E7 · YOU · Check the manifest settings resolve.**
  Settings → Run defaults: change grace days, reload, confirm it stuck. This is the one thing an app
  id change can break silently (the contributed keys carry the id), so it is worth 30 seconds.

---

## Stage F — widen to your teams

- [ ] **F1 · AGENT or EITHER · Publish `@me` and `@team/<name>` together.**
  ```
  node tools\team-share.mjs --publish --target cloud --audience "@team/<name>" --app-id <PROD_ID>
  ```
  Use a team **name** from B3's output. `@me` is pinned automatically — you do not ask for it.
  *Expect:* `publishApp @me v1 ok` **then** `publishApp @team/<name> v1 ok`, then `whereApp`.
  *Why both:* the browser resolves the personal rung **before** the team rung. Converge had eight
  consecutive deploys that nobody ever saw because `@me` sat at v62 while the team rung moved to
  v75, and every "it's live" message was wrong with nothing saying so.
  *Stop if:* it refuses on a missing org overlay — that means E2 was skipped and explain would fail
  for everyone this reaches. Fix E2 rather than passing `--skip-overlay-check`.
  *Note:* one team per run. Repeat with a different `--audience` for each additional team.

- [ ] **F2 · EITHER · Read the reverse index rather than inferring from "published".**
  ```
  node tools\where-app.mjs --app-id <PROD_ID>
  ```
  *Expect:* every rung you published listed at **v1**.
  *Stop if:* the rungs disagree on version — fix by publishing the same version to the lagging rung
  ("repoint, never rebuild").

- [ ] **F3 · YOU · Have one teammate open it and run one sheet.**
  *Expect:* their Dashboard is **empty** and their own; they paste their **own** PAT. Confirmed on
  staging 28 Sep — you saw 16 runs, Shashi saw his own 20. Team membership grants the app, not your
  run history.

---

## Stage G — follow-ups that are not app code

- [ ] **G1 · YOU · Point the App Builder extension back at staging** when production work pauses.
  Until you do, every deploy from this tree goes to production — including anything you *meant* for
  staging. `stage2` now prints the host first, so check that line every run.

- [ ] **G2 · YOU · Do not create an org-scope `ROCKETRIDE_GITHUB_TOKEN` on production.**
  Every judge's PAT is user-scope by design. Also delete the leftover org-scope one still sitting on
  **staging**.

- [ ] **G3 · YOU · Tell Mithilesh the broker fix is confirmed from Judge Hack's side** once D3 and
  E6 pass. Converge was blocked on the same missing variables (their log entry 14), so a working
  `hj_*` schema on production is evidence for their deploy too.

---

## Stage H — the store, only when you want it

Production review is its own ladder. Staging's queue position means nothing here.

- [ ] **H1 · YOU · Decide v1 is the build you want listed.** Re-smoke it first; registry versions
  are immutable, and the store listing renders `README.md` verbatim.

- [ ] **H2 · YOU or AGENT · Submit for review.**
  App Builder → Deploy/Store tab → the newest `ok` version → **Submit for review**.
  Equivalent call: `submitApp('<PROD_ID>', 1)`. State goes `private` → `submit`.
  *I will not call this unless you tell me to.*

- [ ] **H3 · YOU · Ping whoever owns the production review queue**, then wait. You can message the
  reviewer from the Dashboard review thread at any time; **Withdraw** takes it back to `private`.

- [ ] **H4 · AGENT or EITHER · After the verdict lands `ready`**, publish both rungs:
  `publishApp @public` **and** `publishApp @me` (plus teams), then `where-app` again.
  *`publishApp @public` before the state is `ready` is refused by the platform — do not try it.*

---

## What "done, as Converge is" means

Converge's end state on 30 Sep: app deployed on production, ops pipeline enabled per team, published
to `@me`, a signed-in production session verified, and **not** submitted to `@public`. The
equivalent for Judge Hack is **everything through Stage F** — and with the broker fixed, Judge Hack
finishes in better shape than Converge did, because its SQL store actually works.

Stage H is further than Converge has gone.

## Fast reference

| | |
|---|---|
| Probe production (read-only) | `node tools\team-share.mjs` |
| Deploy + `@me` | `npm.cmd run stage2 -- --target cloud --app-id <PROD_ID> --comment "…"` |
| Pipes only, another team | `npm.cmd run stage2 -- --target cloud --app-id <PROD_ID> --skip-app` |
| `@me` + `@team` together | `node tools\team-share.mjs --publish --target cloud --audience "@team/<name>"` |
| Which rung serves what | `node tools\where-app.mjs --app-id <PROD_ID>` |
| Is the DB broker wired | `npm.cmd run sql-probe -- --target cloud` |
| Dry run, no writes | `npm.cmd run stage2 -- --validate-only` |

Instead of repeating `--app-id` and `--target` on every command you can set both once per shell:

```
$env:ROCKETRIDE_APP_ID = "<PROD_ID>"
$env:ROCKETRIDE_TARGET = "cloud"
```

Clear them (`Remove-Item Env:\ROCKETRIDE_APP_ID, Env:\ROCKETRIDE_TARGET`) when you switch back to
staging — a stale `ROCKETRIDE_TARGET` is the one way to lose the refusal that protects you.
