# Judge Hack — migration notes (Stage 4)

Send with the [06 checklist](./STAGE4-CHECKLIST.md) to Shashidhar Babu.

App: `hackjudge.judge-hack` · org **Poushali's Workspace** · staging `https://staging.rocketride.ai`  
Date: 10 Sep 2026

What diverged from the app-development guide, and why.

## Followed

- Scaffold via `createApp` under `hackjudge`. Catalog-only pipes. No `hackjudge_*` custom node (Dylan / catalog rule).
- Pinned Python evaluator in catalog `tool_python` (RestrictedPython; `urllib`/`html` allowlisted so it reaches the GitHub API). Daytona + git clone retired 23 Sep (Rod's clone concern): fetch is REST + raw only, with the judge's own token. Dummy `agent_rocketride` only so `python.execute` / SQL `execute` can be `client.tool`; agent must not invent JSON.
- `verifyApp` → `addApp` → `publishApp @me` (v10 on 3 Sep). Pipes `deployTo` a team.
- Durable UI in `usePrefs` / `useWorkspace`. No `localStorage`. Writes stamped with `useAuthUser()`.
- Billing: three one-time plans on the manifest. **No invented Stripe `price_*`.** Checkout is `CheckoutHost` / `shell:subscribe`.
- Stage 3 store is `rocketride_sql` (`sql_1`). Personal Postgres used once on 30 Aug as a throwaway and **reversed**. External `db_postgres` variant stays in the generator only.

## Divergences

| Guide | What we did | Why |
|---|---|---|
| Secret names `ROCKETRIDE_<APP>_<PURPOSE>` | Live names are `ROCKETRIDE_ANTHROPIC_KEY` (org) and `ROCKETRIDE_GITHUB_TOKEN` (per-judge, user scope). `ROCKETRIDE_DAYTONA_KEY` is no longer referenced. | Already on the overlay. Renaming would break `@me` until every reference and overlay key moved together. `.env.example` documents this. |
| Org-scope Environment overlay before `@team` | Still **user** overlay as of Stage 3 close | `@me` judging works for Poushali. Teammates will not resolve keys until she copies the three names to **org** (or team) scope. Owner must set — do not script `setEnv`. |
| Stage 3 export from a personal DB | Old store was workspace `appState`, not Aura/Supabase | This tenant’s `appState` was empty; import skipped. Inventory: `STAGE3-INVENTORY.md`. |
| `rocketride_sql` probe from API-key tools | `npm run sql-probe` fails `ROCKETRIDE_CLIENT_ID is not set` | Doc 05: by design. Real probe is the signed-in switcher. Staging broker claimed fixed 10 Sep (#2203); **prod not claimed**. |
| Parallel `client.use()` / `useExisting` | `clonePipelineForWorker()` in `pool.ts` | Same `project_id` → “Pipeline is already running.” N evaluator workers need N ids. Rod’s `useExisting=true` is not a substitute. |
| Stable committed `project_id`s | Pins live in `tools/gen-pipes.mjs`. Workspace `pipelines/` (and some `src/pipelines` copies) have **drifted** | Design-watched folder / deploy write-back. Actor not traced. Runtime clones anyway. |
| `shell:loginRequest` for sign-in | Removed from the app | Design preview spun on “Sign in required.” `@me` is already inside the staging shell. |
| Config-as-data: no org names in code | RocketRide **preset** keeps the name | That is the **judged** platform, not publisher branding. Custom targets are user data. |
| `deploy.setSchedule` | Unused | Runs are user-triggered. Gate “observe a scheduled pipe once” is N/A. |
| pnpm-only workspace | App scripts use `npm.cmd` on Windows | Rest of this machine’s RocketRide workspace is mixed; Judge Hack’s package scripts are npm. |

## Not in v1

- Deploy-ops APIs (pending product discussion).
- `@public` / store review — not submitted.
- Responsive CSS (960 / 680 / 420) is in the working tree; **not** confirmed on `@me` v10 (3 Sep). Republish before treating the switcher as the listing screenshot.
