# Stage 4 checklist — Judge Hack

Printed from app-development-docs **06**. Status as of 10 Sep 2026.  
Send the completed sheet (or blockers) to **Shashidhar Babu**.

App: `hackjudge.judge-hack` · publisher `hackjudge` · staging org **Poushali's Workspace**

## Stage 0–3 (already done)

- [x] Staging Cloud connect, `developerId=hackjudge`, `HACKANAPP` redeemed
- [x] BINDINGS.md + CONTRACT.md; scaffolded app; tests + `tsc`; no app-owned server
- [x] No custom node
- [x] Generated pipes, `deployTo`, `verifyApp`, `addApp`, `publishApp @me` (v10)
- [x] Manifest: id, publisher, description, `icon.svg`, README, categories, `authenticated`, settings, billing plans (no `price_*`)
- [x] Stage 3: signed-in `rocketride_sql` green; inventory in `STAGE3-INVENTORY.md`; no personal DB
- [ ] **Org-scope** pipe secrets (blocker for `@team`) — still user overlay. Names in `.env.example`.

## Stage 4 — smoke in the shell

Do this from the **app switcher** on staging (no `dev` badge).

- [x] Launch from switcher (`@me`)
- [ ] First-run / empty states: Dashboard with 0 runs (seen 10 Sep on a fresh tenant before the probe run). RocketRide preset is code, not a SQL seed. Optional: delete `Stage3 SQL Probe` so a teammate’s first Targets list is only the preset.
- [x] Write paths: new run, custom target save, Settings defaults (grace / penalty). SQL persist after reload.
- [x] Scheduled pipes: **N/A** (none)
- [ ] Error states: disconnect / SQL banner / missing GitHub URL already coded (`StoreBanner`, “RocketRide is not connected yet”, fail-closed repo errors). Re-check after `@team` as a second user if possible.
- [ ] Icon + store listing: `icon.svg` + README in the pack. README updated 10 Sep for SQL. **Needs republish** so the listing is not still v10 copy.
- [ ] Publish: `@me` live → **`@team/<name>` after org secrets** → `@public` only via review (do not submit until asked)
- [x] Migration notes: `MIGRATION-NOTES.md`

## Order of remaining work

1. Owner sets the three keys on **org** (or team) Environment overlay. Do not `setEnv` from a script (full-dict replace).
2. Republish `@me` (README + responsive CSS).
3. `publishApp` to `@team/<name>` (team from org memberships).
4. Teammate smoke: open from switcher, one Quick verify.
5. `@public` / `submitApp` only when Shashi wants store review.
