# Set Up Pipeline B on the RocketRide Cloud Canvas — Step by Step

Goal: build the demo classifier on the cloud Pipeline Builder so you can paste Pipeline A's
evidence in and watch it run. Four nodes:

```
chat (input box)  →  prompt (rubric)  →  llm_anthropic (Claude)  →  response_answers (verdict)
```

This is a **fresh pipeline** — we do NOT touch your existing `verify_usage.pipe` (the app still uses
that one). The cloud builder has no `.pipe` import, so we rebuild the 4 nodes by hand (only 1 more
than last time — the new `prompt` node).

Two files to keep open:
- `rubric_for_prompt_node.txt` — the exact rubric to paste into the prompt node (Stage B).
- `verify_usage_canvas.pipe` — the reference blueprint (node ids + config), if you want to cross-check.

---

## Prerequisites
- Log in to `https://api.rocketride.ai` (or your cloud URL) with the **same account** whose API key is
  in your `.env` (`ROCKETRIDE_APIKEY`). This matters later for the live-webpage step — the demo watches
  runs on your account.
- Have your Anthropic key ready (the funded `ROCKETRIDE_ANTHROPIC_KEY` from `.env`).

---

## STAGE 0 — Open the builder and create the pipeline
1. From the dashboard / App Store, open **Pipeline Builder** (the "Design, run, and deploy AI pipelines
   visually" app).
2. Click **New Pipeline** (or **+ Create**).
3. Name it: **`Hackathon Usage Verifier — Live Demo`**. You now have an empty canvas.

## STAGE A — Input node  (provider: `chat`)  ← the paste box
1. Add a node → **Source** category → **Chat**.
2. Open its config panel and set:
   - **Mode:** `Source`
   - **Show input form / hideForm:** **ON (form visible)** — i.e. `hideForm = false`.
     *(This is the one setting different from `verify_usage.pipe`, where the form was hidden because the
     SDK fed it. Here YOU type into it on the canvas, so the form must show.)*
3. Leave everything else default. This node is where you'll paste Pipeline A's evidence.

## STAGE B — Rubric node  (provider: `prompt`)  ← holds the instructions
1. Add a node → **Prompt** (context/instructions node).
2. Open its config → **Instructions** field.
3. Open `rubric_for_prompt_node.txt`, **select all → copy → paste** the whole thing into Instructions.
   *(This is why the canvas input can stay small: the rubric lives here, not in what you paste.)*
4. **Wire it:** drag from the **Chat** node's output (`questions`) to the **Prompt** node's input.

## STAGE C — Classifier node  (provider: `llm_anthropic`)  ← Claude
1. Add a node → **Models / LLM** → **Anthropic**.
2. Open its config and set:
   - **Model / profile:** `claude-sonnet-4-6`
   - **API key:** paste your Anthropic key (the funded one). *(In the `.pipe` file this shows as
     `${ROCKETRIDE_ANTHROPIC_KEY}`, but in the UI you paste the actual key or pick the saved credential.)*
3. **Wire it:** drag from the **Prompt** node's output (`questions`) to the **Anthropic** node's input.

## STAGE D — Result node  (provider: `response_answers`)  ← the verdict
1. Add a node → **Response** → **Response Answers**.
2. No config needed.
3. **Wire it:** drag from the **Anthropic** node's output (`answers`) to the **Response Answers** input.

## STAGE E — Verify wiring and save
Your canvas should read left-to-right:
```
Chat ──questions──▶ Prompt ──questions──▶ Anthropic ──answers──▶ Response Answers
```
- Confirm all three connections exist (no dangling nodes).
- **Save** the pipeline.

## STAGE F — Test run on the canvas
1. In the **Chat** node's input box, paste this sample (a real RocketRide project):
   ```
   PROJECT: PR Analyzer
   REPO: https://github.com/dsapandora/pr_analyzer
   TEAM FEEDBACK: (none provided)
   CODE EVIDENCE (gathered from GitHub):
   {
     "accessible": true,
     "file_count": 42,
     "pipe_files": ["pipeline/commit_criteria.pipe", "pipeline/pr_analyzer.pipe"],
     "pipelines_folder": true,
     "rocketride_dependencies": ["backend/requirements.txt: rocketride==1.0.4"],
     "source_signals": ["backend/app/api/analyze.py: import rocketride", "backend/app/config.py: ws://localhost:5565"],
     "other_platforms": []
   }
   ```
2. Click **Run** (▶).
3. Watch the nodes execute in order. The **Response Answers** node should show a JSON verdict with
   `tag: "Significant"`, `backbone: "Yes"`, plus `description`, `rocketride_usage`, `justification`,
   `evidence`.
4. (Optional) paste a repo with no RocketRide (e.g. evidence with empty arrays) → it returns
   `tag: "None"`, proving it reasons live.

If Stage F produces a correct verdict, the canvas is ready. ✅

---

## Troubleshooting
- **No input box on the canvas** → the Chat node's form is still hidden; set `hideForm = false` (Stage A.2).
- **Auth / 401 from the model** → the Anthropic key on the node is wrong or unfunded; re-paste the
  funded key.
- **Output isn't valid JSON** → confirm the *entire* rubric pasted into the Prompt node (it ends with
  "…Keep description, rocketride_usage, and justification readable for a non-engineer judge.").
- **Nodes won't connect** → lanes must match: Chat/Prompt output `questions`; Anthropic outputs
  `answers` into Response Answers. Connect output-dot → input-dot.

## After this works — the live webpage (next step)
Once the canvas runs correctly, note its **Project ID** (in the pipeline's settings/URL). We'll point
the app's live monitor (`client.set_events`) at it so that when you Run on the canvas, the deployed
webpage lights up node-by-node and shows the verdict. Send me the Project ID when you have it.
