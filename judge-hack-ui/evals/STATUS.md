# Judge Hack evals status

These evals test the decision-making, LLM, and agent-adjacent surfaces of Judge Hack against a fixed public-repo answer key: the deterministic engine (tag / score / backbone / pre-event flag), advisory explain prose, Targets Prefill, and sheet column mapping. The dummy pipe agent must never produce a verdict. Round 1 is the seed; later rounds add Shashi's cases on top and re-check open defects.

## Round 1 (2026-10-14, staging @me)

| Passed | Failed | Unclear |
|---:|---:|---:|
| 11 | 2 | 0 |

### Defects open

- E9: status=complete name="Build AI Memory with Cognee" arch=Data / gateway platform invocation="import cognee | cognee.remember | cognee.recall | cognee.add | cognee.cognify | cognee.memify | cognee.search | cognee.forget" hosted="COGNEE_API_KEY, COGNEE_BACKEND_URL, COGNEE_CLOUD_API_URL, COGNEE_CLOUD_AUTH_TOKEN" cli="cognee-cli demo, cognee-cli -ui, cognee-cli cognify, cognee-cli delete --all" warnings=["Competitors cannot be derived from the vendor repo (its integrations are not rivals) - add them manually.","LLM synthesis unavailable; prefill is deterministic-only."] docs_warning=false
- E11: tag=None explain_failed=false usage="The code shows no real RocketRide usage. No pipelines are defined or called in the project."

Fixes that come out of this round must cite `evals/EVALS-ROUND-1.md`. Round 2 re-checks every open defect before new cases are added.
