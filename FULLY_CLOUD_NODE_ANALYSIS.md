# Fully-Cloud Verification — Existing Nodes vs Custom Node

**Question:** Can the fully-on-RocketRide, SLA-fast GitHub usage-verification target be met with
existing nodes (`rocketride-saas` / `rocketride-server`), or is a custom node still needed?

**Target:** per event — fetch each repo's code → verify RocketRide usage → classify — **100% on
RocketRide Cloud** (no laptop) **and** within the ~15-min live-judging window (~43+ repos).

---

## What I checked
- **`rocketride-saas`** is the infra/platform monorepo: load balancer, model server, k8s, frontend
  UIs (`apps/`), and `lambda/` = **OAuth only**. The actual nodes live in the nested
  `rocketride-server`. → the SaaS layer adds **no new data-fetch mechanism** (no general
  serverless-job runner exposed as a node; `apps/` are UIs).
- **Node inventory (95 schemas) by `classType`:** tool 19 · llm 12 · infrastructure 9 · source 5 ·
  agent 5 · embedding 4 · database 3 · memory 2 (+ data-lane processors: parse, ocr, summarization…).
- **Data enters a pipeline only two ways:**
  - **`source`** nodes (chat, webhook, dropper, telegram) — they **receive pushed** data; none
    *fetch* a remote repo.
  - **`tool`** nodes — **agent-invoked** (run inside the agent's multi-wave loop).
- **Every network/repo-capable node is `classType: "tool"`** (agent-invoked): `tool_github`,
  `tool_git`, `tool_http_request`, `tool_firecrawl`, `tool_apify`, `tool_daytona`. The only node
  that mentions a git repo is `tool_git` — also a tool.

## Verdict: a custom node IS still needed (for fast + fully-native)
Existing nodes **can** reach GitHub accurately — but only through **agent tools**, which run in the
agent's think→act→think loop (one LLM round-trip per step). Measured earlier: **~400 s/repo →
~1 hr/event → ~4× over the 15-min SLA.** There is **no `source`/`processor` (data-lane) node that
fetches a remote repo server-side.** So:
- **Fully-native AND fast is NOT achievable with existing nodes.**
- The clean fix is a **custom data-lane node** — a **"GitHub Evidence"** source/processor that runs
  the fetch+digest **server-side, outside the agent loop** (~seconds/repo). It is largely a **port of
  the already-proven Python `fetch_signals` logic**, and doubles as a reusable platform capability.

## One existing-nodes option worth a quick test: `tool_daytona`
New since the first analysis: `tool_daytona` gives an agent a **networked cloud sandbox**
(`run_code` / `run_command`) — unlike `tool_python` (no network). An agent could run the **entire
`fetch_signals` script in ONE daytona call**, then classify — ~2 agent waves instead of ~10. That
could cut ~400 s/repo to **~60–90 s/repo**. Still agent-gated (slower than a custom node, borderline
for the SLA at scale, plus sandbox spin-up), but it's the **closest existing-nodes path** and cheap
to test.

## Recommendation
1. **Now:** ship the **hybrid** (Python fetch + Cloud classify) — meets the SLA today (~5 min/event).
2. **Phase 2 (fully-native):** build the custom **"GitHub Evidence" data-lane node** — the clean,
   SLA-safe answer; reuses the Python logic; reusable for any repo-reading pipeline.
3. **Optional experiment:** test the `tool_daytona` 2-wave flow — if it lands under the SLA it's a
   no-custom-node fallback; if not, it confirms the custom node is warranted.

## Summary
| Path | Fully native? | Fast (≤15 min)? | Verdict |
|---|---|---|---|
| `tool_http_request` (agent) | Yes | No — truncates + slow | ✗ inaccurate + slow |
| `tool_github` file-nav (agent) | Yes | No — ~400 s/repo | ✗ too slow |
| `tool_daytona` (agent runs the fetch script) | Yes | Maybe — ~60–90 s/repo | ~ worth testing |
| `tool_python` | — | — | ✗ no network |
| any `source` / `processor` node | — | — | ✗ none fetch remote repos |
| **Hybrid** (Python fetch + Cloud classify) | Partial (judgment on Cloud) | **Yes (~5 min)** | ✓ **today** |
| **Custom "GitHub Evidence" node** | **Yes** | **Yes (~sec/repo)** | ✓ **phase-2 answer** |
