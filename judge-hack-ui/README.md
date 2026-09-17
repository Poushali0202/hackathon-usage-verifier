# Judge Hack

Judge Hack verifies how hackathon repositories use a target product from fresh
GitHub evidence.

## V1 architecture

The app is fully hosted by RocketRide. Each verification starts a pipeline that uses one
Daytona sandbox execution to fetch repository evidence and run the pinned deterministic
evaluator. The LLM never writes the tag, backbone, or score. The pipeline fails closed for
inaccessible or incomplete repositories.

Compute is included with the Judge Hack subscription — users do not bring a Daytona key.
Developer runs use at most 2 sandboxes (~4 vCPU); Company and Organizers use at most 3
(~6 vCPU). Sandboxes are terminated when the run ends. The workspace also enforces a
shared org pool of 5 live sandboxes (Daytona Limits tier 1 / 10 vCPU) in SQL so two
Store sessions cannot overflow into each other. If the pool is full, Verify shows a
retry modal instead of opening a sixth box. Daytona CPU retry-to-1 remains as a
backstop.

Prepaid metering is a hard stop: Developer 4 MB, Company 20 MB, Organizers 40 MB at $5/MB
(average repo 500 KB). A run that would exceed remaining allowance is truncated; an empty
balance refuses the next verification. Stripe auto-recharge is not wired yet.

Surfaces: Dashboard, Targets (RocketRide preset plus custom products), New run (CSV batch),
Quick verify, Runs (dossier grid + backbone tower), Settings, Plans. Runs and custom targets
live in staging-managed SQL (`rocketride_sql`) when the signed-in app can reach the broker.
If it cannot, the workspace `appState` cache is the store, namespaced per signed-in user.
Personal Postgres is not used. SQL rows and the workspace cache are private to the
signed-in `userId`.

Identity comes from the shell (`useAuthUser()`). Every run and target write is stamped with
the signed-in user. Theme, view, and plan fallback live in `usePrefs()` — not `localStorage`.

Billing is `subscription` mode. Plans (Developer $20 / Company $100 / Organizers $200) are
declared on the manifest; checkout is the shell billing modal (`shell:subscribe`). Entitlements
come from `useSubscriptions()`. Runtime settings `hackjudge.judge-hack.graceDays` and
`hackjudge.judge-hack.historyPenalty` are contributed on the manifest and edited in Settings.

Custom targets use a team default SDK & platform rubric (eight signals). Organizers
describe the product. Company and Organizers plans may change that target’s weights
and tag cut-offs. The RocketRide preset uses the pipeline rubric. Architecture
templates only rename the five-layer backbone plates.

V1 accepts public GitHub repositories. Credentials are resolved from server-side RocketRide
environment secrets:

- `ROCKETRIDE_DAYTONA_KEY`
- `ROCKETRIDE_ANTHROPIC_KEY`
- `ROCKETRIDE_GITHUB_TOKEN`

Migration notes: [docs/BINDINGS.md](./docs/BINDINGS.md), [docs/CONTRACT.md](./docs/CONTRACT.md),
[docs/MIGRATION-NOTES.md](./docs/MIGRATION-NOTES.md).

## Development

Open the `.rrapp` file to launch the App Builder: live preview on the Design tab, identity and packaging on the Package tab, publishing on the Deploy tab.

Stage 1 gate (from the app folder): `npm test` then `npm run build`.

Stage 2: `npm run gen` writes pipes and the evaluator bundle; `npm run stage2`
validates against staging, deploys pipes with `deployTo`, then
`verifyApp` → `addApp` → `publishApp @me`. Dry runs:
`node tools/stage2-publish.mjs --validate-only` and `--verify-only`.
Stage 3: `npm run sql-probe` validates and deploys `hackjudge_sql_v1.pipe`
then `SELECT 1`. An API-key session is expected to fail with
`ROCKETRIDE_CLIENT_ID is not set`; the signed-in switcher app is the real
probe. `hackjudge.judge-hack.storeVariant` stays `default`.

Platform guide for building apps: `.rocketride/docs/ROCKETRIDE_APPS.md` in this workspace.
