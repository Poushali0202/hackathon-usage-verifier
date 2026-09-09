# Shared Daytona GitHub fetch helper. Uploaded as sandbox_github.py in the sandbox.
# Prefer a local git clone so a batch is not killed by GitHub's unauthenticated
# 60 req/hour REST cap. HTTP + optional token is the fallback.
import json, os, re, shutil, subprocess
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlparse, parse_qs, unquote

TOKEN = (os.environ.get("ROCKETRIDE_GITHUB_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
_SPLICED = "${ROCKETRIDE_GITHUB_TOKEN}"
if (not TOKEN) and _SPLICED and ("ROCKETRIDE_GITHUB_TOKEN" not in _SPLICED) and (not _SPLICED.startswith("${")):
    TOKEN = _SPLICED.strip()

UA = os.environ.get("HJ_UA") or "hackjudge-sandbox"
ROOT = "/tmp/hj-repo"
_clone = {"ok": False, "owner": "", "repo": "", "err": ""}


def _git_env():
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ASKPASS"] = "echo"
    return env


def _redact(text):
    text = text or ""
    if TOKEN:
        text = text.replace(TOKEN, "***")
    return text[-800:]


def git_run(*args, timeout=120):
    try:
        p = subprocess.run(["git", *args], capture_output=True, text=True, timeout=timeout, env=_git_env())
        return p.returncode, p.stdout or "", p.stderr or ""
    except FileNotFoundError:
        return 127, "", "git not installed in the sandbox"
    except subprocess.TimeoutExpired:
        return 124, "", "git timed out"


def git_c(*args, timeout=60):
    return git_run("-C", ROOT, *args, timeout=timeout)


def ensure_clone(owner, repo):
    if _clone["ok"] and _clone["owner"] == owner and _clone["repo"] == repo:
        return True
    shutil.rmtree(ROOT, ignore_errors=True)
    url = "https://github.com/%s/%s.git" % (owner, repo)
    if TOKEN:
        url = "https://x-access-token:%s@github.com/%s/%s.git" % (TOKEN, owner, repo)
    code, out, err = git_run("clone", "--quiet", "--depth", "1", "--single-branch", url, ROOT, timeout=180)
    _clone["ok"] = code == 0
    _clone["owner"] = owner
    _clone["repo"] = repo
    _clone["err"] = _redact(err or out)
    return _clone["ok"]


def http_get(url):
    headers = {"User-Agent": UA, "Accept": "application/vnd.github+json"}
    if TOKEN and ("api.github.com" in url or "raw.githubusercontent.com" in url):
        headers["Authorization"] = "Bearer " + TOKEN
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=45) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace") if e.fp else ""
    except Exception as e:
        return 0, str(e)


def _commits(extra, limit=100):
    args = ["log", "--format=%H|%aI|%cI", "-n", str(limit)]
    args.extend(extra or [])
    code, out, err = git_c(*args)
    rows = []
    for line in out.splitlines():
        parts = line.strip().split("|")
        if len(parts) < 3:
            continue
        sha, author, committer = parts[0], parts[1], parts[2]
        rows.append({"sha": sha, "commit": {"author": {"date": author}, "committer": {"date": committer}}})
    return 200, json.dumps(rows)


def from_git(url):
    if not _clone["ok"]:
        return None
    raw = re.match(r"^https://raw\.githubusercontent\.com/[^/]+/[^/]+/[^/]+/(.+)$", url)
    if raw:
        rel = unquote(raw.group(1))
        path = os.path.join(ROOT, *rel.split("/"))
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                return 200, fh.read()
        return 404, ""
    if "api.github.com/repos/" not in url:
        return None
    parsed = urlparse(url)
    q = parse_qs(parsed.query)
    parts = [p for p in parsed.path.split("/") if p]
    rest = parts[3:] if len(parts) > 3 else []
    if not rest:
        _c, branch, _e = git_c("rev-parse", "--abbrev-ref", "HEAD")
        branch = (branch or "main").strip() or "main"
        _c, created, _e = git_c("log", "--reverse", "--format=%aI", "-n", "1")
        return 200, json.dumps({"default_branch": branch, "created_at": (created or "").strip()})
    if len(rest) >= 2 and rest[0] == "git" and rest[1] == "trees":
        _c, out, _e = git_c("ls-tree", "-r", "--full-tree", "HEAD")
        tree = []
        for line in out.splitlines():
            if "\t" not in line:
                continue
            meta, pth = line.split("\t", 1)
            bits = meta.split()
            if len(bits) >= 2 and bits[1] == "blob":
                tree.append({"path": pth, "type": "blob"})
        return 200, json.dumps({"tree": tree, "truncated": False})
    if rest[:1] == ["languages"]:
        return 404, ""
    if rest[:1] == ["commits"]:
        if len(rest) >= 2 and rest[1] and not q:
            _c, sha, _e = git_c("rev-parse", rest[1])
            sha = (sha or "").strip()
            if not sha:
                _c, sha, _e = git_c("rev-parse", "HEAD")
                sha = (sha or "").strip()
            return 200, json.dumps({"sha": sha})
        extra = []
        if q.get("until"):
            extra.append("--until=" + q["until"][0])
        if q.get("path"):
            extra.extend(["--", q["path"][0]])
        limit = 100
        if q.get("per_page"):
            try:
                limit = max(1, min(100, int(q["per_page"][0])))
            except Exception:
                pass
        return _commits(extra, limit)
    return None


def get(url):
    local = from_git(url)
    if local is not None:
        return local
    return http_get(url)
