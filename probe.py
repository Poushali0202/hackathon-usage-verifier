"""
Single-repo probe for the hybrid verifier.

Python gathers the GitHub evidence, prints it, then sends it to the RocketRide
classifier pipeline and prints the verdict. Use it to sanity-check one repo and
to measure per-repo time on a fresh pipeline.

Usage:
    python probe.py                       # defaults to Chai
    python probe.py <github_url>
"""

import asyncio
import json
import sys

from rocketride import RocketRideClient
from rocketride.schema import Question

import run_batch as rb


async def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://github.com/Jiyungi/Chai"
    rb.GH_TOKEN = rb.github_token()

    print(f"Gathering GitHub evidence for {url} ...\n")
    sig = await asyncio.to_thread(rb.fetch_signals, url)
    print("=== Evidence (Python-gathered) ===")
    print(json.dumps(sig, indent=2))

    if not sig.get("accessible"):
        print("\nRepo inaccessible -> None / ZERO (no classifier call needed).")
        return

    prompt = (
        rb.RUBRIC
        + f"\n\nPROJECT: probe\nREPO: {url}\nTEAM FEEDBACK: (none)\n\n"
        + "CODE EVIDENCE (gathered from GitHub):\n"
        + json.dumps(sig, indent=2)
    )

    client = RocketRideClient()
    await client.connect()
    token = None
    try:
        result = await client.use(filepath="verify_usage.pipe", use_existing=True)
        token = result["token"]
        print(f"\nClassifier live (token: {token}); classifying ...")
        q = Question()
        q.addQuestion(prompt)
        resp = await client.chat(token=token, question=q)
        raw = (resp.get("answers") or [""])[0]
        parsed = rb.extract_json(raw)
        print("\n=== Verdict ===")
        print(json.dumps(parsed, indent=2) if parsed else raw)
    finally:
        if token:
            try:
                await client.terminate(token)
            except Exception:
                pass
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
