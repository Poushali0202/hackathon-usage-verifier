# Testing Judge Hack on RocketRide: evals and QA strategy

A strategy for this app: a React UI on the platform shell, three catalog
pipelines behind it, and Store subscription billing. The shape is the same
five layers as Converge's `EVALS-STRATEGY.md`. The examples, fixtures and
rules are Judge Hack's. Do not transplant Converge workspaces, Triage,
Board, or "evals means an AI browser worker" into this product.

Companion documents:

- `TEST-PLAN-CORE.md`: the 52-step human QA plan (about 90 minutes). Run it
  before every release. Do not complete a paid checkout in that run.
- `evals/STATUS.md`: not written yet. Start it after the first correctness
  or browser-eval round, and update it after every cycle.
- `Projects/hackathon-usage-verifier/eval/`: the existing offline fixture
  harness (`run_eval.py`, `SCORING_SPEC.md`). That is Layer 2's seed, not
  the live app.

App id `hackjudge.judge-hack`. Until Cloud cutover is done, evals and QA
run on `https://staging.rocketride.ai` against the `@me` (then
`@team/Development`) rung.

---

## 1. Five layers, from fastest to most real

| Layer | What it proves | How often | Judge Hack today |
|---|---|---|---|
| **1. Unit tests and invariants** | Each function is right, and rules that must always hold do hold | Every change, gating every merge and every `npm.cmd run build` | Vitest in `apps/judge-hack-ui` (141 tests, 1 skipped on the last green build) plus `eval/test_stage1.py` (14 tests). Invariants: the LLM never writes tag / backbone / score; a truncated or error payload has no verdict; runs and custom targets are filtered by `owner_user_id`; the subscribed plan is the price nickname, not catalog `stripePrices[0]`; the GitHub token is never logged |
| **2. Correctness evals on real data** | What the engine extracts and decides is right, measured against a hand-judged answer key | Before a release, and after any change to `engine.py`, weights, or Prefill | Official verdict is the Python evaluator (`tool_python`, HTTP GitHub fetch, no clone, no Daytona). Seed key below. Offline fixtures: `python eval/run_eval.py`. Live drift: `python eval/run_eval.py --live` plus the five QA-sheet repos. Explain prose is advisory and must not contradict the engine |
| **3. Pipeline evals** | One feature end to end, including its failure paths, with the platform faked where we can | Every change to that pipe | Three pipes: Python V1 (score), Explain V1 (prose after the verdict), SQL V1 (runs and custom targets). Failure paths: missing / bad PAT, 404, truncated tree, Anthropic unset (`Model explanation unavailable` and the tag still stands), SQL broker down (blob banner, not a crash) |
| **4. Browser scenarios run by an AI agent** | The real deployed app, clicked through like a person would | Later: one scenario a cycle, rotating | Not started. When it starts, reuse the human plan's step language and prefixes (`Eval-S1-*` targets, `QA-eval-*` run names). Stay on staging until production is explicitly opened |
| **5. A human test plan** | A person can do the whole judging job, in order | Core run before every release; extended run weekly / after billing or store changes | `TEST-PLAN-CORE.md`: 52 steps, about 90 minutes. An extended run (live card purchase, plan label updating immediately after checkout, second-account isolation, addresses and reloads) is reserved, not written yet |

The lower layers are cheap and catch most regressions. The upper layers catch
what only shows up in the real product: layout, wording, two screens
disagreeing, checkout, and platform behaviour.

**"Evals" in this file means Layer 2 first** (hand-judged repos vs engine
tag / backbone / score). It does not mean the Converge browser worker. That
worker is Layer 4 and comes after the first clean human core run.

---

## 2. The loop

```
gate (vitest + test_stage1.py + run_eval.py fixtures)
  -> one browser scenario, or one human core section if Layer 4 is not up
  -> report (steps, exact words, defects, screenshots)
  -> each defect becomes a fix, whose commit names the report
  -> deploy to staging @me (pin @team/Development when the pack is ready)
  -> the next round re-checks every fix
```

- **Run one scenario per cycle and rotate through them.** Each run then
  stays short and readable, and a fix is re-checked within a few hours.
- **Keep one status page, updated after every cycle** (`evals/STATUS.md`
  once the first round exists). It says what the evals are, results per
  round, what shipped, and what is still open.
- **Ship fixes between cycles,** so the remaining scenarios of a round run
  on the fixed build.
- **Gate on exit codes, not on output.** `npm.cmd run build` already chains
  gen, `tsc --noEmit`, vitest, `test_stage1.py`, and rsbuild. Do not pipe
  those through `tail`.

---

## 3. How to write a good scenario

1. **One action and one check per step.** "Press Run verification" and then
   "the toolbar reads `5 / 5 verified` and `Significant: 1 · None: 3 ·
   FAILED: 1`".
2. **Write down the exact expected words.** If the wording differs but the
   meaning is the same, record it as a FAIL with the words seen. Paraphrase
   hides bugs.
3. **Make two screens agree.** This is the most valuable check there is.
   *Judge Hack:* the Runs row for `QA-core-sheet` (Repos `5 / 5`,
   Significant `1`, Flagged `0`) must match that run's grid (five rows,
   toolbar `Significant: 1 · None: 3 · FAILED: 1`). The hopper dossier tag
   and score must match the hopper grid row. Dashboard tiles are
   workspace-wide and include leftover runs: do not require them to equal 5.
4. **Create your own data under a prefix and delete what the app can
   delete.** Custom targets `Eval-S1-Cognee` / `Eval-S1-Dummy`. Batch names
   `QA-eval-sheet`, `QA-eval-flag`. Delete custom targets through Targets
   even after a failure. **There is no control that deletes a run.** Leave
   the run names in the report so the next pass expects them. Never delete
   or retarget `RocketRide (preset)`.
5. **Say how to work out a number instead of naming it,** when the data
   can change. Hopper's 4.5 is pinned from the last clean run; if the
   breakdown chips change, record them and check that they still sum to the
   score shown. Do not fail a release solely because a public repo added a
   file.
6. **Use one report format:**
   - a table of step, did, saw, verdict and screenshot
   - then Defects, most serious first, each with the exact text, the
     address and the screenshot
   - severity: blocker, high (wrong verdict, wrong money, or lost work),
     medium (two screens disagree), low (wording or layout)

---

## 4. Do's

- **Test the running app.** Never report a verify, a plan label, or a
  token status as working from reading code.
- **Use real public repositories** for anything a judge sees. The core
  answer key is `vraj00222/hopper`, `octocat/Hello-World`,
  `sindresorhus/p-map`, `colinhacks/zod`, and
  `Mr-Shockwave/Trailbridge`. Constructor
  (`ramizik/constructor`) is the existing live-drift check in `run_eval.py
  --live`, not a core-run sheet row.
- **Make sure each check can actually fail.** A missing GitHub token must
  produce **GitHub token required.** / fail-closed, not a scored None. A
  404 must show **FAILED** (score `-`, backbone `-`), not Significant and
  not a scored None.
- **Treat explain prose as a claim to check, not a result.** The engine
  owns the tag, backbone and score. If the model is down, the exact line
  is "Model explanation unavailable" and the verdict is unchanged.
- **Record UNCLEAR honestly** when a step could not be judged, and say
  why (SQL broker down, GitHub quota, hopper repo moved).
- **Check the browser console** on every page. Warnings that name the app
  go in the note; errors are a FAIL.
- **Tie every fix to the report that found it.** Then re-check it in the
  next round and mark it "confirmed".
- **Keep the GitHub token in a password manager.** Settings may save it
  and must never echo it. Never paste it into a report, a screenshot, or
  chat.

## 5. Don'ts

- **Don't touch data you didn't create.** Other judges on the Development
  team have their own SQL rows. Do not delete their custom targets. The
  RocketRide preset is shared product, not a QA row.
- **Don't leave the token removed.** Section 9 of the core plan removes it
  on purpose and must restore it. A Layer 4 worker that clears Settings
  must put the token back before it exits.
- **Never print secrets.** The judge GitHub PAT, `ROCKETRIDE_ANTHROPIC_KEY`,
  Stripe secrets, and browser-session files are read inside scripts or
  typed into the page. They are never logged, screenshotted, or put in a
  report. There is no Anthropic field in the app; that key lives on the
  org overlay.
- **Don't let an AI judge gate a release.** Explain is advisory. A model
  that rewrites None to Significant is a defect, not a new answer key.
  The dummy `agent_rocketride` on the Python pipe must not answer or emit
  JSON.
- **Don't count a screenshot as proof of a visual fact.** Read the words
  and the computed state (hot Plans card, FAILED pill, allowance line).
- **Don't blame the app for a platform outage, or the other way round.**
  "Runs are saved in this workspace only until storage reconnects." is a
  healthy blob-fallback state. A page that will not load, or every run
  refusing to start on a broker / engine error, is an outage: record it,
  stop, re-run later. A lost run is never a pass or a fail.
- **Don't clear site data or switch accounts in the middle of a run,**
  unless the step says to.
- **Don't invent Stripe `price_*` ids, and don't complete a paid checkout
  in the core run.** Checkout is live (`mode: subscription`, monthly
  Developer $20 / Company $100 / Organizers $200). Completing a card
  charge, and checking that Plans / Settings / Dashboard show the new
  plan without a manual refresh, belongs in the extended run.
- **Don't treat the sidebar Upgrade / See plans card as a paywall.** A
  FAIL is a checkout **dialog** over a verify, or a plan label that stays
  on the previous tier after a successful payment.

---

## 6. What to consider before you start

| Question | Why it matters | What Judge Hack does |
|---|---|---|
| **Staging or production?** | Production has other orgs and real cards | Stay on `staging.rocketride.ai` until the Cloud checklist is green. Browser resolution is `@me`, then `@team/Development`, then `@public` |
| **Which account?** | Tests share the org subscription and the SQL workspace | One subscribed staging account (Developer is enough for the core run). The shell will not open the app while the org is unsubscribed. Feature gates follow the subscribed plan: custom scoring weights are Company / Organizers |
| **Signing in from automation** | Google / Zitadel often refuse Playwright's own browser | When Layer 4 starts: capture a session once with real Chrome, reuse it headless. Never commit the session file |
| **Cost** | Every scored repo spends a short explain LLM call and GitHub quota | Use the small fixed public repos. Prepaid allowance meters in MB and hard-stops at zero. These sheets must not empty the balance |
| **Rate limits** | GitHub allows 5,000/hour on a PAT, 60/hour anonymous | The app fetches over the GitHub API with the judge's token. No clone, nothing on disk. A missing token fails closed; do not run anonymous |
| **Platform quirks** | App Builder can rewrite `.env` to whichever host it last connected | Writes use `--target staging` or `--target cloud`. Never click + Deploy in App Builder for this app |
| **Flaky infrastructure** | A lost network or a broker outage makes a run unreadable | Re-run that scenario. One bad run is never a pass or a fail |
| **Who fixes what** | Reports pile up if nobody owns them | App defects stay in Judge Hack. Broker / Stripe / shell CheckoutModal copy (including the Subscribe em dash) are platform |

---

## 7. Invariants that must always hold

Test these in Layer 1 (unit) and force them onto the screen in Layers 4 and 5.

1. **The LLM never writes tag, backbone, or score.** If explain fails, the
   engine verdict still stands. None + backbone Yes is impossible.
2. **Incomplete data never becomes a scored tag.** Missing token, 404,
   private repo the token cannot read, truncated tree, evaluator crash:
   **FAILED** or a fail-closed notice, never Significant / Moderate / Less
   / None wearing a disguise.
3. **A custom target actually applies.** Hopper scored on the Cognee
   rubric is None. A Significant Cognee verdict on hopper is severity high.
4. **Tenancy is `owner_user_id`, not a workspace switcher.** A second
   signed-in user must not see your runs or custom targets. Unstamped
   legacy `appState` rows are a known hole for the extended run, not a
   pass.
5. **Two surfaces of the same run agree.** Runs row, grid toolbar, hopper
   dossier. Dashboard totals may include leftover runs.
6. **The plan on screen is the subscribed nickname.** After a successful
   checkout the Plans hot card, Settings plan line, and Dashboard
   entitlement change to the paid tier without a manual refresh. Do not
   map entitlement from catalog `stripePrices[0]`.
7. **The prepaid meter never goes below zero,** and a sheet that would
   overshoot is refused or truncated. The allowance line (`X of Y left`)
   is shown while billing is live.
8. **Secrets stay secret.** Token value never returns in Settings, errors,
   or run logs.

---

## 8. Layer 2 answer key (seed)

Official source of truth: the Python evaluator. Thresholds (from
`SCORING_SPEC.md`): Significant is score ≥ 4 and backbone Yes or Partial;
Moderate is 2 ≤ score < 4 (or score ≥ 4 with backbone No); Less is
1 ≤ score < 2; None is score < 1 or overclaim.

**Live-app exception:** an inaccessible repo is **FAILED** in the UI
(score `-`, backbone `-`), not a scored None. `SCORING_SPEC` D3 still
says None for inaccessible. Do not copy that line onto a live-app step.
A 404 that lands as None or Significant is severity high.

| Repo | Target | Event date | Penalty | Expect |
|---|---|---|---|---|
| `vraj00222/hopper` | RocketRide (preset) | 2026-08-03 | 2 | Significant, 4.5, backbone Yes, Built on "in window" |
| `vraj00222/hopper` | RocketRide (preset) | 2026-09-10 | 2 | Moderate, 2.5, Flagged, work back to 2026-08-03, window `(2026-09-08 → 2026-09-12)`, penalty **−2** |
| `octocat/Hello-World` | RocketRide (preset) | 2026-08-03 | 2 | None, 0.0, backbone No |
| `sindresorhus/p-map` | RocketRide (preset) | 2026-08-03 | 2 | None, 0.0, backbone No |
| `colinhacks/zod` | RocketRide (preset) | 2026-08-03 | 2 | None, 0.0, backbone No |
| `Mr-Shockwave/Trailbridge` | RocketRide (preset) | 2026-08-03 | 2 | **FAILED**, score `-`, backbone `-` |
| `vraj00222/hopper` | Cognee (filled from `topoteretes/cognee` + `docs.cognee.ai`) | 2026-08-03 | 2 | None (hopper does not use Cognee) |

First correctness round can stay this set. Add cases after (constructor
live-drift, hosted-only, scaffold-only, reused pipeline, tampered
history). Offline fixture files already cover several of those shapes
under `eval/fixtures/`.

Explain check, advisory only: hopper prose must not imply a different
tag, score or backbone than the chips. None repos must not claim
RocketRide usage. Invented file names are a defect.

Prefill check (Targets, not the scorer): Cognee name is a product name,
never a docs heading; invocation holds real tokens (`import cognee`,
`cognee.add`); drop starter / eval workspace packages.

---

## 9. Three Judge Hack scenarios, in brief

These are the Layer 4 set to write after the first clean human core run.
They are not running yet.

**S1, two judges (isolation).**
- Sign in as judge A, create `Eval-S1-Cognee` (and `Eval-S1-Dummy` if the cycle needs a manual target) and `QA-eval-s1` run.
- Sign in as judge B on the same staging org (or a second browser profile).
- B must not see A's custom target or A's run. Reload both.
- Delete `Eval-S1-Cognee` and `Eval-S1-Dummy` from A's Targets. RocketRide (preset) remains.
- Result wanted: nothing leaks across `owner_user_id`.

**S2, one batch, three surfaces (reconciliation).**
- Upload `eval-sheet.csv` as `QA-eval-s2`.
- Toolbar, hopper dossier, and the Runs row must agree. FAILED is
  trailbridge only. Dashboard tiles may be larger.
- Quick verify hopper on the same date must match the hopper dossier
  score. Drift is severity high.
- This scenario finds most "two screens disagree" defects.

**S3, fail-closed and explain-down.**
- Remove the GitHub token: Quick verify refuses; no scored verdict.
- Restore the token. Verify trailbridge: FAILED, not a tag.
- If org Anthropic is missing, hopper still scores and the dossier shows
  "Model explanation unavailable".
- Result wanted: the engine owns the verdict; incomplete data never
  becomes Significant.

A later **S4** covers the subscribed-plan loop: open checkout, pay a
different monthly plan, close the modal, and read Plans / Settings /
Dashboard without refreshing. The hot card and the entitlement line must
be the plan just paid.

---

## 10. Starting on this app: a checklist

1. The five invariants in section 7 are already partly gated in vitest
   (`verify-failclosed`, `identity-billing`, SQL owner filters). Keep them
   gating every merge.
2. The seed answer key in section 8 is the first Layer 2 set. Run
   `python eval/run_eval.py` on every change to the evaluator. Add live
   rows as Shashi files them; do not let a model rewrite the key.
3. Write S1 to S3 (then S4) in the same step language as
   `TEST-PLAN-CORE.md`, with prefixes and cleanup.
4. The human core run already exists. Write the extended run when billing
   or isolation needs a weekly pass.
5. Set up the loop only after one clean core run:
   - gate before each cycle
   - one scenario per cycle
   - reports in one format
   - `evals/STATUS.md`
6. Environment rules, in writing, before Layer 4 touches a browser: staging
   URL, which subscribed account, own `Eval-*` / `QA-eval-*` data only,
   how the GitHub token is typed, no paid checkout unless the scenario is
   S4, cost budget is the prepaid MB line from Dashboard.

---

## 11. What this is not

- Not Converge's five hourly production workers, and not their workspace
  delete dialogs.
- Not a Cloud cutover plan (`PROD-CHECKLIST.md` is that).
- Not a request to publish `@public` or to click + Deploy.
- Not a substitute for `TEST-PLAN-CORE.md`. A person still runs the core
  plan before a release. Evals catch scoring and isolation regressions
  between those runs.
