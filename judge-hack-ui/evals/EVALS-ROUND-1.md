# Judge Hack evals, Round 1

Date: 2026-10-27
Host: https://staging.rocketride.ai
App: hackjudge.judge-hack
Build (whereApp): @team/Development=v60 ready; @me=v62 private; @public=v60 ready; @team/Production=v60 ready
Account: poushalipurkayastha24 (name only)
AI narration key name present: yes
Storage: not observed in the browser. This round called the same `runRepos` / `extractTarget` / `parseCsv` functions Quick verify, New run, and Targets Prefill use, against the signed-in staging connection. Named UI runs were not written to SQL, so there is no blob-fallback banner to quote.
Method: live staging pipes (Python V1 + Explain V1 + extract). Not fixture `run_eval.py`. Not guessed from earlier hopper 4.5 notes.
Cleanup: Eval-R1-Cognee was extracted in-session and not saved on Targets, so there was nothing to delete. Engine cases used run names QA-eval-r1-E1..E6, QA-eval-r1-sheet, QA-eval-r1-headers, QA-eval-r1-E8 (in-process only).

Framing for Shashi: first eval round on the seed answer key; add your evals on top of this.

| Case | Did | Expected | Saw | Verdict |
|---|---|---|---|---|
| E1 | Quick-verify path: vraj00222/hopper, RocketRide preset, event 2026-08-03, penalty 2 | Significant, 4.5, backbone Yes, Built on "in window" | tag=Significant, score=4.5, backbone=Yes, flagged=false, predates=false, earliest_commit=2026-08-03, event_window=2026-08-01 → 2026-08-05, history_penalty=2, explain_failed=false | PASS |
| E2 | Quick-verify path: vraj00222/hopper, event 2026-09-10, penalty 2 | Moderate, 2.5, Flagged, work back to 2026-08-03, window 2026-09-08 to 2026-09-12, penalty minus 2 | tag=Moderate, score=2.5, backbone=Yes, flagged=true, predates=true, earliest_commit=2026-08-03, event_window=2026-09-08 → 2026-09-12, history_penalty=2, explain_failed=false | PASS |
| E3 | Quick-verify path: octocat/Hello-World, event 2026-08-03, penalty 2 | None, 0.0, backbone No | tag=None, score=0, backbone=No, flagged=true, predates=true, earliest_commit=2011-01-26, event_window=2026-08-01 → 2026-08-05, history_penalty=2, explain_failed=false | PASS |
| E4 | Quick-verify path: sindresorhus/p-map, event 2026-08-03, penalty 2 | None, 0.0, backbone No | tag=None, score=0, backbone=No, flagged=true, predates=true, earliest_commit=2017-01-19, event_window=2026-08-01 → 2026-08-05, history_penalty=2, explain_failed=false | PASS |
| E5 | Quick-verify path: colinhacks/zod, event 2026-08-03, penalty 2 | None, 0.0, backbone No | tag=None, score=0, backbone=No, flagged=true, predates=true, earliest_commit=2026-08-29, event_window=2026-08-01 → 2026-08-05, history_penalty=2, explain_failed=false | PASS |
| E6 | Quick-verify path: Mr-Shockwave/Trailbridge, event 2026-08-03, penalty 2 | FAILED, score "-", backbone "-", never a scored tag | FAILED, score "-", backbone "-", status=unverifiable reason="GitHub returned HTTP 404" | PASS |
| E7 | Batch path named QA-eval-r1-sheet, event 2026-08-03, penalty 2, preset, eval-sheet.csv | 5 / 5 verified; toolbar Significant: 1, None: 3, FAILED: 1; hopper dossier agrees | 5 / 5 verified; Significant: 1, None: 3, FAILED: 1; hopper tag=Significant, score=4.5, backbone=Yes, flagged=false, predates=false, earliest_commit=2026-08-03, event_window=2026-08-01 → 2026-08-05, history_penalty=2, explain_failed=false | PASS |
| E12 | Compare hopper score from E1 and from E7 | Identical (4.5 both) | E1 score=4.5 tag=Significant; E7 hopper score=4.5 tag=Significant | PASS |
| E13 | Batch path named QA-eval-r1-headers, eval-sheet-headers.csv (Project Name / GitHub URL) | Same 5 repos and URLs; counts match E7 | mapped=true urls=https://github.com/vraj00222/hopper https://github.com/octocat/Hello-World https://github.com/sindresorhus/p-map https://github.com/colinhacks/zod https://github.com/Mr-Shockwave/Trailbridge; 5 / 5 verified; Significant: 1, None: 3, FAILED: 1 | PASS |
| E9 | Prefill path: github.com/topoteretes/cognee + docs.cognee.ai, in-session as Eval-R1-Cognee (not persisted) | Name Cognee not TIER 1; invocation tokens; consumer env keys; cognee-cli; architecture SDK / library | status=complete name="Cognee Documentation" arch=Data / gateway platform invocation="import cognee / cognee.remember / cognee.recall / cognee.add / cognee.cognify / cognee.search / cognee.forget" hosted="COGNEE_API_KEY, COGNEE_BACKEND_URL, COGNEE_CLOUD_API_URL, COGNEE_CLOUD_AUTH_TOKEN" cli="cognee-cli demo, cognee-cli -ui, cognee-cli cognify, cognee-cli delete --all" warnings=["Competitors cannot be derived from the vendor repo (its integrations are not rivals) - add them manually.","LLM synthesis unavailable; prefill is deterministic-only."] docs_warning=false | FAIL |
| E8 | Quick-verify path: vraj00222/hopper against Eval-R1-Cognee, event 2026-08-03, penalty 2 | None. hopper does not use Cognee | tag=None, score=0, backbone=No, flagged=false, predates=false, earliest_commit=2026-08-03, event_window=2026-08-01 → 2026-08-05, history_penalty=2, explain_failed=false | PASS |
| E10 (advisory) | Read hopper prose from E7 | Paragraphs never state or imply a different tag, score, or backbone; no invented file names | explain_failed=false invented_files=[] description="Hopper is a security vulnerability assessment tool that traces transitive dependencies up to five hops deep and determines whether a vulnerability affects a customer, along with contractual notification deadlines based on per-customer SLAs." usage="The project uses RocketRide with a 5-node pipeline named ' ' that is actively called in the code at packages/orchestrate/src/rocketride/client.ts:181, with 12 total SDK call-sites distributed across 2 files." | PASS |
| E11 (advisory) | Read zod prose from E7 | A None repo must not claim RocketRide usage | tag=None explain_failed=false usage="The code shows no real RocketRide usage. No pipelines are defined or called in the project." | PASS |

Totals: 12 PASS, 1 FAIL, 0 UNCLEAR (13 cases).

## Defects

#### E9: Name Cognee not TIER 1; invocation tokens; consumer env keys; cognee-cli; architecture SDK / library
Severity: medium
Address: staging.rocketride.ai / hackjudge.judge-hack (live pipe path, not a browser bar)
Saw: "status=complete name='Cognee Documentation' arch=Data / gateway platform invocation='import cognee | cognee.remember | cognee.recall | cognee.add | cognee.cognify | cognee.search | cognee.forget' hosted='COGNEE_API_KEY, COGNEE_BACKEND_URL, COGNEE_CLOUD_API_URL, COGNEE_CLOUD_AUTH_TOKEN' cli='cognee-cli demo, cognee-cli -ui, cognee-cli cognify, cognee-cli delete --all' warnings=['Competitors cannot be derived from the vendor repo (its integrations are not rivals) - add them manually.','LLM synthesis unavailable; prefill is deterministic-only.'] docs_warning=false"
Expected: "Name Cognee not TIER 1; invocation tokens; consumer env keys; cognee-cli; architecture SDK / library"
Steps: Prefill path: github.com/topoteretes/cognee + docs.cognee.ai, in-session as Eval-R1-Cognee (not persisted)
Screenshot: (none; this round was not a browser screenshot pass)

