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
        # a fixture may carry a user-defined target (Targets-editor config shape) — it then runs
        # through the target-agnostic generic path instead of the RocketRide preset path
        tgt = None
        if spec.get("target_ui_config"):
            from target import Target
            tc = spec["target_ui_config"]
            tgt = Target.from_ui_config(tc.get("name", "TestTarget"), tc)
        got = engine.evaluate(spec["evidence"], tgt)
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


def run_detectors() -> int:
    """Unit checks for the low-level detectors — regressions from the manual audit (2026-08)."""
    import json as _json
    print("\nDetector unit checks\n" + "-" * 68)
    bad = 0

    def ck(name, cond):
        nonlocal bad
        bad += not cond
        print(f"[{'PASS' if cond else 'FAIL'}] {name}")

    # persona: a hand-written pipe using "nodes" (not "components") must not read as 0 nodes
    m = engine.parse_pipe(_json.dumps({"nodes": [{"type": "webhook"}, {"type": "prompt"},
                                                 {"type": "llm_openai"}, {"type": "response"}]}))
    ck("parse_pipe reads 'nodes' key -> 4 nodes, has_llm", bool(m) and m["nodes"] == 4 and m["has_llm"])
    ck("parse_pipe still reads 'components'",
       engine.parse_pipe(_json.dumps({"components": [{"provider": "agent_x"}]}))["has_agent"])
    ck("parse_pipe unwraps a { pipeline: {…} } envelope (matches the SDK)",
       engine.parse_pipe(_json.dumps({"pipeline": {"components": [{"provider": "webhook"}, {"provider": "llm_x"}]}}))["nodes"] == 2)

    # DriftLens: path defined in one file, client.use in another -> still 'called'
    cross = [{"path": "config.ts", "text": "export const P = resolve(HERE, 'drift.pipe')"},
             {"path": "run.ts", "text": "client.use({ filepath: P })"}]
    ck("pipe_called handles cross-file / dynamic path", engine.pipe_called("x/drift.pipe", cross)[0])
    # a pipe present but never invoked anywhere is still NOT called
    ck("pipe_called: for-show pipe -> not called",
       not engine.pipe_called("demo.pipe", [{"path": "a.ts", "text": "// demo.pipe sits here"}])[0])

    # VibePairing: a committed pipeline .json is recognized, a package.json is not
    ck("_looks_like_pipeline accepts a real pipeline json", engine._looks_like_pipeline(engine.parse_pipe(
        _json.dumps({"components": [{"provider": "webhook"}, {"provider": "llm_openai_api"},
                                    {"provider": "response"}]}))))
    ck("_looks_like_pipeline rejects package.json", not engine._looks_like_pipeline(engine.parse_pipe(
        _json.dumps({"name": "x", "version": "1.0.0", "dependencies": {"rocketride": "^1.3.0"}}))))

    # NOUS class: a generic runner (client.use(filepath=<var>)) is detected; a literal path is not
    ck("_RUNNER matches client.use(filepath=<variable>)",
       bool(engine._RUNNER.search("used = await client.use(filepath=str(Path(pipe_path).resolve()))")))
    ck("_RUNNER matches client.use({ filepath: VAR })",
       bool(engine._RUNNER.search("const r = await client.use({ filepath: PIPELINE })")))
    ck("_RUNNER ignores a literal path (not a runner)",
       not engine._RUNNER.search('client.use(filepath="constructor-pipeline.pipe")'))

    # persona class: cross-language + SDK-less webhook count as real invocation
    ck("_SRC_EXT scans other languages (.rs/.go)",
       bool(engine._SRC_EXT.search("crates/x.rs")) and bool(engine._SRC_EXT.search("main.go")))
    ck("_RR_HTTP matches the hosted API / webhook URL",
       bool(engine._RR_HTTP.search("POST https://api.rocketride.ai/v1/run")))
    ck("_HOSTED_ENV matches a webhook-URL env, not a bare API key",
       bool(engine._HOSTED_ENV.search("ROCKETRIDE_WEBHOOK_URL")) and not engine._HOSTED_ENV.search("ROCKETRIDE_API_KEY"))

    # commit-freshness: the ±grace-day window, and in-window commits are NOT penalised
    w = engine.event_window("2026-08-04")
    ck("event_window = event ±2 days", w and w["start"] == "2026-08-02" and w["end"] == "2026-08-06")
    ck("event_window tolerates a bad date", engine.event_window("not-a-date") is None)
    ev_ok = {"accessible": True, "dependency": True, "other_platforms": [],
             "event_window": w, "sdk": {"callsites": 2, "file_spread": 1, "hosted": False, "engine": False},
             "pipes": [{"path": "f.pipe", "called": True, "first_commit": "2026-08-03T09:00:00Z",
                        "call_sites": [],
                        "metrics": {"nodes": 6, "providers": ["chat", "llm_x"], "has_agent": False,
                                    "has_llm": True, "tool_count": 0, "project_id": ""}}]}
    r_ok = engine.evaluate(ev_ok)
    ck("in-window first commit -> no reuse penalty", not r_ok["reused_pipelines"] and r_ok["score"] == 4.0)

    # judge-set history penalty: default deduction applies when no value given; 0 = flag only
    ev_pp = dict(ev_ok, project_predates={"date": "2026-07-01T00:00:00Z", "sha": "old0001"})
    r_pp = engine.evaluate(ev_pp)
    ck("predates flag deducts the DEFAULT penalty (4.0 -> 2.0), tag survives",
       r_pp["score"] == 2.0 and r_pp["tag"] == "Moderate" and r_pp["history_penalty"] == 2.0)
    r_p0 = engine.evaluate(dict(ev_pp, history_penalty=0))
    ck("penalty 0 = flag only (score unchanged, flag still present)",
       r_p0["score"] == 4.0 and r_p0["project_predates"] and r_p0["history_penalty"] == 0.0)

    # LLM sheet-brain: mapping is verified deterministically (trust-but-verify)
    sys.path.insert(0, str(HERE.parent))
    import run_batch as rb
    raw = [["Some Col", "Links", "Score"],
           ["alpha", "https://github.com/a/x", "10"],
           ["beta", "https://github.com/b/y", "20"]]
    good = rb.apply_llm_mapping(raw, '{"header_row": 0, "github": 1, "project": 0}')
    ck("apply_llm_mapping accepts a verified mapping", bool(good) and good[0]["github"].endswith("a/x")
       and good[0]["project"] == "alpha")
    ck("apply_llm_mapping rejects a lying mapping (claimed github col has no URLs)",
       rb.apply_llm_mapping(raw, '{"header_row": 0, "github": 2}') is None)

    # README-title upgrade guard: a real name upgrades; the slug re-spelled does NOT (would
    # drop the owner suffix and re-collide duplicate repo names — the memory-meets-motion case)
    ck("title_upgrades: real README name upgrades the slug",
       rb.title_upgrades("memory-meets-motion", "DealBench"))
    ck("title_upgrades: slug re-spelled does NOT upgrade",
       not rb.title_upgrades("memory-meets-motion", "Memory Meets Motion")
       and not rb.title_upgrades("Memory_Meets_Motion", "memory meets motion")
       and not rb.title_upgrades("x", ""))

    # history tamper scan: author-vs-committer evidence of a rewrite into the window
    win2 = engine.event_window("2026-08-04")
    commits = [
        {"sha": "dead007beef", "commit": {"author": {"date": "2026-07-15T12:00:00Z"},
                                          "committer": {"date": "2026-08-04T08:00:00Z"}}},
        {"sha": "c1eancafe00", "commit": {"author": {"date": "2026-08-03T09:00:00Z"},
                                          "committer": {"date": "2026-08-03T09:05:00Z"}}},
    ]
    t, earliest = engine.history_tamper_scan(commits, win2)
    ck("tamper scan flags pre-window author re-stamped into the window",
       len(t) == 1 and t[0]["sha"] == "dead007")
    ck("tamper scan: in-window rebase of in-window work is NOT flagged",
       all(x["sha"] != "c1eanca" for x in t))
    ck("tamper scan reports the earliest date seen", earliest == "2026-07-15T12:00:00Z")
    print("-" * 68)
    return bad


if __name__ == "__main__":
    failed = run_fixtures()
    failed += run_detectors()
    if "--live" in sys.argv:
        failed += run_live()
    sys.exit(1 if failed else 0)
