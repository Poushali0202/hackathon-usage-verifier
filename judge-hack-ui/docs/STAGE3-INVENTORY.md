# Stage 3 data inventory — Judge Hack

Date: 10 Sep 2026  
Org: Poushali's Workspace  
App: `hackjudge.judge-hack` (`@me`)  
Store: `rocketride_sql` / `sql_1` (`storeVariant=default`)  
Verified in: published switcher (not Design preview)

## Entities

| Table | What | Seed vs user | Copy vs regenerate |
|---|---|---|---|
| `hj_runs` | Verification batches; `results` JSONB | All user data | Copy from `appState` only if SQL is empty **and** this workspace has rows. **This tenant had 0 `appState` rows** — nothing to import. |
| `hj_targets` | Custom products only | User data | Same import rule. RocketRide preset is **code** (`ROCKETRIDE_PRESET`), not a SQL row. |
| `appState.runs` / `.targets` | Workspace cache | Fallback if broker down | Import path: `shouldImportAppState` in `sqlSchema.ts`. Banner did not show “imported N rows”. |

## Counts after probe

| | Expected | Observed |
|---|---|---|
| `hj_runs` (Dashboard **runs**) | ≥1 after the post-broker verify | 1 |
| `hj_targets` | 1 throwaway (`Stage3 SQL Probe`) plus any earlier custom rows | `Stage3 SQL Probe` still listed after hard reload |
| Banner imported N | none (blob was empty) | none |
| Old `nnnn` / MMM runs | not in this blob | not present |

## Read paths

- Dashboard / Runs hydrate from SQL (`store.kind === 'sql'`). Banner: *Runs live in staging-managed SQL.*
- Settings → Run history: **Staging SQL**.
- Targets list = preset in code + `hj_targets`.
- Hard reload kept the existing run and `Stage3 SQL Probe`.

## Writes / identity

- Saves go through `saveTarget` / `writeRun` → `actorFrom(useAuthUser())`.
- Settings → Account showed **only Poushali** (name / email / user-id prefix). Same session as the SQL writes.
- `created_by` JSON was not inspected on the Design canvas (no query editor). Stamp is inferred from that signed-in save path.

## What we did not migrate

- Personal / OSS Postgres: not in use. Do not deploy `hackjudge_sql_v1.external.pipe`.
- Leftover env: `ROCKETRIDE_HACKJUDGE_PG_*` unused; leave `storeVariant=default`.
- Prod broker: out of Stage 3.

## Gate 3

- [x] Probe green in signed-in app
- [x] Counts + read paths after reload
- [x] Custom target persisted
- [x] Actor is the signed-in user (Account card)
- [x] No personal DB
