#!/usr/bin/env python3
"""Daytona driver: load the uploaded evaluator and emit one JSON verdict on stdout."""
import json
import os
import sys
import time
import traceback
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__)) or os.getcwd()
if HERE not in sys.path:
    sys.path.insert(0, HERE)
os.environ.setdefault("HJ_UA", "hackjudge-daytona-v1")


def emit(payload):
    print(json.dumps(payload, separators=(",", ":")))


def load_job():
    for path in (os.path.join(HERE, "job.json"), os.path.join(os.getcwd(), "job.json"), "hj/job.json"):
        if os.path.isfile(path):
            with open(path, encoding="utf-8-sig") as fh:
                return json.load(fh)
    raise FileNotFoundError("job.json not found next to the evaluator")


try:
    from sandbox_github import TOKEN, _clone, ensure_clone, get, git_c
    import engine as engine_mod
    from target import Target
    from run_batch import parse_repo

    job = load_job()
    REPO = str(job.get("repo") or "")
    EVENT_DATE = str(job.get("eventDate") or "")
    HISTORY_PENALTY = job.get("historyPenalty")
    CUSTOM_TARGET = job.get("customTarget")

    pr = parse_repo(REPO)
    if not pr:
        emit({"schema": "hackjudge.daytona.v1", "status": "unverifiable", "repo_url": REPO, "reason": "URL not parseable"})
        raise SystemExit
    owner, repo = pr
    cloned = ensure_clone(owner, repo)
    status, body = get("https://api.github.com/repos/%s/%s" % (owner, repo))
    if status == 403:
        reason = "GitHub API rate limited or forbidden from the Daytona sandbox"
        if not cloned:
            reason += "; git clone also failed"
            if _clone.get("err"):
                reason += ": " + _clone["err"]
        emit({"schema": "hackjudge.daytona.v1", "status": "fetch_incomplete", "repo_url": REPO, "http_status": 403, "reason": reason, "github_token_present": bool(TOKEN)})
        raise SystemExit
    if status != 200:
        emit({"schema": "hackjudge.daytona.v1", "status": "unverifiable", "repo_url": REPO, "http_status": status, "reason": "GitHub returned HTTP %s" % status, "clone_ok": cloned})
        raise SystemExit
    meta = json.loads(body)
    branch = meta.get("default_branch", "main")
    tree_status, tree_body = get("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1" % (owner, repo, quote(branch)))
    if tree_status != 200:
        emit({"schema": "hackjudge.daytona.v1", "status": "fetch_incomplete", "repo_url": REPO, "branch": branch, "http_status": tree_status, "reason": "Git tree fetch failed (HTTP %s)" % tree_status})
        raise SystemExit
    tree = json.loads(tree_body)
    if tree.get("truncated") is True:
        emit({"schema": "hackjudge.daytona.v1", "status": "fetch_incomplete", "repo_url": REPO, "branch": branch, "reason": "GitHub recursive tree was truncated — no verdict on partial retrieval"})
        raise SystemExit

    tgt = None
    tname = "RocketRide"
    if CUSTOM_TARGET:
        tname = CUSTOM_TARGET.get("name") or "Target"
        tgt = Target.from_ui_config(tname, CUSTOM_TARGET)
    penalty = None if HISTORY_PENALTY is None else HISTORY_PENALTY
    ev = engine_mod.gather(REPO, get, EVENT_DATE or None, penalty, tgt)
    if ev.get("fetch_incomplete"):
        emit({"schema": "hackjudge.daytona.v1", "status": "fetch_incomplete", "repo_url": REPO, "branch": branch, "reason": ev.get("note", "Evidence fetch was incomplete — no verdict on partial retrieval")})
        raise SystemExit
    result = engine_mod.evaluate(ev, tgt)
    result["target_name"] = tname
    result["notes"] = engine_mod.det_note(result)
    result["justification"] = result["notes"]
    result["evidence"] = engine_mod.evidence_lines(result)
    result["readme_head"] = ev.get("readme_head") or ""
    result["readme_title"] = ev.get("readme_title") or ""
    head_status, head_body = get("https://api.github.com/repos/%s/%s/commits/%s" % (owner, repo, quote(branch)))
    head_sha = json.loads(head_body).get("sha", "") if head_status == 200 else ""
    if not head_sha and cloned:
        _c, sha_out, _e = git_c("rev-parse", "HEAD")
        head_sha = (sha_out or "").strip()
    result["schema"] = "hackjudge.daytona.v1"
    result["status"] = "complete"
    result["repo_url"] = REPO
    result["branch"] = branch
    result["head_sha"] = head_sha
    result["observed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    emit(result)
except SystemExit:
    pass
except Exception as e:
    emit({"schema": "hackjudge.daytona.v1", "status": "unverifiable", "reason": type(e).__name__ + ": " + str(e), "trace": traceback.format_exc()[-2000:]})
