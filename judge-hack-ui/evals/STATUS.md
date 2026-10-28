# Judge Hack evals status

These evals test the decision-making, LLM, and agent-adjacent surfaces of Judge Hack against a fixed public-repo answer key: the deterministic engine (tag / score / backbone / pre-event flag), advisory explain prose, Targets Prefill, and sheet column mapping. The dummy pipe agent must never produce a verdict. Round 1 is the seed; later rounds add Shashi's cases on top and re-check open defects.

## Round 1 (2026-10-28, staging @me)

| Passed | Failed | Unclear |
|---:|---:|---:|
| 13 | 0 | 0 |

### Defects open

- None.

Fixes that come out of this round must cite `evals/EVALS-ROUND-1.md`. Round 2 re-checks every open defect before new cases are added.
