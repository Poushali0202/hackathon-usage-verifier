#!/usr/bin/env python3
"""Daytona driver: extract a Target draft from vendor sources. Emits JSON on stdout."""
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__)) or os.getcwd()
if HERE not in sys.path:
    sys.path.insert(0, HERE)
os.environ.setdefault("HJ_UA", "hackjudge-extract-v1")


def emit(payload):
    print(json.dumps(payload, separators=(",", ":")))


def load_job():
    for path in (os.path.join(HERE, "job.json"), os.path.join(os.getcwd(), "job.json"), "hj/job.json"):
        if os.path.isfile(path):
            with open(path, encoding="utf-8-sig") as fh:
                return json.load(fh)
    raise FileNotFoundError("job.json not found next to the extractor")


try:
    from sandbox_github import ensure_clone, get
    from run_batch import parse_repo
    import extract as extract_mod

    job = load_job()
    repo_url = str(job.get("repoUrl") or "").strip()
    docs_url = str(job.get("docsUrl") or "").strip()
    package = str(job.get("pkg") or "").strip()
    uploads = job.get("uploads") or {}
    pr = parse_repo(repo_url) if repo_url else None
    if pr:
        ensure_clone(pr[0], pr[1])
    ctx = extract_mod.prepare_sources(
        get,
        repo_url or None,
        None,
        docs_url or None,
        package or None,
        uploads or None,
    )
    if not ctx:
        emit({"schema": "hackjudge.extract.v1", "status": "empty",
              "reason": "No source yielded readable content. Check the repo URL, docs URL, package name, or attached files."})
        raise SystemExit
    out = extract_mod.finalize(ctx, "")
    out["schema"] = "hackjudge.extract.v1"
    out["status"] = "complete"
    # Cap so Daytona stdout is not truncated; verification is fail-closed on this slice.
    out["prompt"] = extract_mod.build_prompt(ctx)
    out["corpus_lower"] = str(ctx.get("corpus_lower") or "")[:40000]
    emit(out)
except SystemExit:
    pass
except Exception as e:
    emit({"schema": "hackjudge.extract.v1", "status": "failed",
          "reason": type(e).__name__ + ": " + str(e), "trace": traceback.format_exc()[-2000:]})
