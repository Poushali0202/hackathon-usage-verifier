"""Target-config extraction from a product vendor's own repo ("Prefill from repo").

Given the VENDOR's repository (not a consumer repo), derive a draft TargetConfig for the
Targets editor: deterministic candidates from manifests / env examples / CLI definitions /
editor manifests / docs, optionally synthesized by the LLM over the doc excerpts, then a
VERIFICATION GATE drops any token that does not literally appear in the fetched corpus
(same trust-but-verify philosophy as run_batch.apply_llm_mapping). Target-agnostic: no
product names in code.

Split for the async endpoint:
    prepare(url, gh, extra_url)  -> ctx dict  (sync, network via gh; run in a thread)
    build_prompt(ctx)            -> str for ClassifierPool.ask (or None if no docs found)
    finalize(ctx, answer_text)   -> {config, sources, warnings, suggestions}
finalize works with answer_text="" too (deterministic-only fallback when the cloud is down).
"""
from __future__ import annotations

import json
import re

from engine import _iter_json_objects  # eval/ is on sys.path wherever this is imported

MAX_DOC_FILES = 6
MAX_PKG_FILES = 12

_ENV_RX = re.compile(r"\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\b")
_URL_HOST_RX = re.compile(r"https?://([\w-]+(?:\.[\w-]+)+)", re.I)
_CMD_JS_RX = re.compile(r"\.command\(\s*['\"]([a-z][\w:-]*)")
_CMD_PY_RX = re.compile(r"add_parser\(\s*['\"]([a-z][\w-]*)")
_GLOB_RX = re.compile(r'"filenamePattern"\s*:\s*"(\*[^"]+)"')
_EXT_PROSE_RX = re.compile(r"`?\*\.([a-z][a-z0-9.]{1,11})`?")
_DOTDIR_RX = re.compile(r"['\"](\.[a-z][\w-]{2,24})/")
_KEYPFX_RX = re.compile(r"startswith\(\s*['\"]([a-z][a-z0-9]{1,11}_)['\"]")
_PYPROJ_NAME_RX = re.compile(r'^\s*name\s*=\s*"([^"]+)"', re.M)
_PYPROJ_SCRIPT_RX = re.compile(r"^\s*([\w-]+)\s*=\s*\"[\w.]+:[\w]+\"", re.M)

_GENERIC_ENV_PFX = {"NODE", "NPM", "PATH", "HOME", "PORT", "HTTP", "HTTPS", "DEBUG", "LOG",
                    "CI", "GITHUB", "GIT", "AWS", "GCP", "GOOGLE", "AZURE", "DOCKER", "K8S",
                    "OPENAI", "ANTHROPIC", "GEMINI", "OLLAMA", "PYTHON", "PIP", "VITE",
                    "REACT", "NEXT", "PUBLIC", "DATABASE", "REDIS", "POSTGRES", "API",
                    "APP", "ENV", "TEST", "MAX", "MIN", "DEFAULT", "CONST"}
_GENERIC_HOSTS = ("github.com", "githubusercontent.com", "npmjs.com", "pypi.org",
                  "localhost", "example.com", "shields.io", "img.shields", "opensource.org",
                  "openai.com", "anthropic.com", "googleapis.com", "google.com",
                  "microsoft.com", "visualstudio.com", "open-vsx.org", "docker.com",
                  "kubernetes.io", "amazonaws.com", "w3.org", "schema.org", "readthedocs")
_GENERIC_EXTS = {"js", "ts", "tsx", "jsx", "py", "md", "json", "txt", "yml", "yaml", "css",
                 "html", "sh", "env", "lock", "toml", "cfg", "ini", "xml", "png", "svg",
                 "jpg", "csv", "xlsx", "pdf", "map", "cjs", "mjs", "log", "zip", "gz",
                 "tgz", "vsix", "whl", "tar", "exe", "dmg", "jar", "iso", "deb", "rpm"}
_GENERIC_DOTDIRS = {".github", ".vscode", ".git", ".idea", ".venv", ".env", ".cache",
                    ".config", ".local", ".docker", ".devcontainer", ".husky", ".next",
                    ".expo", ".vite", ".pytest_cache", ".tox", ".mypy_cache", ".circleci"}


def infer_architecture_template(types) -> str:
    """Same product-class map as the TypeScript `inferArchitectureTemplate` (types-only)."""
    tset = {str(x).lower() for x in (types or [])}
    if "platform" in tset and ("code" in tset or "api" in tset):
        return "data_platform"
    if "platform" in tset:
        return "deploy"
    if "api" in tset and "code" not in tset:
        return "api"
    return "sdk"


def _fetch(url: str, gh) -> tuple | None:
    """(owner, repo, paths, raw_fn) for a repo, or None if unreadable."""
    import run_batch as rb
    pr = rb.parse_repo(url)
    if not pr:
        return None
    owner, repo = pr
    st, body = gh(f"https://api.github.com/repos/{owner}/{repo}")
    if st != 200:
        return None
    branch = json.loads(body).get("default_branch", "main")
    st, tbody = gh(f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1")
    if st != 200:
        return None
    paths = [x.get("path", "") for x in json.loads(tbody).get("tree", [])]

    def raw(p):
        return gh(f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{p}")[1]

    return owner, repo, paths, raw


def _interesting_files(paths: list) -> dict:
    """Pick the small set of files worth fetching, bucketed by role. Candidates are
    collected first and then RANKED per bucket - a monorepo has dozens of plausible
    matches, and depth alone picks the wrong ones (e.g. app scripts over the real CLI)."""
    buckets: dict = {"pkg": [], "env": [], "cli": [], "docs": [], "consts": []}
    for p in paths:
        pl = p.lower()
        if "node_modules/" in pl or "/dist/" in pl or "/build/" in pl or "test" in pl:
            continue
        base = pl.rsplit("/", 1)[-1]
        depth = p.count("/")
        if base in ("package.json", "pyproject.toml", "setup.py"):
            # the PUBLISHED package usually lives under packages|client|sdk|lib|core dirs;
            # app manifests (apps/*) are almost always private and belong at the tail
            prio = 0 if depth == 0 or re.search(r"(^|/)(packages?|clients?|sdk|libs?|core)(/|$)", pl) else 1
            buckets["pkg"].append((prio, depth, p))
        elif base.endswith((".env.example", ".env.sample", "env.example")):
            buckets["env"].append((depth, p))
        elif pl.endswith((".py", ".ts", ".js")) and re.search(r"(^|/)cli/|/cli\.|command", pl):
            # real CLIs live in a cli/ directory; "command" matches elsewhere are weaker
            buckets["cli"].append((0 if "/cli/" in pl or pl.endswith("cli.py") else 1, depth, p))
        elif re.search(r"constants\.(ts|js|py)$|agent-manager\.ts$", pl):
            # SDK/client constants outrank app-level ones
            buckets["consts"].append((0 if "client" in pl or "sdk" in pl else 1, depth, p))
        elif base.endswith((".md", ".rst", ".txt")) and re.search(r"readme|quickstart|getting.?started", base):
            buckets["docs"].append((0 if "quickstart" in base else 1, depth, p))
    caps = {"pkg": MAX_PKG_FILES, "env": 4, "cli": 10, "docs": MAX_DOC_FILES, "consts": 5}
    return {k: [t[-1] for t in sorted(v)[:caps[k]]] for k, v in buckets.items()}


def _candidates(corpus: dict, pick: dict) -> tuple:
    """Deterministic candidates + per-field sources from the fetched corpus."""
    cand = {"dependency_names": [], "cli_bins": [], "cli_bins_raw": [], "cli_verbs": [],
            "env_vars": [], "hosts": [], "artifacts": [], "dotdirs": [], "key_prefixes": []}
    src: dict = {}

    def note(field, path):
        src.setdefault(field, set()).add(path)

    for p in pick["pkg"]:
        txt = corpus.get(p, "")
        if p.endswith("package.json"):
            try:
                d = json.loads(txt)
            except Exception:
                continue
            name = d.get("name", "")
            if name and d.get("private") is not True:      # private filter is load-bearing
                cand["dependency_names"].append(name)
                note("dependency_names", p)
            for b in (d.get("bin") or {}):
                cand["cli_bins"].append(b)
                cand["cli_bins_raw"].append(b)
                note("cli_verbs", p)
            for sel in (d.get("contributes", {}).get("customEditors") or []):
                for s in (sel.get("selector") or []):
                    g = s.get("filenamePattern", "")
                    if g.startswith("*."):
                        cand["artifacts"].append(g)
                        note("artifacts", p)
        else:                                              # pyproject / setup
            m = _PYPROJ_NAME_RX.search(txt)
            if m:
                cand["dependency_names"].append(m.group(1))
                note("dependency_names", p)
            if "[project.scripts]" in txt:
                seg = txt.split("[project.scripts]", 1)[1][:600]
                for sm in _PYPROJ_SCRIPT_RX.finditer(seg):
                    cand["cli_bins"].append(sm.group(1))
                    cand["cli_bins_raw"].append(sm.group(1))
                    note("cli_verbs", p)

    for p in pick["env"] + pick["docs"] + pick["consts"]:
        for v in _ENV_RX.findall(corpus.get(p, "")):
            cand["env_vars"].append(v)
            note("hosted_markers", p)

    for p, txt in corpus.items():
        for h in _URL_HOST_RX.findall(txt):
            hl = h.lower()
            if not any(g in hl for g in _GENERIC_HOSTS):
                cand["hosts"].append(hl)
                note("hosted_markers", p)
        for d in _DOTDIR_RX.findall(txt):
            if d.lower() not in _GENERIC_DOTDIRS:
                cand["dotdirs"].append(d)
                note("platform_files", p)
        for k in _KEYPFX_RX.findall(txt):
            cand["key_prefixes"].append(k)
            note("platform_markers", p)

    # command definitions can hide outside the cli bucket (helper modules, docs snippets) -
    # scan the whole fetched corpus; verbs are bin-prefixed and human-reviewed anyway
    for p, txt in corpus.items():
        for v in _CMD_JS_RX.findall(txt) + _CMD_PY_RX.findall(txt):
            cand["cli_verbs"].append(v)
            note("cli_verbs", p)

    for p in pick["docs"]:
        for e in _EXT_PROSE_RX.findall(corpus.get(p, "")):
            if e.rstrip(".") not in _GENERIC_EXTS:
                cand["artifacts"].append(f"*.{e}")
                note("artifacts", p)

    all_lower = "\n".join(corpus.values()).lower()

    # env cluster: dominant non-generic prefix wins (product vars); others are noise.
    # A var whose only life is as a doc FILENAME (VAR.md) is a doc reference, not an env var.
    counts: dict = {}
    for v in cand["env_vars"]:
        pfx = v.split("_", 1)[0]
        if pfx in _GENERIC_ENV_PFX or len(pfx) < 3:
            continue
        if f"{v.lower()}.md" in all_lower and f"{v.lower()}=" not in all_lower:
            continue
        counts.setdefault(pfx, set()).add(v)
    cluster = max(counts.items(), key=lambda kv: len(kv[1]))[1] if counts else set()
    cand["env_vars"] = sorted(cluster)[:8]

    # hosts: rank product-own domains first (host contains a dependency/bin name token),
    # then by frequency - partner/integration domains mentioned in docs sink to the tail
    from collections import Counter
    own_tokens = {re.sub(r"[^a-z0-9]", "", t.lower())
                  for t in cand["dependency_names"] + cand["cli_bins"] if len(t) >= 4}
    freq = Counter(cand["hosts"])
    cand["hosts"] = [h for h, _ in sorted(
        freq.items(),
        key=lambda kv: (0 if any(t and t in kv[0].replace(".", "").replace("-", "")
                                 for t in own_tokens) else 1, -kv[1]))][:8]

    for k in cand:
        cand[k] = list(dict.fromkeys(cand[k]))             # dedupe, keep order
    return cand, {f: sorted(ps) for f, ps in src.items()}


def _http_get(url: str, timeout: int = 20) -> tuple:
    """Plain HTTP fetch for docs pages / registries (never sends the GitHub token)."""
    from urllib import request as _rq
    try:
        req = _rq.Request(url, headers={"User-Agent": "HackJudge-TargetExtract/1.0"})
        with _rq.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(1_000_000).decode("utf-8", "replace")
    except Exception:
        return 0, ""


_TAG_RX = re.compile(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>")
_HREF_RX = re.compile(r'href=["\']([^"\'#?]+)')


def _html_text(body: str) -> str:
    import html as _html
    return re.sub(r"[ \t]+", " ", _html.unescape(_TAG_RX.sub(" ", body)))


def _docs_corpus(url: str) -> tuple:
    """The given docs page + up to 3 same-host quickstart-ish linked pages, as text."""
    from urllib.parse import urljoin, urlparse
    corpus: dict = {}
    st, body = _http_get(url)
    if st != 200 or not body:
        return corpus, [f"Docs URL could not be fetched: {url}"]
    corpus[f"docs:{url}"] = _html_text(body) if "<" in body[:500] else body
    host = urlparse(url).netloc
    seen: set = set()
    for href in _HREF_RX.findall(body):
        if len(seen) >= 3:
            break
        full = urljoin(url, href)
        if (urlparse(full).netloc != host or full == url or full in seen
                or not re.search(r"quickstart|getting|install|setup|cli|environment", full, re.I)):
            continue
        seen.add(full)
        st2, b2 = _http_get(full)
        if st2 == 200 and b2:
            corpus[f"docs:{full}"] = _html_text(b2) if "<" in b2[:500] else b2
    return corpus, []


def _registry_corpus(pkg: str) -> tuple:
    """npm + PyPI metadata for a package name - public even when the repo is private.
    Emitted as synthetic manifest/README corpus entries so the normal parsers apply."""
    corpus, warns, found = {}, [], False
    st, body = _http_get(f"https://registry.npmjs.org/{pkg.replace('/', '%2F')}")
    if st == 200:
        try:
            d = json.loads(body)
            latest = (d.get("dist-tags") or {}).get("latest", "")
            v = (d.get("versions") or {}).get(latest, {})
            man = {"name": d.get("name", pkg)}
            if v.get("bin"):
                man["bin"] = v["bin"]
            corpus[f"npm:{pkg}/package.json"] = json.dumps(man)
            if d.get("readme"):
                corpus[f"npm:{pkg}/README.md"] = str(d["readme"])[:60000]
            found = True
        except Exception:
            pass
    st, body = _http_get(f"https://pypi.org/pypi/{pkg}/json")
    if st == 200:
        try:
            info = json.loads(body).get("info", {})
            corpus[f"pypi:{pkg}/pyproject.toml"] = f'name = "{info.get("name", pkg)}"'
            if info.get("description"):
                corpus[f"pypi:{pkg}/README.md"] = str(info["description"])[:60000]
            found = True
        except Exception:
            pass
    if not found:
        warns.append(f"Package not found on npm or PyPI: {pkg}")
    return corpus, warns


def _bucket_for_upload(name: str) -> str:
    nl = name.lower()
    if nl.endswith(("package.json", "pyproject.toml", "setup.py")):
        return "pkg"
    if ".env" in nl or nl.endswith((".example", ".sample")):
        return "env"
    if nl.endswith((".ts", ".js", ".py")):
        return "consts"
    return "docs"        # md/rst/txt/yaml/json specs - hosts/env regexes scan corpus-wide too


def prepare_sources(gh, repo_url: str | None = None, extra_url: str | None = None,
                    docs_url: str | None = None, package: str | None = None,
                    uploads: dict | None = None) -> dict | None:
    """Build one corpus from any mix of sources (vendor repo, docs site, registry
    package, uploaded files), then run the same candidate extraction. Returns None only
    if NO source yielded content."""
    corpus: dict = {}
    pick = {"pkg": [], "env": [], "cli": [], "docs": [], "consts": []}
    warnings: list = []
    label_parts: list = []

    if repo_url:
        fetched = _fetch(repo_url, gh)
        if fetched:
            owner, repo, paths, raw = fetched
            rpick = _interesting_files(paths)
            for grp, ps in rpick.items():
                for p in ps:
                    corpus[p] = raw(p)
                    pick[grp].append(p)
            label_parts.append(f"{owner}/{repo}")
        else:
            warnings.append(f"Repo could not be read: {repo_url}")
    if extra_url:
        extra = _fetch(extra_url, gh)
        if extra:
            _, _, epaths, eraw = extra
            epick = _interesting_files(epaths)
            for grp, ps in epick.items():
                for p in ps:
                    corpus[f"extra:{p}"] = eraw(p)
                    pick[grp].append(f"extra:{p}")
        else:
            warnings.append(f"Second repo could not be read: {extra_url}")
    if docs_url:
        dcorp, dwarns = _docs_corpus(docs_url)
        corpus.update(dcorp)
        pick["docs"].extend(dcorp.keys())
        warnings.extend(dwarns)
        if dcorp:
            from urllib.parse import urlparse
            label_parts.append(urlparse(docs_url).netloc)
    if package:
        rcorp, rwarns = _registry_corpus(package.strip())
        corpus.update(rcorp)
        for k in rcorp:
            pick["pkg" if k.endswith((".json", ".toml")) else "docs"].append(k)
        warnings.extend(rwarns)
        if rcorp:
            label_parts.append(package.strip())
    for name, text in (uploads or {}).items():
        key = f"upload:{name}"
        corpus[key] = text
        pick[_bucket_for_upload(name)].append(key)
    if uploads:
        label_parts.append(f"{len(uploads)} uploaded file(s)")

    if not corpus:
        return None
    cand, sources = _candidates(corpus, pick)
    docs_excerpts = "\n\n".join(
        f"--- {p} ---\n{corpus[p][:2500]}" for p in pick["docs"][:5]) or ""
    return {"repo": " + ".join(label_parts) or "provided sources",
            "candidates": cand, "sources": sources,
            "corpus_lower": "\n".join(corpus.values()).lower(),
            "docs_excerpts": docs_excerpts[:12000], "warnings": warnings}


def prepare(url: str, gh, extra_url: str | None = None) -> dict | None:
    """Back-compat wrapper: repo-only extraction."""
    return prepare_sources(gh, repo_url=url, extra_url=extra_url)


_PROMPT = """You are configuring a hackathon-judging tool. From the VENDOR repo material below,
produce the detection signals a judge would use to verify that a CONSUMER project genuinely
used this product. Return ONLY a strict JSON object (start with {{ and end with }}):
{{
  "name": "<product name>",
  "dependency_names": "<comma-separated package names a consumer installs>",
  "artifacts": "<comma-separated file globs/conventions consumers commit, e.g. *.pipe>",
  "invocation": "<pipe-separated code patterns consumers write: client classes, key methods, import forms>",
  "hosted_markers": "<comma-separated consumer-side env var names and API hosts>",
  "cli_verbs": "<comma-separated CLI commands incl. binary name, e.g. 'acme start'>",
  "platform_domains": "<comma-separated vendor platform/deploy domains>",
  "platform_files": "<comma-separated config files/dirs the product writes into consumer repos>",
  "platform_markers": "<comma-separated key/id prefixes, e.g. sk_>",
  "suggestions": {{ "competitors": "<comma-separated, MAY use general knowledge>",
                    "neutral": "<comma-separated commonly co-used neutral tools>" }}
}}
Rules: every value OUTSIDE "suggestions" must be evidenced by the material below - do not
invent. Prefer consumer-side signals over vendor-internal ones (internal env prefixes, private
workspace packages, ops domains are NOT detection signals). NEVER derive competitors from the
repo itself - a product's integrations are not its rivals; competitors go ONLY in suggestions.
Leave a field as "" if the material shows nothing for it. No em dashes anywhere.

DETERMINISTIC CANDIDATES (pre-extracted, with the same evidence rules):
{candidates}

DOC EXCERPTS:
{docs}"""


def build_prompt(ctx: dict) -> str:
    return _PROMPT.format(candidates=json.dumps(ctx["candidates"], indent=1),
                          docs=ctx["docs_excerpts"] or "(no docs found)")


def _verify_field(value: str, corpus_lower: str, sep: str) -> tuple:
    """Keep only tokens evidenced in the fetched corpus. Verification is per WORD: a
    multi-word token like "rocketride start" passes when both words appear (the binary
    and its verb live in different files), but a token with any un-evidenced word drops."""
    kept, dropped = [], []
    for tok in re.split(r"[|,\n]", value or ""):
        t = tok.strip()
        if not t:
            continue
        words = [w.lstrip("*.").lower() for w in re.split(r"\s+", t)]
        words = [w for w in words if w]
        ok = bool(words) and all(w in corpus_lower for w in words)
        (kept if ok else dropped).append(t)
    return sep.join(dict.fromkeys(kept)), dropped


def _fallback_config(cand: dict) -> dict:
    """Deterministic-only draft (used when the LLM is unreachable or returns junk)."""
    from collections import Counter
    # the main binary ships from multiple SDKs (same name in npm bin + console_scripts);
    # companion tools (x-mcp etc.) appear once - most frequent wins, shortest breaks ties
    ranked = sorted(Counter(cand["cli_bins_raw"]).items(), key=lambda kv: (-kv[1], len(kv[0])))
    bins = [b for b, _ in ranked] or cand["cli_bins"]
    verbs = [f"{bins[0]} {v}" for v in cand["cli_verbs"][:6]] if bins else []
    return {
        "name": (cand["dependency_names"][0] if cand["dependency_names"] else ""),
        "dependency_names": ", ".join(cand["dependency_names"][:4]),
        "artifacts": ", ".join(cand["artifacts"][:4]),
        "invocation": "",
        "hosted_markers": ", ".join((cand["env_vars"][:5] + cand["hosts"][:3])),
        "cli_verbs": ", ".join(verbs),
        "platform_domains": ", ".join(cand["hosts"][:4]),
        "platform_files": ", ".join(cand["dotdirs"][:4]),
        "platform_markers": ", ".join(cand["key_prefixes"][:4]),
        "suggestions": {"competitors": "", "neutral": ""},
    }


def finalize(ctx: dict, answer_text: str) -> dict:
    """Merge LLM output (if any) with candidates, then apply the verification gate."""
    parsed: dict = {}
    for c in _iter_json_objects(answer_text or ""):
        try:
            obj = json.loads(c)
        except Exception:
            continue
        if isinstance(obj, dict) and "dependency_names" in obj:
            parsed = obj
    cfg = parsed or _fallback_config(ctx["candidates"])
    suggestions = cfg.pop("suggestions", {}) or {}
    warnings = list(ctx["warnings"])
    if not parsed:
        warnings.append("LLM synthesis unavailable; prefill is deterministic-only "
                        "(invocation patterns need the docs pass).")

    corpus = ctx["corpus_lower"]
    out = {"types": []}
    seps = {"invocation": " | "}
    for field in ("name", "dependency_names", "artifacts", "invocation", "hosted_markers",
                  "cli_verbs", "platform_domains", "platform_files", "platform_markers"):
        val = str(cfg.get(field, "") or "")
        if field == "name":
            out[field] = val.strip()[:80]
            continue
        kept, dropped = _verify_field(val, corpus, seps.get(field, ", "))
        out[field] = kept
        if dropped:
            warnings.append(f"{field}: dropped unverified token(s) {', '.join(dropped[:4])}")

    if out.get("dependency_names") or out.get("invocation"):
        out["types"].append("code")
    if out.get("platform_domains") or out.get("platform_files"):
        out["types"].append("platform")
    # REST-first products: an api.* host or versioned API path in the signals means
    # consumers can hit it as a service, SDK or not
    api_probe = " ".join((out.get("hosted_markers", ""), out.get("invocation", ""),
                          out.get("platform_domains", ""))).lower()
    if "api." in api_probe or "/v1/" in api_probe or "/api/" in api_probe:
        out["types"].append("api")
    if not out["types"]:
        out["types"] = ["code"]
    out["architecture_template"] = infer_architecture_template(out["types"])
    if not cfg.get("competitors"):
        warnings.append("Competitors cannot be derived from the vendor repo "
                        "(its integrations are not rivals) - add them manually.")
    return {"repo": ctx["repo"], "config": out, "sources": ctx["sources"],
            "warnings": warnings,
            "suggestions": {"competitors": str(suggestions.get("competitors", "") or ""),
                            "neutral": str(suggestions.get("neutral", "") or "")}}
