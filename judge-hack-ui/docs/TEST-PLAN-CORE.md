# Judge Hack end-to-end test plan: the core run

One run, 52 steps, about 90 minutes. Run it before every release. Written
against the current `@me` build on `https://staging.rocketride.ai`, app
`hackjudge.judge-hack`, with Converge-style Store billing (`mode: subscription`,
monthly plans, `BILLING_LIVE` true). An extended run (live card purchase, the plan label updating immediately
after a successful checkout, multi-user isolation, keyboard, addresses and
reloads) will follow as its own file; the step ids here are reserved so
results from both runs compare. Do not complete a paid checkout in this
core run.

A note on calibration: some steps say a result is "of the form" rather than
quoting exact words, because this plan predates its first clean run. On the
first run where such a step passes, write the exact words you saw into the
note column; they become the pinned wording for every later run. Do not pin
hopper's five breakdown chips until that first clean run: a repo change must
not fail a release.

Contents

1. Before you start
2. Sections 1 to 10, the steps
3. Results and defects

---

## 0. Before you start

### What you need

- A RocketRide account that can sign in to `https://staging.rocketride.ai`
  and open **Judge Hack** from the switcher. You need an existing Judge Hack
  subscription (Developer is enough). Checkout is live; the shell will not
  open the app while the org is unsubscribed. Feature gates follow the
  subscribed plan. Do not start a new paid checkout during this run.
- Your GitHub fine-grained personal access token in a password manager
  (read-only Contents and Metadata is enough). Never paste it into a report,
  a screenshot, a chat message or this file. Section 1 saves it if it is
  missing; section 9 removes it and must restore it.
- Two CSV files, made before you start (contents below): `eval-sheet.csv`
  (5 rows) and `eval-flag.csv` (1 row).
- A browser you can fully reload, with its console openable.
- Ninety minutes in one sitting. Screenshot only what fails.

### The two sheets

`eval-sheet.csv`:

```
project,github
hopper,https://github.com/vraj00222/hopper
hello-world,https://github.com/octocat/Hello-World
p-map,https://github.com/sindresorhus/p-map
zod,https://github.com/colinhacks/zod
trailbridge,https://github.com/Mr-Shockwave/Trailbridge
```

`eval-flag.csv`:

```
project,github
hopper,https://github.com/vraj00222/hopper
```

These rows are chosen because their verdicts are known and stable: `hopper`
is Significant with backbone Yes (score 4.5 on the last clean run),
`Hello-World`, `p-map` and `zod` are None (no RocketRide usage), and
`Trailbridge` is a 404 and must land as **FAILED**, never as a scored tag.

### What the 90 minutes is spent on

| Part | Steps | Minutes |
|---|---|---|
| Before you start: sign in, sheets made | 0 | 5 |
| 1. Sign-in, Dashboard, and the token | 6 | 8 |
| 2. Targets and Prefill | 8 | 14 |
| 3. New run: the 5-repo sheet | 6 | 10 |
| 4. The grid and three dossiers | 10 | 12 |
| 5. The pre-event flag | 3 | 8 |
| 6. Quick verify | 4 | 8 |
| 7. Runs history | 4 | 5 |
| 8. Plans (Store subscription, no purchase) | 2 | 4 |
| 9. Settings and the token | 5 | 8 |
| 10. Cleanup | 4 | 4 |
| Hand back the results | 0 | 4 |
| Total | 52 | 90 |

If you are running behind, drop D5, H3, U3 and T5, which are the four
arithmetic or classification checks, and say in the results that you dropped
them.

### What this run costs

Every verify spends two real budgets: one short LLM call per scored repo for
the prose, and your GitHub token's request quota. Dashboard and Settings
show a live prepaid allowance (`X of Y left`). These sheets are small so
they must not empty that allowance or open checkout. If a paywall appears
over a verify, record the remaining line you saw in A3 and stop: that is
either a depleted org or a defect, not a paused-billing skip.

Name the two New-run batches `QA-core-sheet` and `QA-core-flag` so leftover
runs from an earlier pass are obvious.

### What PASS means

A step is PASS only when you read the expected result off the screen. Not
inferred, not assumed, not "it probably did". Where this plan pins exact
words in quotes, wording that differs in words but not in meaning is a FAIL,
recorded with the words you saw. Where it says "of the form", judge the
shape and record the exact words. If a step cannot be run at all, mark it
"not run" and say why.

Two standing rules on every page you visit: the browser console shows no
errors, and no prose anywhere contradicts the verdict (a justification that
disagrees with the tag, score or backbone of its own dossier is a defect
every time, severity high). The LLM must never write the tag, backbone or
score; if explanation fails, the engine verdict still stands.

Some defects are already known and being worked on. Report what you see
anyway. A second report of a known defect costs nothing; a silent one costs
a release.

### How to record a result

Fill in the results table in section 11, one row per step id. Screenshot
only the screens where something fails, and name the file after the step:
`D5.png`.

### Platform states this plan tolerates

Runs are stored in staging-managed SQL when that broker is up. The app does
**not** print a success sentence for SQL. Record which of these you saw in
A2:

- **SQL healthy:** no storage banner on Dashboard or Runs.
- **Blob fallback:** a notice reading exactly "Runs are saved in this
  workspace only until storage reconnects."

Either is a healthy app state for this run. If instead every page fails to
load or every run refuses to start on a platform error, that is a platform
outage, not an app defect: record it, stop, and re-run later. A lost run is
never a pass or a fail.

---

## 1. Sign-in, Dashboard, and the token

| ID | Do | Expect |
|---|---|---|
| A1 | Open `https://staging.rocketride.ai`, launch **Judge Hack** from the switcher, and sign in if asked. | The app shell loads: a left rail reading, in order, "Dashboard", "Targets", "New run", "Quick verify", "Runs", "Plans", "Settings", with Dashboard open. |
| A2 | Read the top of the Dashboard for a storage notice. | Either no notice (SQL is live), or the exact banner "Runs are saved in this workspace only until storage reconnects." Record which. Any third wording is a FAIL. |
| A3 | Read the signed-in card. | "Signed in with RocketRide", then your name and email, then a plan name (Developer / Company / Organizers), optional billing status, and an "X of Y left" allowance line. **Subscribe** and **Plans** buttons are present. |
| A4 | In the page header, press the theme button (it reads **Light** when the page is dark, **Dark** when the page is light), then fully reload. | The theme flips, and after the reload it is still the one you chose. Flip it back. |
| A5 | Open the browser console on the Dashboard. | No errors. Warnings are not a failure; record them if they name the app. |
| A6 | Open **Settings** and read **GitHub access**. If it already says "your token is saved", stop. If it says "no token - runs are blocked", paste the token from the password manager into the empty box and press **Save token**. | Status is **your token is saved**. After a save, a line of the form "Saved for @<login> · N API calls left this hour." The box is empty again; the token value is not shown. Never screenshot that field. |

---

## 2. Targets and Prefill

| ID | Do | Expect |
|---|---|---|
| T1 | Open **Targets**. | A chip for **RocketRide (preset)** is listed and selected. Controls **New target** and **Use LaserData example** exist. |
| T2 | Press **New target**. | The editor opens. Name field labelled "What is this product called?". A block "Start from the product’s public surface" with a repo field, "Docs URL (optional)", "Package name (optional)", **Attach files**, and **Fill from sources**. The form is empty; nothing fills without your click. |
| T3 | Enter repository `https://github.com/topoteretes/cognee` and docs `https://docs.cognee.ai/`, and press **Fill from sources**. | The button reads **Filling…**, then a box "Filled from <repo>. Check the fields below, then save." Name reads "Cognee" (a product name, never a docs heading such as "TIER 1" or "Getting Started"). Invocation holds real API tokens (`import cognee`, `cognee.add`, `cognify` or of that form). Env / hosted markers hold consumer-shaped keys (`COGNEE_API_KEY` class). CLI holds real `cognee-cli` lines, not prose sentences. |
| T4 | Read any warnings under the fill result. | If a source could not be fetched, a visible warning names it (the docs host resetting is a known case and is not an app defect). With warnings present, distrust-and-review is the rule: every filled token must still be real Cognee surface. Record the warnings seen, or "none". |
| T5 | Read **What architecture do judges see?** | **SDK / library** is selected. "Data / gateway platform" for Cognee is a known wrong classification and is a FAIL. |
| T6 | Save the target. | "Cognee" appears in the chip row beside "RocketRide (preset)". |
| T7 | Press **New target** again. Name `Eval-Dummy`. On "What is the package called?" type `left-pad`. Save. | It saves and lists. The editor accepted manual entry with no sources. |
| T8 | Reopen "Cognee", change one token, save, fully reload, and reopen it. | The change survived the reload. Undo it and save again. |

---

## 3. New run: the 5-repo sheet

| ID | Do | Expect |
|---|---|---|
| N1 | Open **New run**. The stepper reads "1 Event", "2 Target", "3 Submissions". Set Event name `QA-core-sheet`, event date `2026-08-03`, pre-event work penalty `2`, and press **Continue →**. | The Target step. The select offers "RocketRide (preset)", "Cognee", and "Eval-Dummy". Help under RocketRide reads "Scores committed pipelines, agent and LLM nodes, and whether RocketRide is the backbone. Use a custom target for other products." |
| N2 | Leave **RocketRide (preset)** selected and press **Continue →**. | The Submissions step: "Submissions sheet (CSV / XLSX)", a drop zone "Drop your submissions sheet here" or click to browse, accepting .csv / .xlsx. |
| N3 | Upload `eval-sheet.csv`. | A file chip of the form `eval-sheet.csv · 5 repos`. |
| N4 | Press **Run verification**. | The page becomes this run's grid. While it runs, a bar and a stage line of the form "verifying… #1/5 fetching N files over GitHub API". Progress counts toward 5. |
| N5 | Watch for interruptions while the run starts and runs. | No subscribe or checkout **dialog** over the run. The sidebar Upgrade / See plans card is not a fail. If a checkout modal or paywall appears, FAIL with its exact words (these sheets must not exhaust the prepaid allowance). |
| N6 | When the run finishes, read the toolbar above the table. | "5 / 5 verified" and tag counts exactly: `Significant: 1 · None: 3 · FAILED: 1` (order may vary; the three numbers must be those). Nothing in Moderate or Less. |

---

## 4. The grid and three dossiers

All steps are on the run from section 3. The grid is a **table**, not cards.
There are no filter chips.

| ID | Do | Expect |
|---|---|---|
| D1 | Read the five rows, then click the `hopper` row. | Five project rows. hopper is the Significant one. Clicking it opens the dossier overlay, not a filtered table. |
| D2 | Read the hopper dossier header and link row. | Tag chip "Significant", score 4.5. A **Source code** button to GitHub. No Live demo or Demo video (this sheet has none). A chip "not deployed". |
| D3 | Read the verdict in the header. | The verdict chip reads "Significant" with score 4.5. |
| D4 | Read the Summary line. | Of the form "Deterministic score 4.5 → Significant / backbone Yes; 1/1 pipeline(s) called." (Unicode arrow, not `->`). |
| D5 | Read the **Score breakdown** chips and add them by hand. | Positive chips that sum to 4.5, the score shown. On the last clean run they were of the form "+1 dependency in manifest", "+2 pipeline called: …", "+0.5 complexity mid (5 nodes)", "+0.5 SDK call-sites (12)", "+0.5 SDK spread (2 files)". Record the exact chips you saw. A breakdown that does not sum to its own score is severity high. |
| D6 | Read **What it is**, **How RocketRide is used**, **Verdict rationale**, and the tower. | The description and rationale never contradict the verdict: nothing says or implies a different tag, score or backbone than the chips. Backbone is Yes and at least one tower layer carries a load-bearing mark. |
| D7 | Read the grid's **Built on** cell for hopper (go back with **← All projects** if the dossier is still open). | "in window". No **Flagged** banner, no "pre-event", no penalty line. The string "Repo history:" does not appear; do not look for it. |
| D8 | Open the `hello-world` dossier. | Tag "None", score 0.0, backbone "No", empty or zero breakdown, and prose that does not claim any RocketRide usage. |
| D9 | Read the `trailbridge` row without treating it as scored. | Tag pill **FAILED** (red). Score "-". Backbone "-". A reason line under the name of the form that the repository could not be verified. It is the one repo counted under FAILED. An inaccessible repo with Significant / Moderate / Less / None is severity high. |
| D10 | On hopper's dossier, read the prose block. | Either the two prose boxes are filled by the model (an **AI narration** chip on What it is, no apology), **or** a visible callout **AI narration is off** with **Enable AI narration** (opens Environment Variables, not Account) and paragraphs from the evidence table. Settings has its own **AI narration** card with an On/Off pill. In both cases the tag, score and backbone are unchanged. A missing tag because explain failed is severity high: the LLM must not own the verdict. |

---

## 5. The pre-event flag

| ID | Do | Expect |
|---|---|---|
| H1 | **New run** again. Event name `QA-core-flag`, event date `2026-09-10`, penalty `2`, RocketRide (preset), sheet `eval-flag.csv`. Press **Run verification**. | The run completes, 1 / 1 verified. |
| H2 | Open this run's `hopper` dossier. | A **Flagged** banner: work goes back to **2026-08-03**, before the event window `(2026-09-08 → 2026-09-12)`, and "Judge-set penalty applied: **−2** pts." Score 2.5, tag "Moderate". Built on includes "pre-event". |
| H3 | Check the arithmetic by hand. | 4.5 from section 4, minus the penalty 2, is 2.5, and 2.5 falls in the Moderate band (2 ≤ score < 4). The same repo, same evidence, differing only by the event date, moved by exactly the penalty. |

---

## 6. Quick verify

Quick verify is not a single URL box. Event date is required; the button
stays disabled until a date and at least one GitHub URL are set.

| ID | Do | Expect |
|---|---|---|
| Q1 | Open **Quick verify**. | Copy of the form "Spot-check a repository…". Fields: "GitHub repository URL(s)" (one per line), **Target**, **Event date (required)**, **Pre-event penalty (pts)**. Primary button **Verify repository**, disabled until a URL and a date are set. |
| Q2 | Target **RocketRide (preset)**, event date `2026-08-03`, penalty `2`, URL `https://github.com/vraj00222/hopper`. Press **Verify repository**. | Significant, 4.5, backbone Yes: identical to D3. The same repo twice gives the same score twice; any drift between D3 and this step is severity high. |
| Q3 | Same date and target, URL `https://github.com/octocat/Hello-World`. Press **Verify repository**. | None, score 0.0, backbone No. |
| Q4 | Change Target to **Cognee**, keep date `2026-08-03`, URL hopper again. Press **Verify repository**. | Tag **None** (hopper does not use Cognee). A Significant verdict on the Cognee rubric for hopper is severity high: the custom target did not apply. |

---

## 7. Runs history

This plan creates five runs: `QA-core-sheet`, `QA-core-flag`,
`Quick verify - hopper` (twice: RocketRide then Cognee), and
`Quick verify - Hello-World`.

| ID | Do | Expect |
|---|---|---|
| U1 | Open **Runs**. | Those runs are listed, newest first. Columns: Run, Event date, Repos, Duration, Significant, Flagged, Status. There is **no** None column and **no** FAILED column. |
| U2 | Open `QA-core-sheet` from the list. | The same grid as section 4: five rows, same tags, toolbar `Significant: 1 · None: 3 · FAILED: 1`. |
| U3 | For `QA-core-sheet` only, compare three surfaces. | The Runs row reads Repos `5 / 5`, Significant `1`, Flagged `0`. The grid has five rows and the toolbar counts above. Dashboard tiles are workspace-wide (they include leftover runs); do not require them to equal 5. Two surfaces of **this run** disagreeing is severity medium. |
| U4 | Fully reload the browser and reopen **Runs**. | The same runs are still listed. Persistence held in whichever storage state A2 recorded. |

---

## 8. Plans (Store subscription)

No purchase is made in this run. Completing Stripe checkout belongs in the extended run.

| ID | Do | Expect |
|---|---|---|
| P1 | Open **Plans**. | Intro mentions prepaid allowance and the RocketRide billing modal. Three cards: Developer **$20 per month** with "4 MB included · about 8 repos", Company **$100 per month** with "20 MB included · about 40 repos", Organizers **$200 per month** with "40 MB included · about 80 repos". Each card's button is enabled and reads **Subscribe \<plan\> →** (or **Manage billing →** on the current plan). |
| P2 | Read the **How metering works** block. | Four headings, in order: "One simple rate", "Prepaid & metered live", "Hard stop at zero", "Need more?". Under the first: "$5 per MB of code verified, on every plan. An average repo is 500 KB, so about $2.50 per repo." Under the third: "The next run is refused the instant the balance is empty. Usage can never exceed what you paid." Under the fourth: "When your allowance runs out, the next run is refused. You can never spend more than you have paid. Upgrading to the next plan is the cheapest way to add capacity." Developer card lists "2 custom targets". No mention of metered top-ups or auto-recharge. |

---

## 9. Settings and the token

This section removes your GitHub token and must end with it restored.

| ID | Do | Expect |
|---|---|---|
| S1 | Open **Settings** and read **GitHub access**. | Status **your token is saved**. The value is never shown. A **Remove** button is present. |
| S2 | Press **Remove**. | Status **no token - runs are blocked**. A note "Token removed. Runs will fail closed until a new one is added." |
| S3 | Open **Quick verify** (do not paste a token). Set a URL and a date and press **Verify repository**. | It fails closed. A notice **GitHub token required.** with a Settings link, and/or "Verification failed: GitHub token missing - add your personal access token in Settings → GitHub access". No scored verdict. A scored verdict with no token is severity high; so is an anonymous low-score verdict, which is the same defect wearing a disguise. |
| S4 | Re-enter your token in Settings and press **Replace token** (or **Save token**). | Status **your token is saved** again. This step is mandatory whenever S2 ran, even if S3 failed. |
| S5 | Think back across the whole run and check the screen one more time. | At no point did the app print the token's value back: not in Settings, not in an error, not in a run log. Anywhere it did is severity blocker, and the token must be revoked after the run. |

---

## 10. Cleanup

Through the app's own controls, never by any other means.

| ID | Do | Expect |
|---|---|---|
| Z1 | Delete the targets "Cognee" and "Eval-Dummy" from the Targets page (**Delete** on a custom target). | Both leave the chip row. **RocketRide (preset)** remains. Any targets that existed before this run remain. |
| Z2 | Look for a control that deletes a run. | There is none. Mark **not run** by design. Write the five run names in the note so the next pass expects them. |
| Z3 | Check the end state. | Theme as you found it, token saved (S4), no dialog left open, Cognee and Eval-Dummy gone. |
| Z4 | Record what this run spent. | Write the Dashboard allowance line from A3 (`X of Y left`) and that five runs remain in history. The line must still be present; do not treat a missing meter as paused billing. |

---

## 11. Results

One row per step id. PASS, FAIL or "not run". Put the exact words you saw in
the note column whenever they differ from the expected ones, and wherever a
step says "of the form", also when they match: that pins the wording for the
next run.

| ID | Verdict | Note |
|---|---|---|
| A1 |  |  |
| A2 |  |  |
| A3 |  |  |
| A4 |  |  |
| A5 |  |  |
| A6 |  |  |
| T1 |  |  |
| T2 |  |  |
| T3 |  |  |
| T4 |  |  |
| T5 |  |  |
| T6 |  |  |
| T7 |  |  |
| T8 |  |  |
| N1 |  |  |
| N2 |  |  |
| N3 |  |  |
| N4 |  |  |
| N5 |  |  |
| N6 |  |  |
| D1 |  |  |
| D2 |  |  |
| D3 |  |  |
| D4 |  |  |
| D5 |  |  |
| D6 |  |  |
| D7 |  |  |
| D8 |  |  |
| D9 |  |  |
| D10 |  |  |
| H1 |  |  |
| H2 |  |  |
| H3 |  |  |
| Q1 |  |  |
| Q2 |  |  |
| Q3 |  |  |
| Q4 |  |  |
| U1 |  |  |
| U2 |  |  |
| U3 |  |  |
| U4 |  |  |
| P1 |  |  |
| P2 |  |  |
| S1 |  |  |
| S2 |  |  |
| S3 |  |  |
| S4 |  |  |
| S5 |  |  |
| Z1 |  |  |
| Z2 |  |  |
| Z3 |  |  |
| Z4 |  |  |

### Defects

One entry per defect, in this shape:

```
#### <step id>: <one line saying what is wrong>

Severity: blocker | high | medium | low
Address: the address in the bar when you saw it
Saw: the exact words on the screen, in quotes
Expected: the exact words the plan asked for, in quotes
Steps: what you did, from a state somebody else can reach
Screenshot: <step id>.png
```

Severity, as a guide: a blocker stops the run or exposes a secret; high is a
wrong verdict, wrong money or lost work; medium is a contradiction between
two screens; low is wording, layout or something cosmetic.

Three severities are pre-assigned by this plan because they guard the
product's promises: any prose contradicting its own verdict is high; any
scored verdict produced from incomplete data (an unreachable repo, a missing
token) is high; the LLM writing or clearing the tag, backbone or score is
high.
