# Judge Hack

Judge Hack verifies how hackathon repositories use a target product from fresh
GitHub evidence.

## V1 architecture

The app is fully hosted by RocketRide. Each verification starts a pipeline that uses one
Daytona sandbox execution to fetch repository evidence and run the pinned deterministic
evaluator. The LLM never writes the tag, backbone, or score. The pipeline fails closed for
inaccessible or incomplete repositories.

Surfaces: Dashboard, Targets (RocketRide preset plus custom products), New run (CSV batch),
Quick verify, Runs (dossier grid + backbone tower), Settings, Plans. Runs and custom targets
persist in workspace `appState` until staging-managed SQL is reachable from the
signed-in app (`rocketride_sql`). If the broker does not inject identity, the
workspace cache remains the store. Personal Postgres is not used.

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

Migration notes: [docs/BINDINGS.md](./docs/BINDINGS.md), [docs/CONTRACT.md](./docs/CONTRACT.md).

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
