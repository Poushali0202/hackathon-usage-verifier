"""
Live monitor probe — run this, THEN click Run on the canvas.

It subscribes (as an independent client, exactly like the web app would) to ALL your
runs and prints every event a REAL canvas run emits — and flags any event that carries
the actual verdict text. This tells us whether "canvas triggers -> webpage shows results"
is possible via events, or whether we pivot to webpage-triggers.

    python live_monitor.py            # listens ~150s, then summarizes

While it says LISTENING, go to the canvas (hackathon_judge_aid_workflow), paste the
sample PR Analyzer evidence into the Chat box, and click Run. Watch this terminal.
"""
import asyncio, json, os, sys, time
from collections import Counter
from dotenv import load_dotenv

PROJ = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(PROJ, ".env"))
from rocketride import RocketRideClient

LISTEN_SECONDS = 150
PROJECT_ID = "ed3e34eb-3846-47ee-861b-22783a29dd62"
t0 = time.time()
events = []

def _has_verdict(body) -> bool:
    blob = json.dumps(body, default=str)
    return any(k in blob for k in ('"tag"', "Significant", "Moderate", '"backbone"', '"repo_accessible"'))

async def collector(msg):
    events.append(msg)
    et = msg.get("event", "?")
    body = msg.get("body", {})
    dt = time.time() - t0
    mark = "  ★ CARRIES VERDICT" if _has_verdict(body) else ""
    print(f"[{dt:6.1f}s] {et:24} keys={list(body.keys())[:8]}{mark}")
    if mark:
        # dump the part that holds the verdict so we can see the shape
        print("        body =", json.dumps(body, default=str)[:600])

async def main():
    mon = RocketRideClient(on_event=collector)
    await mon.connect()
    await mon.add_monitor({"token": "*"}, ["task", "summary", "flow", "output", "sse"])
    print("=" * 70)
    print("LISTENING (token='*') — now go click RUN on the canvas.")
    print(f"Watching for ~{LISTEN_SECONDS}s. Project of interest: {PROJECT_ID}")
    print("=" * 70)
    try:
        await asyncio.sleep(LISTEN_SECONDS)
    finally:
        print("\n" + "=" * 70)
        print(f"SUMMARY — {len(events)} events")
        print("types:", dict(Counter(e.get("event") for e in events)))
        verdict_events = [e for e in events if _has_verdict(e.get("body", {}))]
        print(f"events carrying the verdict: {len(verdict_events)}")
        if verdict_events:
            print(">>> GOOD: a canvas run DOES deliver the verdict to a monitor via:",
                  Counter(e.get("event") for e in verdict_events))
        else:
            print(">>> The verdict did NOT arrive via events — we pivot to webpage-triggers.")
        await mon.disconnect()

asyncio.run(main())
