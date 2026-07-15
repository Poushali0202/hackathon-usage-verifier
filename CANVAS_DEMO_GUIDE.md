# Investor-Pitch Demo — Run Pipeline B on the RocketRide Cloud Canvas

Goal: no code on screen. Investors watch the **Pipeline Builder canvas** on `api.rocketride.ai`
execute Pipeline B — paste Pipeline A's evidence into the input node, hit Run, and watch
`chat → prompt → Claude → response` light up and produce the verdict.

Reference pipeline: `verify_usage_canvas.pipe` (rubric already inside the `prompt` node).
The cloud builder has no `.pipe` JSON import, so rebuild these 4 nodes once on the canvas.

## Build it once on the canvas (Pipeline Builder app)
| # | Node | Provider | Key settings |
|---|------|----------|--------------|
| 1 | **Input** | `chat` | Source mode; **turn the input form ON** (`hideForm = false`) so there's a visible paste box |
| 2 | **Rubric** | `prompt` | Paste the rubric text into its **instructions** (copy from the `prompt_1` node in `verify_usage_canvas.pipe`) |
| 3 | **Classifier** | `llm_anthropic` | profile `claude-sonnet-4-6`; API key `${ROCKETRIDE_ANTHROPIC_KEY}` |
| 4 | **Result** | `response_answers` | default |

**Wire:** `chat →(questions)→ prompt →(questions)→ llm_anthropic →(answers)→ response_answers`

Save it as its own project (e.g. **"Hackathon Usage Verifier — Live"**) so it's ready to open on demo day.

## The input you paste (Pipeline A's output)
Into the chat box, paste one repo's evidence in this shape — the rubric node supplies everything else:

```
PROJECT: <team / project name>
REPO: <github url>
TEAM FEEDBACK: (none provided)
CODE EVIDENCE (gathered from GitHub):
{
  "accessible": true,
  "file_count": 42,
  "pipe_files": ["pipeline/pr_analyzer.pipe"],
  "rocketride_dependencies": ["backend/requirements.txt: rocketride==1.0.4"],
  "source_signals": ["backend/app/api/analyze.py: import rocketride"],
  "other_platforms": []
}
```

Get this block from Pipeline A: run the repo in the app's **Live** tab (or `run_batch.py`) — the
evidence digest shown/handed off is exactly what goes here. (I can add a **"Copy for Cloud canvas"**
button to the app so this is one click on camera.)

## Demo run flow (on screen)
1. Open the **canvas** on `api.rocketride.ai` → your "Hackathon Usage Verifier — Live" project.
2. Paste the evidence block into the **chat** input node.
3. Click **Run** → watch `chat → prompt → Claude → response` execute in sequence.
4. The **response** node shows the verdict JSON — `tag`, `backbone`, `justification`, `evidence`.
5. (Optional contrast) paste a second repo with no RocketRide signals → it returns `None / No`,
   proving it's reasoning live, not replaying.

## Two polish options
- **Cleanest handoff:** add the app's "Copy for Cloud canvas" button (fetch here → copy → paste there).
- **Fully seamless (experiment first):** the app's SDK call and the canvas both target the same cloud
  pipeline, so an SDK-triggered run *may* animate the open canvas live (via the Server Monitor / live
  run view). Test before relying on it for a recording — the manual paste above is the safe default.

## Simplest possible fallback (no prompt node)
Just set `hideForm = false` on the existing `verify_usage.pipe` (3 nodes) and paste the **full**
prompt (rubric + evidence) into the chat box. Works, but the pasted blob is large on camera — the
`prompt`-node version above keeps the visible input small and clean.
