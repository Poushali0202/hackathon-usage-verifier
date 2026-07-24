# RocketRide Usage Verifier — demo script v2 (~4:05, split-screen)

**Rewritten for Joe's feedback:** split-screen (app + pipeline + observability visible *together*),
no "intern", show how the app grabs the endpoint, lean into the 4-node simplicity, explicit phase-2
line, no zooming, one continuous take.

### Recording setup (do this before you hit record)
- **One sitting, one mic**, same distance/settings the whole way through. Don't re-record parts
  separately — that's what caused the voice shifts (esp. ~4:58).
- **Split screen from ~0:35 onward:** left = the deployed app, right = RocketRide Cloud canvas
  (`hackathon_judge_aid_workflow`) with the Trace/Tokens tabs reachable.
- **No zooming.** Keep the frame static — especially during observability.
- Webcam PiP bottom-right, relaxed. Warm the app ~1 min before (free-tier cold start).
- Have a repo URL + the submissions CSV ready to paste.

---

**[0:00–0:20] Hook** — [SCREEN: app, full width]
VO: "Hey, I'm Poushali — I work on the AI team at RocketRide. So every time we run a hackathon, everyone says they used RocketRide. And you kind of just have to take their word for it, right? Because when you've got 40-plus projects and about 15 minutes before judging starts, actually going through every repo yourself just isn't happening. So I built something to do it for me."

**[0:20–0:35] Promise + roadmap**
VO: "It reads each team's actual GitHub code and tells you how they *really* used RocketRide. It works in two parts — it grabs the evidence from the repo, then hands that to a RocketRide pipeline to make the call. And I'm going to keep both on screen, so you can watch them happen together."

**[0:35–1:15] The pipeline — four nodes do everything** — [SCREEN: split. App left, canvas right. Static, no zoom. Point at each node.]
VO: "So on the left is the app, and on the right is the RocketRide pipeline that actually does the judging. And it's only four nodes — chat takes the evidence in, this prompt node holds the judging rubric, it runs through Claude, and the verdict comes back out. That's it. Those four nodes do everything behind this app — the only thing outside the pipeline is the frontend you're looking at. There's no database, nothing stored; the whole thing is stateless."
[SCREEN: click **Endpoint Info** on the Chat node]
VO: "And this is how the two are connected — the chat node gives me an endpoint, and that's exactly what the app calls whenever it needs a project judged."

**[1:15–2:10] Run one — both sides at once**
[SCREEN: split. Paste repo left → **Run**. *While it's still working*, paste that project's evidence into the canvas Chat on the right → **Run**. Both panes active at once, landing on the same verdict.]
VO: "So let me paste in a repo and hit run — on the left it's pulling the code from GitHub. And while that's going, I'll run the same project straight through the pipeline on the right, so you can actually see the nodes fire. Left side comes back… Significant, RocketRide's the backbone — and the pipeline lands on exactly the same call."
[SCREEN: right pane → Flow / Tokens / Trace; left pane still showing the result. Click into a node in Trace.]
VO: "And because it's a RocketRide pipeline, I can see exactly what happened — the flow through each node, the tokens it used, the full trace. I can click into any step and see what went in and what came back out. Nothing's a black box."

**[2:10–2:40] The read** — [SCREEN: left pane — click the card → detail + backbone tower]
VO: "If I open the project up, I get the reasoning. It breaks it into layers, and the two that matter — the orchestration and the reasoning — go green, because RocketRide is what's running them. Both green means RocketRide's the backbone. Grey would mean it isn't."

**[2:40–3:20] The whole cohort** — [SCREEN: left pane Batch → upload CSV → Run; right pane keeps firing per project. Filter, then a None + a Needs-review card.]
VO: "But judging is the whole cohort. So I drop in the submissions sheet — it figures out the columns on its own — and run the batch. Every project streams in as it's classified, and you can see the pipeline firing for each one on the right. Counts up top, and I can filter to just the ones where RocketRide's the backbone. And it's honest — someone claimed RocketRide but didn't really use it? None. Repo's private or broken? It flags it instead of guessing."

**[3:20–3:40] The payoff** — [SCREEN: Download Excel → open the styled sheet]
VO: "And one click gives me a judge-ready Excel — the tags, the backbone call, the reasoning, links you can click. A solid read on every single project… and I never opened a repo myself."

**[3:40–4:05] Close + phase 2 + CTA** — [SCREEN: back to the app / full grid]
VO: "So that's it — 40-plus repos, checked from the actual code, in minutes, off a four-node pipeline. I built it because we needed it for our own hackathons. Phase 2 will take N products and their judging criteria, and run this same judging across each one, so any sponsor gets the same kind of result for their own tech. And because it all runs on RocketRide Cloud, scaling it is honestly the easy part. If you want to build something like this, go check out RocketRide Cloud."

---

## Where the data is stored (Joe's question)
**Nowhere — the app is stateless.** The uploaded sheet is parsed in memory (temp file, discarded),
results stream to and live in the **browser session**, and the Excel is generated **on demand in
memory** when you hit Download. No database, no disk. Only the API keys persist, as env vars in
Render. This is why the "four nodes do everything behind the app" line is literally true — the only
piece outside the pipeline is the frontend.

## How RocketRide is incorporated (speaker notes)
- The classification — tag, backbone verdict, layer map, justification — runs as a **RocketRide Cloud
  pipeline** (`chat → prompt → Anthropic → response`), reached via the endpoint on the chat node and
  driven through the RocketRide SDK.
- **Dogfooding + observability:** the pipeline judging the hackathon *is* a RocketRide pipeline, and
  its Flow / Tokens / Trace tabs are what you show live on the right-hand pane.
- **Hybrid by design:** local GitHub evidence-gathering → RocketRide-Cloud reasoning.

## Future scope
- **Phase 2:** take N products and their judging criteria, run the same judging across each one for
  comparable results (any sponsor, their own tech).
- Judge-defined metrics in plain language; drop in a rubric or just talk to the agent to set it.
- Customisable Excel/table view — pick and filter the columns you want.
- Self-serve: any team or sponsor runs it for their own events with their own key.
