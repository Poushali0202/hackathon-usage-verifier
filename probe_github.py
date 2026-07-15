"""
Test the FULLY-ON-CLOUD pipeline (verify_github.pipe) on one repo.

This pipeline does everything on RocketRide: the agent uses the tool_github node to
inspect the repo (code search + file reads) and the LLM classifies. No Python fetching.

Use it to check, on known repos, whether tool_github avoids the truncation the generic
HTTP tool had, and whether it's fast enough for the SLA.

Usage:
    python probe_github.py                       # Sage (expect Significant/Yes)
    python probe_github.py <github_url>
"""

import asyncio
import json
import re
import sys
import time

from rocketride import RocketRideClient
from rocketride.schema import Question

PIPE = "verify_github.pipe"


def extract_json(text: str) -> dict:
    if not text:
        return {}
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    m = re.search(r"\{.*\}", fence.group(1) if fence else text, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


async def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "https://github.com/saadh/sage-tutor"
    client = RocketRideClient()
    await client.connect()
    token = None
    try:
        token = (await client.use(filepath=PIPE, use_existing=True))["token"]
        print(f"Pipeline live on Cloud (token: {token})")
        print(f"Verifying (fully on RocketRide): {url}\n")
        t0 = time.perf_counter()
        q = Question()
        q.addQuestion(f"Verify RocketRide usage for this hackathon submission repo: {url}")
        resp = await client.chat(token=token, question=q)
        secs = time.perf_counter() - t0
        raw = (resp.get("answers") or [""])[0]
        print(f"=== Raw agent answer ({secs:.0f}s) ===")
        print(raw)
        parsed = extract_json(raw)
        if parsed:
            print("\n=== Parsed ===")
            print(json.dumps(parsed, indent=2))
        else:
            print("\n(no clean JSON — inspect the raw answer above)")
    finally:
        if token:
            try:
                await client.terminate(token)
            except Exception:
                pass
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
