# Entry points the app appends a call to: `result = run_verify(JOB, TOKEN, CACHE)`.
# Returns dicts (tool_python hands the `result` variable back untruncated). RestrictedPython-safe.
VERIFY_SCHEMA = "hackjudge.python.v1"
EXTRACT_SCHEMA = "hackjudge.extract.v1"

# The active fetcher for this run. extract.py's module-level helpers are rebound below so
# docs/registry reads go through the same fetcher (and the same replay cache) as GitHub.
FETCH = [None]


def error_text(e):
    return repr(e)[:400]


def choose_fetcher(token, cache):
    """Direct urllib when the sandbox allows it, else replay from the app-supplied cache."""
    missing = []
    if HAVE_URLLIB and cache is None:
        return make_gh(token), "direct", missing
    return make_cache_gh(cache if cache is not None else {}, missing), "replay", missing


def need_fetch(schema, missing, extra):
    out = {"schema": schema, "status": "need_fetch", "mode": "replay", "missing": list(missing)}
    out.update(extra)
    return out


def hj_http_get(url, timeout=45):
    """Replaces extract._http_get: plain fetch for docs pages / registries via the run fetcher."""
    return FETCH[0](url)


def hj_html_text(body):
    """Replaces extract._html_text (the html module may be unavailable in the sandbox)."""
    return re.sub(r"[ \t]+", " ", html_unescape(hj_TAG_RX.sub(" ", body)))


def run_verify(job, token, cache=None):
    repo_url = str(job.get("repo") or "")
    event_date = str(job.get("eventDate") or "")
    history_penalty = job.get("historyPenalty")
    custom = job.get("customTarget")
    token_present = bool((token or "").strip())
    get, mode, missing = choose_fetcher(token, cache)
    FETCH[0] = get
    try:
        pr = parse_repo(repo_url)
        if not pr:
            return {"schema": VERIFY_SCHEMA, "status": "unverifiable", "repo_url": repo_url,
                    "reason": "URL not parseable", "mode": mode}
        owner, repo = pr[0], pr[1]
        status, body = get("https://api.github.com/repos/%s/%s" % (owner, repo))
        if missing:
            return need_fetch(VERIFY_SCHEMA, missing, {"repo_url": repo_url})
        if status in (401, 403, 429):
            return {"schema": VERIFY_SCHEMA, "status": "fetch_incomplete", "repo_url": repo_url,
                    "http_status": status, "github_token_present": token_present, "mode": mode,
                    "reason": "GitHub API rate limited or forbidden (HTTP %s)" % status}
        if status != 200:
            return {"schema": VERIFY_SCHEMA, "status": "unverifiable", "repo_url": repo_url,
                    "http_status": status, "reason": "GitHub returned HTTP %s" % status, "mode": mode}
        meta = json.loads(body)
        branch = meta.get("default_branch", "main")
        tree_status, tree_body = get("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1"
                                     % (owner, repo, quote(branch)))
        if missing:
            return need_fetch(VERIFY_SCHEMA, missing, {"repo_url": repo_url, "branch": branch})
        if tree_status != 200:
            return {"schema": VERIFY_SCHEMA, "status": "fetch_incomplete", "repo_url": repo_url,
                    "branch": branch, "http_status": tree_status, "mode": mode,
                    "reason": "Git tree fetch failed (HTTP %s)" % tree_status}
        tree = json.loads(tree_body)
        if tree.get("truncated") is True:
            return {"schema": VERIFY_SCHEMA, "status": "fetch_incomplete", "repo_url": repo_url,
                    "branch": branch, "mode": mode,
                    "reason": "GitHub recursive tree was truncated - no verdict on partial retrieval"}

        tgt = None
        tname = "RocketRide"
        if custom:
            tname = custom.get("name") or "Target"
            tgt = target_from_ui_config(tname, custom)
        ev = gather(repo_url, get, event_date or None, history_penalty, tgt)
        head_status, head_body = get("https://api.github.com/repos/%s/%s/commits/%s"
                                     % (owner, repo, quote(branch)))
        if missing:
            return need_fetch(VERIFY_SCHEMA, missing, {"repo_url": repo_url, "branch": branch})
        if ev.get("fetch_incomplete"):
            return {"schema": VERIFY_SCHEMA, "status": "fetch_incomplete", "repo_url": repo_url,
                    "branch": branch, "mode": mode,
                    "reason": ev.get("note", "Evidence fetch was incomplete - no verdict on partial retrieval")}
        if not ev.get("accessible", True):
            return {"schema": VERIFY_SCHEMA, "status": "unverifiable", "repo_url": repo_url,
                    "http_status": ev.get("status"), "mode": mode,
                    "reason": ev.get("note") or "GitHub returned HTTP %s" % ev.get("status")}
        result = evaluate(ev, tgt)
        result["target_name"] = tname
        result["notes"] = det_note(result)
        result["justification"] = result["notes"]
        result["evidence"] = evidence_lines(result)
        result["readme_head"] = ev.get("readme_head") or ""
        result["readme_title"] = ev.get("readme_title") or ""
        result["head_sha"] = json.loads(head_body).get("sha", "") if head_status == 200 else ""
        result["schema"] = VERIFY_SCHEMA
        result["status"] = "complete"
        result["repo_url"] = repo_url
        result["branch"] = branch
        result["mode"] = mode
        result["observed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        return result
    except Exception as e:
        return {"schema": VERIFY_SCHEMA, "status": "unverifiable", "repo_url": repo_url,
                "reason": error_text(e), "mode": mode}


def run_extract(job, token, cache=None):
    repo_url = str(job.get("repoUrl") or "").strip()
    docs_url = str(job.get("docsUrl") or "").strip()
    package = str(job.get("pkg") or "").strip()
    uploads = job.get("uploads") or {}
    get, mode, missing = choose_fetcher(token, cache)
    FETCH[0] = get
    try:
        ctx = prepare_sources(get, repo_url or None, None, docs_url or None,
                              package or None, uploads or None)
        if missing:
            return need_fetch(EXTRACT_SCHEMA, missing, {})
        if not ctx:
            return {"schema": EXTRACT_SCHEMA, "status": "empty", "mode": mode,
                    "reason": "No source yielded readable content. Check the repo URL, docs URL, package name, or attached files."}
        out = finalize(ctx, "")
        out["schema"] = EXTRACT_SCHEMA
        out["status"] = "complete"
        out["mode"] = mode
        out["prompt"] = build_prompt(ctx)
        out["corpus_lower"] = str(ctx.get("corpus_lower") or "")[:40000]
        return out
    except Exception as e:
        return {"schema": EXTRACT_SCHEMA, "status": "failed", "reason": error_text(e), "mode": mode}
