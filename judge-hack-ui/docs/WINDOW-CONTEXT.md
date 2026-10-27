# Judge Hack — context for this Cursor window

**Written:** 30 Sep 2026  
**Window:** continuation of chat `a5685dc3-7935-49af-a64d-88de3fdd82f3` after context compaction, then live turns **Fri 25 Sep – Wed 30 Sep 2026**.  
**Transcript:** `C:\Users\Poushali\.cursor\projects\c-Users-Poushali-OneDrive-RocketRide-Inc-Desktop-RocketRide-Repositories\agent-transcripts\a5685dc3-7935-49af-a64d-88de3fdd82f3\a5685dc3-7935-49af-a64d-88de3fdd82f3.jsonl`  
**Earlier handoff (Aug–Sep 9):** `docs/AGENT-HANDOFF.md` (Daytona/clone sections are history; see §00 there and §2 here).

Do **not** treat this file as permission to commit, push, `submitApp`, `publishApp @public`, `setEnv` on org/team, invent Stripe `price_*`, or flip `BILLING_LIVE`.

No secret values belong in this file. Never paste PATs or Anthropic keys into chat or docs.

---

## 1. Who / where

| | |
|---|---|
| Owner | Poushali Deb-Purkayastha (`poushalipurkayastha24@gmail.com`) |
| App | Judge Hack, id `hackjudge.judge-hack`, publisher `hackjudge` |
| Live app folder | `apps/judge-hack-ui` (not itself a git repo) |
| Workspace | `c:\Users\Poushali\OneDrive - RocketRide Inc\Desktop\RocketRide Repositories` |
| Staging | `https://staging.rocketride.ai` |
| Org | Poushali's Workspace, `developerId=hackjudge` |
| Dev team | Development, id `60f42b96-95dd-4029-8eb8-b986bb373a00` (screenshot 28 Sep: 4 members — Poushali Team:Admin; Mithilesh Task:Control+Monitor; Shashi Task:Control+Monitor; Aviral Task:Monitor). Also a Production team in the same org. |
| GitHub SoT for Shashi | `https://github.com/Poushali0202/hackathon-usage-verifier` branch **`rocketride-shell`**, folder `judge-hack-ui/`. Sync via TEMP clone `hj-gh-sync` + robocopy excluding `node_modules`/`dist`. Last noted tip **`f24221e`** (“Tighten Judge Hack copy for a public B2B listing.”). Do not push dirty `Projects/hackathon-usage-verifier` `main`. |
| Pack | `judge-hack.rrapp` |

---

## 2. Standing constraints (carry every session)

- No invented Stripe `price_*`. No `new RocketRideClient()` in the app. No `localStorage`. No `hackjudge_*` catalog nodes (Dylan: app-specific server nodes rejected; custom nodes only if catalog + `tool_python` + `tool_http_request` cannot do the job). No `shell:loginRequest`.
- Do not deploy `storeVariant=external` / personal Postgres unless overridden.
- Do not `submitApp` / `@public` unless she asks. Do not commit unless she asks.
- Do not `setEnv` (full-dict replace) on **org/team**. The only env write in the app is read-modify-write `getEnv('user')` → `setEnv('user', merged)` on the **signed-in user’s** scope (same op as Account → Environment). Flag that to her.
- GitHub token must never live in the frontend bundle as a shared secret.
- Auth: no app-level auth. Platform Zitadel `auth.rocketride.ai`. Manifest `authenticated: true`. Identity from `useAuthUser()`.
- Billing (Josh + Converge): **`BILLING_LIVE = false`** in `src/entitlement.ts`. Fail-open. Testers must not be blocked. Flip only after Store prices + webhook.
- Deploy: pack → server build → `publishApp`. Browser resolves **`@me` before `@team`**. When publishing team/public, publish `@me` too, then `whereApp`. PowerShell: `cd apps/judge-hack-ui; npm.cmd run stage2` (workspace root has no package.json; `npm.ps1` can SecurityError).
- Auto-review may block `npm run stage2` and live probes; retry with `request_smart_mode_approval` + exact block reason.
- Keep verification spikes in TEMP, not the repo.

---

## 3. Product architecture (current, post-Daytona)

**Flow:** GitHub URLs → `hackjudge_python_v1.pipe` (dummy `agent_rocketride` `agent_1` + `tool_python` `python_1` + GET-only `tool_http_request` `http_1`) → `hackjudge_explain_v1.pipe` (Haiku prose only) → `hackjudge_sql_v1.pipe`.

**Verdict:** LLM never writes tag, backbone, or score. Spec: `Projects/hackathon-usage-verifier/eval/SCORING_SPEC.md`. Bundle: `tools/build_restricted_bundle.py` → `src/verify/generated/evaluatorBundle.ts`.

**Fetch:** Python decides URLs. Staging `tool_python` **ignores `allowedModules`** (platform bug; urllib/html cannot import). Cache-replay: evaluator returns `need_fetch`; app GETs via `http_1` with the judge PAT as `bearer_token` **only** on well-formed GitHub repo URLs (`replay.ts`). Raise `allowedModules` with Josh/Dylan (not blocking). RestrictedPython: no `nonlocal`, AnnAssign, `_`-prefixed names, `d[k]+=v`, `str.format`, star-args, attribute writes. Tool name **`execute`**; result `{stdout,stderr,exit_code,timed_out,result}`; timeout 900.

**Three live pipes only** (`tools/gen-pipes.mjs` RETIRED includes external SQL; never reuse retired ids):

| Pipe | `project_id` |
|---|---|
| `hackjudge_python_v1` | `3f6b9d2e-5c41-4a8f-9e07-6d2b8c1a4f53` |
| `hackjudge_explain_v1` | `cf2762a0-ee71-4f77-9d99-1296e81e71b4` |
| `hackjudge_sql_v1` | `8e2a6c14-b7f1-4d93-9a50-1c4e8f2d7b36` |

Retired: Daytona; sqlExternal `c5d9e2b8-1a47-4f06-8d3c-9b7e0a4f2c18`. `PIPE_SECRETS` = `ROCKETRIDE_ANTHROPIC_KEY` only.

**SQL:** staging-managed `rocketride_sql`. `pipelineFor` ignores `storeVariant=external`. Rows filtered `WHERE owner_user_id = $1`. Workspace `appState` is org-shared at the platform; the app namespaces `tenant[userId]`. `legacyRows` can still show **unstamped** top-level `appState.runs` to everyone — known hole, not observed as a leak on 28 Sep (see §6).

**Meter (tables exist, enforcement off):** Company 20MB / organizers 40MB / developer 4MB; `AVG_REPO_KB=500`. Org SQL lease pool `ORG_SLOTS=5`.

**Branding:** astronaut-on-rocket + wordmark (`JudgeHackBrand.tsx`, `astronaut.svg`); home tile `icon.png` is the astronaut (not the gavel). `hideAnnouncements: true`.

**UI polish (v49):** Other credentials card gone; Company upsell lockcard gone while billing paused; staging-SQL dashboard essay gone.

---

## 4. Live snapshot (as of this window)

| Item | Status |
|---|---|
| `@me` | **v49** (25 Sep, comment: `tool_python + tool_http_request replay: no Daytona, no clone, per-judge GitHub token`) |
| `@team/Development` | **v49** (Deploy card 28 Sep: green DEVELOPMENT + ME) |
| Store | Blue **STORE** pill = **in review** (`submit` queue). Not `@public` until admin **`ready`**, then `publishApp @public` **and** `@me`. |
| `BILLING_LIVE` | `false` → `resolvePlan` always returns `OPEN_PLAN = 'organizers'`. `can()` all true. Checkout/plan cards hidden. |
| Tests | 117 pass + 1 skip; `test/entitlement.test.ts` asserts `BILLING_LIVE === false`. |
| GitHub `rocketride-shell` | Last noted **`f24221e`**. |

Publish script: `apps/judge-hack-ui/tools/stage2-publish.mjs` (`publishApp @me` + `whereApp`). Team: `tools/team-share.mjs`. Reverse index: `tools/where-app.mjs`.

---

## 5. This window — turns in order

### 25 Sep — Anthropic is not a user field

**User:** “The user is not going to enter the anthropic key right when they are using the app.”

**Decision:** Judges never paste `ROCKETRIDE_ANTHROPIC_KEY`. Explain pipe uses `${ROCKETRIDE_ANTHROPIC_KEY}` server-side from **owner org/team** Environment. Poushali (publisher) sets it once in Account → Environment. Do not add an Anthropic Settings field. Do not `setEnv` org from a script. Settings “Other credentials” already removed in v49. Customers only paste a GitHub PAT.

### 25 Sep — First-time marketplace tier

**User:** After install from the store, which tier? Default developer?

**Answer:** **Not developer.** While `BILLING_LIVE` is false, everyone is treated as **Organizers** (`OPEN_PLAN`). No Stripe assignment, no checkout, no cap modal. First open: platform sign-in → paste GitHub PAT → run. When billing is later flipped, unpaid `unsubscribed`/`canceled`/`past_due` would map to **developer** via `planFromSubscription` — that path is parked. Do not flip `BILLING_LIVE` for this listing.

Tiers in code: `developer` < `company` < `organizers`. Feature gates (`targets.custom-rubric`, `runs.history-penalty`) require company+ when live; `meter.enforce` listed at developer. `isCompanyPlan` = company or organizers.

### 25 Sep — How to `@public` + review

**User:** “how do I published the app to @public and apply for review?”

**Order:** `addApp` → build `ok` (already v49) → **`submitApp`** (`private` → `submit`, admin queue) → reviewer **`ready` or `rejected`** → only then **`publishApp @public` and `@me`** (and `@team` if colleagues should match). UI: App Builder Deploy/Store → **Submit for review** on the newest ok version. Withdraw = `submit` → `private`. `publishApp @public` **before** `ready` is rejected by the platform. Do not treat `@team` as the store.

Agent will not call `submitApp` unless she says e.g. **“submit v49.”** Screenshot 28 Sep shows STORE in review, so she (or someone) submitted after that turn.

Also: org Anthropic key must exist so store users can explain. Per-judge GitHub remains user-scope.

Converge/Mithilesh: `C:\Users\Poushali\Downloads\DEPLOY-AUTH-BILLING.md` — publish `@me` together with team/public; print `where-app`.

### 25 Sep — Slack to Josh (drafted, not sent by the agent)

**User:** Draft a message: did **not** take Josh’s GitHub-node fix or GitHub MCP; used HTTP tool + no Daytona.

**Draft (paste-ready):**

> Hey Josh —
>
> Quick update on the GitHub fetch path.
>
> I didn’t go with fixing `tool_github` itself, or wiring a GitHub MCP node. For this listing I stayed on catalog nodes: `tool_python` for the scorer, and `tool_http_request` to pull GitHub. Daytona is out — no sandbox, no clone.
>
> Why: we needed a deterministic batch path (Python still owns tag/backbone/score) without waiting on a GitHub-node or MCP change, and without a custom `hackjudge_*` node. `tool_github` / MCP sit on an agent loop, which is the wrong shape for 40+ repos. Staging `tool_python` also ignores `allowedModules`, so urllib can’t fetch in-process. HTTP GET replay was already in the catalog: Python asks for URLs, `http_1` GETs them (judge PAT only on well-formed GitHub URLs), cache goes back in. Same eval, ships now.
>
> If you later fix `tool_github` or ship a first-class GitHub/MCP node, we can swap the fetch side. Scoring stays in Python either way.
>
> — Poushali

**Why this was easier for this listing:** catalog only; no wait on node/MCP; no Daytona keys/clone; `tool_github` historically ~400s/repo via agent loop; Dylan blocked app-specific nodes.

### 28 Sep — Shashi sees Judge Hack; same runs?

**User:** Shashi sees the app on staging; he is in her workspace. Does that mean he sees her past runs?

Then: logged in with **his** credentials, still thought he saw her runs — because of Development team?

**Answer:** Team membership → he can **open** the app (v49 on DEVELOPMENT). It is **not** supposed to share Dashboard rows. Isolation is `owner_user_id` / `tenant[userId]`.

**Verified with screenshots:** isolation **works**.

- Poushali: 16 runs, 343 repos, DummyTest / M3M, signed in as herself.
- Shashi (`shashidhar.babu@rocketride.ai`): 20 runs, 460 repos, Hydra / reviewforge / Cognee.

Overlapping names (`DATA_AI_ROCKETRIDE`, `DataAI`) are the same *kind* of sheet, not shared rows.

Caveat still in code: unstamped legacy `appState.runs` can leak to teammates if SQL is empty and import runs. Not what 28 Sep showed.

### 29 Sep — Joe’s “multiple judges” / accuracy

**User:** Sandbox and cloning (Rod, Joe, Josh) are fixed. What about Joe’s ask for multiple judges and better verdict accuracy?

**Joe’s actual ask (22 Sep demo notes, not “N humans share a Dashboard”):** three **methodologies**, one **composite**:

1. **Deterministic engine** (shipped) — tag/backbone/score from code evidence.
2. **LLM-as-judge** — a model *assesses* the repo, not only narrates. **Not built.** Current Haiku is post-verdict prose only and must not write the tag.
3. **Execution proof** — run untrusted submitted code and prove it uses the target. **Parked.** Needs an isolated sandbox; that fights Rod/Josh “no Daytona / no clone / fewer vendors.”

**What can be done now without Daytona:** build judge 2 as a **second Anthropic pass** on the same evidence table. Grid: engine tag + LLM tag + agree/disagree. **Official tag stays deterministic.** Model cannot promote None → Significant. Fail-closed repos skip the LLM judge.

Do **not** average three LLM votes on top of the engine.

**Lock with Joe before weights:** official tag = engine; execution in this cut vs v2; if execution is in, sandbox returns **only** to run submissions, never to fetch; example weights 70/20/10 only after he picks.

Human panel (N judges, same sheet, highlight diffs) is a **separate** organizer feature. Shashi/Poushali already have isolated lists.

Canvas (optional UI): `canvases/joe-composite-judge.canvas.tsx` under the Cursor project.

### 30 Sep — GitHub PAT: browser or not?

**User:** How is the PAT handled when entered? Browser-side?

**Answer:**

- **Not persisted in the browser.** No `localStorage`, no cookie, no bundle secret. Settings password field is emptied after save. Prefs store only `{action, at}` audit (`hj.githubTokenAudit`), not the token. `githubTokenReady` is a boolean.
- **Persisted** as user-scope `ROCKETRIDE_GITHUB_TOKEN` via `getEnv('user')` / `setEnv('user', merged)` (`src/verify/githubToken.ts`). Org/team never written from the app.
- **Save path:** validate shape (`ghp_` / `github_pat_` / …) → **browser** `GET https://api.github.com/user` (`probeGithubToken`) → then `saveGithubToken`. That probe is the **only** GitHub call from the page.
- **Run path:** `requireGithubToken` at start → value goes into `tool_python` `code` as `TOKEN = …` and into `http_1` as `bearer_token` for GitHub hosts only. Tree/file GETs are **not** from the browser (`replay.ts`).
- Fail closed: missing token vs `GithubEnvReadError` (failed `getEnv` is not “no token”).
- No shared org GitHub token in the product. Leftover org `ROCKETRIDE_GITHUB_TOKEN` she must delete herself (do not `setEnv` org).

---

## 6. 22 Sep demo feedback (this window still uses it)

**Rod:** Shouldn’t clone; GitHub API is enough; staging is not a laptop FS; fewer external services (Daytona = another subscription).

**Josh:** Truncation on `tool_github` is deliberate (protect LLM context). Proposed: walk GitHub virtually / fix the node, or MCP. Validated the clone workaround *given the old node*. Direction: evaluator fetch through API.

**Joe:** After Dylan’s node release, should not need Daytona or Tenki for current purpose (supersedes his own Tenki push). **Product:** three judges → composite score (see §5).

**Tension:** Rod/Josh fetch vs Joe execution-proof. Named in the 22 Sep follow-up. Fetch side is now done without Daytona. Execution is still a sandbox if it ships.

**Leverage used:** Phase 1 `engine.gather` already did recursive tree + raw fetches. Marketplace clone was the shell-era wrapper. Current app: HTTP replay, no clone.

Tenki: parked.

---

## 7. Files that matter for this window

| Path | Why |
|---|---|
| `src/entitlement.ts` | `BILLING_LIVE`, `OPEN_PLAN`, `resolvePlan`, `FEATURE_TIER` |
| `src/billing.ts` | `planFromSubscription`; checkout no-ops while billing off |
| `src/verify/githubToken.ts` | PAT user-scope read/write, probe, fail-closed |
| `src/verify/replay.ts` | `http_1` GET + bearer on GitHub URLs |
| `src/verify/pythonInvoke.ts` | `TOKEN` in RestrictedPython `code` |
| `src/verify/sqlStore.ts` / `sqlSchema.ts` | owner filter, tenant bags, `shouldImportAppState` |
| `src/RunsContext.tsx` | plan, SQL hydrate, `requireGithubToken` |
| `src/pages/Settings.tsx` | GitHub card only (no Anthropic) |
| `src/pipelines/hackjudge_*.pipe` | three live graphs |
| `src/AppDescriptor.ts` / `JudgeHackBrand.tsx` | astronaut lockup |
| `tools/stage2-publish.mjs` | `@me` publish |
| `tools/where-app.mjs` | rung reverse index |

---

## 8. Open / parked (do not start unless asked)

- Store: wait for **`ready`**, then she asks to **`publishApp @public` + `@me`**. Confirm `where-app`.
- Org leftover `ROCKETRIDE_GITHUB_TOKEN` — she deletes in Account → Environment.
- Confirm org/team `ROCKETRIDE_ANTHROPIC_KEY` still set for public explain.
- `@team` vs `@me` version drift — 28 Sep card showed both v49; re-check after any new pack.
- `allowedModules` ignored — report to Josh/Dylan.
- Joe judge 2 (LLM column) — not started; say **“build judge 2”** to start.
- Joe judge 3 / Daytona-for-execution-only — parked until he picks.
- Stripe / `BILLING_LIVE` / Cognee platform chip / Tasks 2–5 — parked.
- Do not submit a *new* version unless she wants a replacement for the one in review.

---

## 9. What *not* to tell users vs owner

| | End user (store) | Poushali (publisher) |
|---|---|---|
| Anthropic | Never | Set once, org/team Environment |
| GitHub PAT | Required in Settings | Her own user-scope PAT for her runs |
| Plan | Full product while billing paused (organizers fail-open) | Leave `BILLING_LIVE` false |
| Runs | Own `userId` only | Teammates see the **app**, not her DummyTest sheet |

---

## 10. One-line state

Judge Hack v49 is on `@me` and Development, in **store review**, catalog-only (Python + HTTP replay, no Daytona/clone), per-judge user-scope PAT, publisher Anthropic, billing fail-open to organizers, run lists isolated by login. Next product slice Joe asked for is **LLM-as-judge as a second column**, not a sandbox, and not sharing Dashboards.
