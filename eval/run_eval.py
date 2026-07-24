"""Regression harness for the deterministic evaluator (eval/engine.py).

Each file in eval/fixtures/*.json is {name, evidence, expect}. This runs engine.evaluate(evidence)
and asserts the tag / backbone / score match `expect`. Because the evidence is CAPTURED (not
re-fetched), the scoring logic is tested deterministically, offline, and can't silently drift when
GitHub or a repo changes.

    python eval/run_eval.py           # fixture regression (exit 0 = all pass)
    python eval/run_eval.py --live    # also re-gather a couple of real public repos to catch drift
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))              # engine.py
sys.path.insert(0, str(HERE.parent))       # run_batch.py (only needed for --live)
import engine  # noqa: E402


def run_fixtures() -> int:
    fixtures = sorted((HERE / "fixtures").glob("*.json"))
    passed = failed = 0
    print(f"Deterministic evaluator — {len(fixtures)} fixture(s)\n" + "-" * 68)
    for fp in fixtures:
        spec = json.loads(fp.read_text(encoding="utf-8"))
        got = engine.evaluate(spec["evidence"])
        exp = spec["expect"]
        diffs = {k: (v, got.get(k)) for k, v in exp.items() if got.get(k) != v}
        ok = not diffs
        passed += ok
        failed += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {spec['name']}")
        print(f"       got: tag={got['tag']} backbone={got['backbone']} score={got['score']} "
              f"called={got['pipelines_called']}/{got['pipelines_total']}")
        for k, (want, have) in diffs.items():
            print(f"       DIFF {k}: expected {want!r}, got {have!r}")
    print("-" * 68 + f"\n{passed} passed, {failed} failed")
    return failed


def run_live() -> int:
    """Optional drift check — re-gather known public repos and compare the resulting tag."""
    import run_batch as rb
    from dotenv import load_dotenv
    load_dotenv(HERE.parent / ".env")
    rb.GH_TOKEN = rb.github_token()
    checks = [("https://github.com/ramizik/constructor", "Significant")]
    print("\nLIVE drift check\n" + "-" * 68)
    bad = 0
    for url, exp_tag in checks:
        ev = engine.evaluate(engine.gather(url, rb._gh))
        ok = ev["tag"] == exp_tag
        bad += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {url}\n       -> {ev['tag']} (score {ev['score']}), "
              f"expected {exp_tag}")
    return bad


if __name__ == "__main__":
    failed = run_fixtures()
    if "--live" in sys.argv:
        failed += run_live()
    sys.exit(1 if failed else 0)
