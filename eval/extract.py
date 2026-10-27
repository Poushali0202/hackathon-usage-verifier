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
                    "APP", "ENV", "TEST", "MAX", "MIN", "DEFAULT", "CONST", "PREFERENCE",
                    "VSCODE", "EDITOR", "THEME", "COLOR", "FONT", "RENDER", "WINDOW", "PANEL"}
_GENERIC_HOSTS = ("github.com", "githubusercontent.com", "npmjs.com", "pypi.org",
                  "localhost", "example.com", "shields.io", "img.shields", "opensource.org",
                  "openai.com", "anthropic.com", "googleapis.com", "google.com",
                  "microsoft.com", "visualstudio.com", "open-vsx.org", "docker.com",
                  "kubernetes.io", "amazonaws.com", "w3.org", "schema.org", "readthedocs")
_DOC_HOST_PFX = ("docs.", "www.", "blog.", "status.", "doc.", "readthedocs.")
_SKIP_PKG_RX = re.compile(
    r"(?:^|/)(?:comparative[-_])?(?:starter(?:-kit)?|example|examples|demo|evals?|benchmark|playground|frontend|[-_]mcp)(?:$|[-_/])"
    r"|-(?:starter(?:-kit)?|example|examples|demo|evals?|mcp|frontend)$",
    re.I,
)
_EDITOR_PATH_RX = re.compile(
    r"(^|/)([^/]*(frontend|vscode|\.vscode|editor|webui)[^/]*)(/|$)",
    re.I,
)
_GENERIC_CMDS = {
    "brew", "cargo", "npm", "npx", "pip", "pip3", "cd", "echo", "export", "curl", "wget",
    "git", "sudo", "mkdir", "cat", "ls", "docker", "make", "python", "python3", "node",
    "yarn", "pnpm", "uv", "apt", "apk", "choco", "scoop", "winget", "source", "set",
}
_NAME_SKIP = {"quick start", "getting started", "home", "documentation", "docs", "readme",
              "install", "overview", "index", "tier 1", "tier 2", "tier 3", "pricing",
              "license", "contributing", "changelog", "security", "code of conduct"}
_STOP_WORDS = {
    "the", "a", "an", "to", "of", "in", "for", "with", "and", "or", "on", "as", "by",
    "from", "this", "that", "is", "are", "be", "it", "we", "you", "your", "our",
    "learn", "build", "see", "graph", "use", "using", "turns",
    "documents", "into", "text", "memory", "about", "pipeline",
}
_CLI_PROSE = _STOP_WORDS | {"learn", "build", "see", "graph", "using", "turns", "documents"}
_NOT_METHODS = {
    "ai", "io", "com", "org", "dev", "app", "net", "svg", "png", "jpg", "jpeg", "gif",
    "ico", "css", "js", "ts", "md", "json", "html", "htm", "toml", "lock", "map", "py",
    "rs", "go", "txt", "yml", "yaml", "pdf", "xml", "svgx", "woff", "ttf",
}
_CONSUMER_ENV_RX = re.compile(
    r"(API_KEY|API_URL|BASE_URL|BACKEND_URL|ENDPOINT|_TOKEN$|_SECRET$|_HOST$|CLOUD)",
    re.I,
)
_FENCE_RX = re.compile(r"```(?:bash|shell|sh|zsh|console|powershell)\b[^\n]*\n(.*?)```", re.I | re.S)
_TITLE_RX = re.compile(r"<title>([^<]+)</title>", re.I)
_STRONG_RX = re.compile(r"<strong>([^<]{2,48})</strong>", re.I)
_H1_RX = re.compile(r"^#\s+(.+)$", re.M)
_IMPORT_RX = re.compile(
    r"(?m)^\s*(?:import\s+([a-z][\w.]*)|from\s+([a-z][\w.]*)\s+import)",
    re.I,
)
_CARGO_PKG_RX = re.compile(r"(?ms)\[package\].*?^name\s*=\s*\"([^\"]+)\"")
_CARGO_BIN_RX = re.compile(r"(?ms)\[\[bin\]\].*?^name\s*=\s*\"([^\"]+)\"")
_CMD_RS_RX = re.compile(r'#\[(?:command|clap)\([^)]*name\s*=\s*"([a-z][\w-]*)"', re.I)
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


def _name_from_title(title: str) -> str:
    """Turn 'Quick Start - Hotdata Docs' / 'Hotdata CLI' into a product display name."""
    title = re.sub(r"\s+", " ", title or "").strip()
    if not title:
        return ""
    if re.fullmatch(r"tier\s*\d+", title, flags=re.I):
        return ""
    parts = [p.strip() for p in re.split(r"\s+[-|–—]\s+", title) if p.strip()]
    for part in reversed(parts or [title]):
        cleaned = re.sub(r"\bdocs?\b", "", part, flags=re.I)
        cleaned = re.sub(r"\s+CLI\s*$", "", cleaned, flags=re.I).strip(" -")
        if cleaned and cleaned.lower() not in _NAME_SKIP and 1 < len(cleaned) <= 40:
            if re.fullmatch(r"tier\s*\d+", cleaned, flags=re.I):
                continue
            return cleaned
    return ""


def _product_stems(cand: dict, ctx: dict | None = None) -> set:
    ctx = ctx or {}
    stems = set()
    for n in (cand.get("dependency_names") or []) + (cand.get("cli_bins") or []):
        s = re.sub(r"[^a-z0-9]", "", re.sub(r"-cli$", "", (n or "").lower()))
        if len(s) >= 3:
            stems.add(s)
    repo = str(ctx.get("repo") or "").split("/")[-1]
    rs = re.sub(r"[^a-z0-9]", "", re.sub(r"-cli$", "", repo.lower()))
    if len(rs) >= 3:
        stems.add(rs)
    return stems


def _plausible_name(name: str, stems: set) -> bool:
    n = (name or "").strip()
    if not n or n.lower() in _NAME_SKIP or re.fullmatch(r"tier\s*\d+", n, flags=re.I):
        return False
    if not re.search(r"[A-Za-z]", n):
        return False
    nl = re.sub(r"[^a-z0-9]", "", n.lower())
    if len(nl) < 3:
        return False
    if not stems:
        return True
    return any(s in nl or nl in s for s in stems)


def _ok_invocation(token: str, stems: set) -> bool:
    t = (token or "").strip()
    if re.match(r"^(import|from)\s+[a-z]", t, re.I):
        return True
    m = re.fullmatch(r"([a-z][\w-]*)\.([a-z][\w]*)", t, re.I)
    if m:
        meth = m.group(2).lower()
        if meth in _NOT_METHODS or meth in _GENERIC_CMDS:
            return False
        stem = re.sub(r"[^a-z0-9]", "", m.group(1).lower())
        return (not stems) or stem in stems
    return _is_cli_phrase(t)


def _is_cli_phrase(phrase: str, known: set | None = None) -> bool:
    parts = [p for p in re.split(r"\s+", (phrase or "").strip()) if p]
    if not parts:
        return False
    if any(not re.fullmatch(r"[A-Za-z0-9_./\-]+", p) for p in parts):
        return False
    if '"' in phrase or "'" in phrase:
        return False
    if re.search(r"\.(svg|png|jpg|jpeg|gif|ai|io|com|org|dev|net|html?|md)$", parts[0], re.I):
        return False
    bin_name = re.sub(r"[^a-z0-9-]", "", parts[0].lower())
    if bin_name in _GENERIC_CMDS or bin_name in _STOP_WORDS:
        return False
    if any(re.sub(r"[^a-z0-9-]", "", p.lower()) in _CLI_PROSE for p in parts[1:]):
        return False
    if known is not None and bin_name not in known:
        return False
    return True


def _pkg_alias(primary: str, name: str) -> bool:
    """Same published product (scoped npm / -cli / -sdk), not a sibling workspace package."""
    p = re.sub(r"[^a-z0-9]", "", (primary or "").rsplit("/", 1)[-1].lower())
    n = re.sub(r"[^a-z0-9]", "", (name or "").rsplit("/", 1)[-1].lower())
    if not p or not n:
        return False
    if n == p:
        return True
    extra = n[len(p):] if n.startswith(p) else ""
    return extra in ("ts", "js", "py", "cli", "sdk")


def _consumer_pkg_name(name: str) -> bool:
    """True if this looks like a package a consumer installs, not a workspace extra."""
    n = (name or "").strip()
    if not n:
        return False
    stem = n.rsplit("/", 1)[-1]
    if _SKIP_PKG_RX.search(stem) or _SKIP_PKG_RX.search(n):
        return False
    return True


def _is_platform_host(host: str) -> bool:
    hl = (host or "").lower().split("/")[0]
    if not hl or any(hl.startswith(p) for p in _DOC_HOST_PFX):
        return False
    return bool(re.search(r"(^|\.)(app|cloud|dashboard|platform)(\.|$)", hl) or "cloud" in hl)


def _commands_from_text(text: str, whole_is_code: bool = False) -> list:
    """CLI-like phrases from fenced / pre samples — not from prose sentences."""
    chunks = []
    if whole_is_code:
        chunks.append(text or "")
    else:
        chunks.extend(_FENCE_RX.findall(text or ""))
    out = []
    for chunk in chunks:
        for raw in (chunk or "").splitlines():
            line = re.sub(r"^\s*(?:[$#]\s*|PS>\s*)", "", raw).strip()
            if not line or line.startswith("#"):
                continue
            phrase = " ".join(line.split()[:4])
            if not _is_cli_phrase(phrase):
                continue
            out.append(phrase)
    return list(dict.fromkeys(out))


def _imports_from_text(text: str) -> list:
    out = []
    for m in _IMPORT_RX.finditer(text or ""):
        tok = next((g for g in m.groups() if g), "")
        tok = tok.split("::", 1)[0].split(".", 1)[0]
        if tok and tok.lower() not in _GENERIC_CMDS:
            out.append(tok)
    return list(dict.fromkeys(out))


def _package_title(cand: dict, ctx: dict | None = None) -> str:
    names = cand.get("dependency_names") or []
    if names:
        n = re.sub(r"-cli$", "", names[0], flags=re.I).replace("-", " ").strip()
        return n.title() if n else ""
    repo = str((ctx or {}).get("repo") or "").split("/")[-1]
    repo = re.sub(r"-cli$", "", repo, flags=re.I).replace("-", " ").strip()
    return repo.title() if repo else ""


def _display_name(cand: dict, ctx: dict | None = None) -> str:
    ctx = ctx or {}
    stems = _product_stems(cand, ctx)
    ranked: list[tuple[int, str]] = []

    def consider(name: str, rank: int) -> None:
        n = (name or "").strip()
        if _plausible_name(n, stems):
            ranked.append((rank, n))

    for path, txt in (ctx.get("corpus") or {}).items():
        docsish = path.startswith("docs:") or path.lower().endswith((".md", ".rst", ".html", ".txt"))
        hm = _H1_RX.search(txt or "")
        if hm:
            consider(_name_from_title(re.sub(r"</?[^>]+>", "", hm.group(1))), 0)
        if path.startswith("docs:") or "<title" in ((txt or "")[:2000].lower()):
            tm = _TITLE_RX.search(txt or "")
            if tm:
                consider(_name_from_title(tm.group(1)), 1)
        first = (txt or "").strip().splitlines()[:1]
        if docsish and first and "<" not in first[0]:
            consider(_name_from_title(first[0]), 2)
        for sm in _STRONG_RX.finditer(txt or ""):
            consider(_name_from_title(sm.group(1)), 3)
    if ranked:
        ranked.sort(key=lambda kv: kv[0])
        return ranked[0][1]
    desc = str(ctx.get("github_description") or "")
    m = re.search(r"\b(?:for|CLI(?:\s+tool)?\s+for)\s+([A-Z][A-Za-z0-9.]+)", desc)
    if m and _plausible_name(m.group(1).rstrip("."), stems):
        return m.group(1).rstrip(".")
    return _package_title(cand, ctx)


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
    meta = json.loads(body)
    branch = meta.get("default_branch", "main")
    description = str(meta.get("description") or "")
    st, tbody = gh(f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1")
    if st != 200:
        return None
    paths = [x.get("path", "") for x in json.loads(tbody).get("tree", [])]

    def raw(p):
        return gh(f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{p}")[1]

    return owner, repo, paths, raw, description


def _interesting_files(paths: list) -> dict:
    """Pick the small set of files worth fetching, bucketed by role. Candidates are
    collected first and then RANKED per bucket - a monorepo has dozens of plausible
    matches, and depth alone picks the wrong ones (e.g. app scripts over the real CLI)."""
    buckets: dict = {"pkg": [], "env": [], "cli": [], "docs": [], "consts": []}
    for p in paths:
        pl = p.lower()
        if "node_modules/" in pl or "/dist/" in pl or "/build/" in pl or "test" in pl:
            continue
        if any(_SKIP_PKG_RX.search(seg) or _EDITOR_PATH_RX.search(seg) for seg in pl.split("/")):
            continue
        base = pl.rsplit("/", 1)[-1]
        depth = p.count("/")
        if base in ("package.json", "pyproject.toml", "setup.py", "cargo.toml", "go.mod"):
            prio = 0 if depth == 0 else (1 if re.search(r"(^|/)(packages?|clients?|sdk|libs?|core)(/|$)", pl) else 2)
            buckets["pkg"].append((prio, depth, p))
        elif base.endswith((".env.example", ".env.sample", ".env.template", "env.example")):
            buckets["env"].append((depth, p))
        elif pl.endswith((".py", ".ts", ".js", ".rs", ".go")) and re.search(r"(^|/)cli/|/cli\.|command", pl):
            buckets["cli"].append((0 if "/cli/" in pl or pl.endswith(("cli.py", "cli.rs", "cli.go")) else 1, depth, p))
        elif re.search(r"constants\.(ts|js|py)$|agent-manager\.ts$", pl):
            if _EDITOR_PATH_RX.search(pl):
                continue
            buckets["consts"].append((0 if "client" in pl or "sdk" in pl else 1, depth, p))
        elif base.endswith((".md", ".rst", ".txt")) and re.search(r"readme|quickstart|getting.?started", base):
            buckets["docs"].append((0 if "quickstart" in base else 1, depth, p))
    caps = {"pkg": MAX_PKG_FILES, "env": 4, "cli": 10, "docs": MAX_DOC_FILES, "consts": 5}
    return {k: [t[-1] for t in sorted(v)[:caps[k]]] for k, v in buckets.items()}


def _candidates(corpus: dict, pick: dict) -> tuple:
    """Deterministic candidates + per-field sources from the fetched corpus."""
    cand = {"dependency_names": [], "cli_bins": [], "cli_bins_raw": [], "cli_verbs": [],
            "cli_cmds": [], "invocations": [], "env_vars": [], "hosts": [], "artifacts": [],
            "dotdirs": [], "key_prefixes": []}
    src: dict = {}

    def note(field, path):
        src.setdefault(field, set()).add(path)

    for p in pick["pkg"]:
        txt = corpus.get(p, "")
        pl = p.lower()
        if pl.endswith("package.json"):
            try:
                d = json.loads(txt)
            except Exception:
                continue
            name = d.get("name", "")
            if name and d.get("private") is not True and _consumer_pkg_name(name):
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
        elif pl.endswith("cargo.toml"):
            pkg = _CARGO_PKG_RX.search(txt)
            if pkg and _consumer_pkg_name(pkg.group(1)):
                cand["dependency_names"].append(pkg.group(1))
                note("dependency_names", p)
            for bm in _CARGO_BIN_RX.finditer(txt):
                cand["cli_bins"].append(bm.group(1))
                cand["cli_bins_raw"].append(bm.group(1))
                note("cli_verbs", p)
        else:                                              # pyproject / setup
            m = _PYPROJ_NAME_RX.search(txt)
            if m and _consumer_pkg_name(m.group(1)):
                cand["dependency_names"].append(m.group(1))
                note("dependency_names", p)
            if "[project.scripts]" in txt:
                seg = txt.split("[project.scripts]", 1)[1][:600]
                for sm in _PYPROJ_SCRIPT_RX.finditer(seg):
                    cand["cli_bins"].append(sm.group(1))
                    cand["cli_bins_raw"].append(sm.group(1))
                    note("cli_verbs", p)

    env_paths = pick["env"] or []
    if env_paths:
        for p in env_paths:
            for v in _ENV_RX.findall(corpus.get(p, "")):
                cand["env_vars"].append(v)
                note("hosted_markers", p)
    else:
        for p in pick["docs"]:
            for m in re.finditer(r"\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\s*=", corpus.get(p, "")):
                cand["env_vars"].append(m.group(1))
                note("hosted_markers", p)

    for p, txt in corpus.items():
        for h in _URL_HOST_RX.findall(txt):
            hl = h.lower()
            if not any(g in hl for g in _GENERIC_HOSTS):
                cand["hosts"].append(hl)
                note("hosted_markers", p)
        for k in _KEYPFX_RX.findall(txt):
            cand["key_prefixes"].append(k)
            note("platform_markers", p)
    for p in pick["env"] + pick["pkg"]:
        for d in _DOTDIR_RX.findall(corpus.get(p, "")):
            if d.lower() not in _GENERIC_DOTDIRS:
                cand["dotdirs"].append(d)
                note("platform_files", p)

    for p, txt in corpus.items():
        for v in _CMD_JS_RX.findall(txt) + _CMD_PY_RX.findall(txt) + _CMD_RS_RX.findall(txt):
            cand["cli_verbs"].append(v)
            note("cli_verbs", p)
        docsish = p.startswith("docs:") or p.startswith("upload:") or p.lower().endswith(
            (".md", ".rst", ".txt", ".html"))
        if docsish:
            known = {re.sub(r"[^a-z0-9-]", "", x.lower())
                     for x in (cand["cli_bins"] + cand["cli_bins_raw"]) if x}
            known = {k for k in known if len(k) >= 3 and k not in _STOP_WORDS} or None
            dep_stems = {re.sub(r"[^a-z0-9-]", "", x.lower())
                         for x in cand["dependency_names"] if x}
            dep_stems = {k for k in dep_stems if len(k) >= 3}
            for phrase in _commands_from_text(txt, whole_is_code=("#code" in p)):
                if not _is_cli_phrase(phrase, known):
                    continue
                cand["cli_cmds"].append(phrase)
                bin_name = phrase.split()[0]
                existing = {b.lower() for b in cand["cli_bins"]}
                if bin_name.lower() in existing or "-" in bin_name:
                    cand["cli_bins_raw"].append(bin_name)
                    cand["cli_bins"].append(bin_name)
                note("cli_verbs", p)
            for imp in _imports_from_text(txt):
                if dep_stems and re.sub(r"[^a-z0-9-]", "", imp.lower()) not in dep_stems:
                    continue
                cand.setdefault("invocations", []).append(f"import {imp}" if " " not in imp else imp)
                note("invocation", p)
            for dep in cand["dependency_names"][:3]:
                stem = re.sub(r"[^a-z0-9-]", "", (dep or "").lower())
                if len(stem) < 3:
                    continue
                for meth in re.findall(rf"\b{re.escape(stem)}\.([a-z][\w]*)\s*\(", txt or "", re.I):
                    if meth.lower() in _GENERIC_CMDS or meth.lower() in _NOT_METHODS:
                        continue
                    cand.setdefault("invocations", []).append(f"{stem}.{meth}")
                    note("invocation", p)

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
    product_pfx = {re.split(r"[^A-Z0-9]+", n.upper())[0]
                   for n in (cand["dependency_names"] + cand["cli_bins"]) if n}
    product_pfx = {p for p in product_pfx if len(p) >= 4}
    if product_pfx and counts:
        matched = {pfx: vs for pfx, vs in counts.items()
                   if pfx in product_pfx or any(pfx.startswith(p[:4]) or p.startswith(pfx) for p in product_pfx)}
        if matched:
            cluster = max(matched.items(), key=lambda kv: len(kv[1]))[1]
    consumer = {v for v in cluster if _CONSUMER_ENV_RX.search(v)}
    cand["env_vars"] = sorted(consumer or cluster)[:8]

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
    cand["dependency_names"] = sorted(
        cand["dependency_names"],
        key=lambda n: (n.rsplit("/", 1)[-1].count("-"), len(n.rsplit("/", 1)[-1]), n),
    )
    if cand["dependency_names"]:
        primary = cand["dependency_names"][0]
        cand["dependency_names"] = [n for n in cand["dependency_names"] if _pkg_alias(primary, n)]
    return cand, {f: sorted(ps) for f, ps in src.items()}


def _http_get(url: str, timeout: int = 45) -> tuple:
    """Plain HTTP fetch for docs pages / registries (never sends the GitHub token)."""
    from urllib import request as _rq
    try:
        req = _rq.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; HackJudge-TargetExtract/1.0)",
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        })
        with _rq.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(1_000_000).decode("utf-8", "replace")
    except Exception as exc:
        return 0, str(exc)


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
    if st != 200 or not body or st == 0:
        detail = f" ({body[:160]})" if body and st != 200 else ""
        return corpus, [f"Docs URL could not be fetched: {url}{detail}"]
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
    github_description = ""

    if repo_url:
        fetched = _fetch(repo_url, gh)
        if fetched:
            owner, repo, paths, raw = fetched[0], fetched[1], fetched[2], fetched[3]
            github_description = fetched[4] if len(fetched) > 4 else ""
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
            epaths, eraw = extra[2], extra[3]
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
    if not (docs_url and any(k.startswith("docs:") for k in corpus)) and cand.get("dependency_names"):
        primary = cand["dependency_names"][0]
        if not package or package.strip().lower() != primary.lower():
            rcorp, rwarns = _registry_corpus(primary)
            if rcorp:
                corpus.update(rcorp)
                for k in rcorp:
                    pick["pkg" if k.endswith((".json", ".toml")) else "docs"].append(k)
                cand, sources = _candidates(corpus, pick)
            warnings.extend(rwarns)
    docs_excerpts = "\n\n".join(
        f"--- {p} ---\n{corpus[p][:2500]}" for p in pick["docs"][:5]) or ""
    return {"repo": " + ".join(label_parts) or "provided sources",
            "candidates": cand, "sources": sources, "corpus": corpus,
            "corpus_lower": "\n".join(corpus.values()).lower(),
            "docs_excerpts": docs_excerpts[:12000], "warnings": warnings,
            "github_description": github_description}


def prepare(url: str, gh, extra_url: str | None = None) -> dict | None:
    """Back-compat wrapper: repo-only extraction."""
    return prepare_sources(gh, repo_url=url, extra_url=extra_url)


_PROMPT = """You are configuring a hackathon-judging tool. From the VENDOR repo material below,
produce the detection signals a judge would use to verify that a CONSUMER project genuinely
used this product. Return ONLY a strict JSON object (start with { and end with }):
{
  "name": "<product name>",
  "dependency_names": "<comma-separated package names a consumer installs>",
  "artifacts": "<comma-separated file globs/conventions consumers commit, e.g. *.pipe>",
  "invocation": "<pipe-separated code patterns consumers write: client classes, key methods, import forms>",
  "hosted_markers": "<comma-separated consumer-side env var names and API hosts>",
  "cli_verbs": "<comma-separated CLI commands incl. binary name, e.g. 'acme start'>",
  "platform_domains": "<comma-separated vendor platform/deploy domains>",
  "platform_files": "<comma-separated config files/dirs the product writes into consumer repos>",
  "platform_markers": "<comma-separated key/id prefixes, e.g. sk_>",
  "suggestions": { "competitors": "<comma-separated, MAY use general knowledge>",
                    "neutral": "<comma-separated commonly co-used neutral tools>" }
}
Rules: every value OUTSIDE "suggestions" must be evidenced by the material below - do not
invent. Prefer consumer-side signals over vendor-internal ones (internal env prefixes, private
workspace packages, ops domains are NOT detection signals). NEVER derive competitors from the
repo itself - a product's integrations are not its rivals; competitors go ONLY in suggestions.
Leave a field as "" if the material shows nothing for it. No em dashes anywhere.

DETERMINISTIC CANDIDATES (pre-extracted, with the same evidence rules):
%%CANDIDATES%%

DOC EXCERPTS:
%%DOCS%%"""


def build_prompt(ctx: dict) -> str:
    # str.replace, not str.format: the format*() family is blocked under RestrictedPython.
    return (_PROMPT.replace("%%CANDIDATES%%", json.dumps(ctx["candidates"], indent=1))
            .replace("%%DOCS%%", ctx["docs_excerpts"] or "(no docs found)"))


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
        if words and all(w in _STOP_WORDS for w in words):
            dropped.append(t)
            continue
        ok = bool(words) and all(w in corpus_lower for w in words)
        (kept if ok else dropped).append(t)
    return sep.join(dict.fromkeys(kept)), dropped


def _fallback_config(cand: dict, ctx: dict | None = None) -> dict:
    """Deterministic-only draft (used when the LLM is unreachable or returns junk)."""
    from collections import Counter
    ctx = ctx or {}
    ranked = sorted(
        Counter(b for b in cand["cli_bins_raw"] if b.lower() not in _STOP_WORDS and b.lower() not in _GENERIC_CMDS).items(),
        key=lambda kv: (-kv[1], len(kv[0])))
    bins = [b for b, _ in ranked] or [b for b in cand["cli_bins"] if b.lower() not in _STOP_WORDS]
    known = {re.sub(r"[^a-z0-9-]", "", x.lower())
             for x in (cand["cli_bins"] + cand["cli_bins_raw"]) if x}
    known = {k for k in known if len(k) >= 3 and k not in _STOP_WORDS} or None
    cmds = [c for c in dict.fromkeys(cand.get("cli_cmds") or []) if _is_cli_phrase(c, known)]
    verbs = cmds[:8] or ([f"{bins[0]} {v}" for v in cand["cli_verbs"][:6] if v.lower() not in _STOP_WORDS] if bins else [])
    verbs = [v for v in verbs if _is_cli_phrase(v, known) or (bins and v.split()[0].lower() == bins[0].lower() and _is_cli_phrase(v))]
    stems = _product_stems(cand, ctx)
    inv = [t for t in dict.fromkeys(cand.get("invocations") or []) if _ok_invocation(t, stems)][:8]
    if not inv:
        inv = [c for c in cmds[:8] if _is_cli_phrase(c, known)]
    hosts = [h for h in cand["hosts"] if _is_platform_host(h)]
    return {
        "name": _display_name(cand, ctx),
        "dependency_names": ", ".join(cand["dependency_names"][:4]),
        "artifacts": ", ".join(cand["artifacts"][:4]),
        "invocation": " | ".join(inv[:8]),
        "hosted_markers": ", ".join(
            cand["env_vars"][:5] + [h for h in cand["hosts"] if h.lower().startswith("api.")][:2]
        ),
        "cli_verbs": ", ".join(verbs[:8]),
        "platform_domains": ", ".join(hosts[:4]),
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
    cfg = parsed or _fallback_config(ctx["candidates"], ctx)
    suggestions = cfg.pop("suggestions", {}) or {}
    warnings = list(ctx["warnings"])
    if not parsed:
        cfg["name"] = cfg.get("name") or _display_name(ctx["candidates"], ctx)

    corpus = ctx["corpus_lower"]
    out = {"types": []}
    seps = {"invocation": " | "}
    for field in ("name", "dependency_names", "artifacts", "invocation", "hosted_markers",
                  "cli_verbs", "platform_domains", "platform_files", "platform_markers"):
        val = str(cfg.get(field, "") or "")
        if field == "name":
            stems = _product_stems(ctx["candidates"], ctx)
            n = val.strip()[:80]
            out[field] = n if _plausible_name(n, stems) else _display_name(ctx["candidates"], ctx)
            continue
        kept, dropped = _verify_field(val, corpus, seps.get(field, ", "))
        if field == "dependency_names":
            toks = [t.strip() for t in kept.split(",") if t.strip() and _consumer_pkg_name(t.strip())]
            if toks:
                primary = toks[0]
                toks = [t for t in toks if _pkg_alias(primary, t)]
            kept = ", ".join(toks)
        if field == "hosted_markers":
            toks = [t.strip() for t in kept.split(",")
                    if t.strip() and t.strip().split("_", 1)[0] not in _GENERIC_ENV_PFX]
            consumer = [t for t in toks if _CONSUMER_ENV_RX.search(t)]
            kept = ", ".join(consumer or toks)
        if field == "platform_domains":
            kept = ", ".join(t.strip() for t in kept.split(",") if t.strip() and _is_platform_host(t.strip()))
        if field == "invocation":
            stems = _product_stems(ctx["candidates"], ctx)
            sep = seps.get(field, " | ")
            toks = [t.strip() for t in re.split(r"\s*\|\s*", kept) if t.strip() and _ok_invocation(t.strip(), stems)]
            kept = sep.join(toks)
        if field == "cli_verbs":
            known = {re.sub(r"[^a-z0-9-]", "", x.lower())
                     for x in (ctx["candidates"].get("cli_bins") or []) + (ctx["candidates"].get("cli_bins_raw") or [])
                     if x}
            known = {k for k in known if len(k) >= 3 and k not in _STOP_WORDS} or None
            toks = [t.strip() for t in kept.split(",") if t.strip() and _is_cli_phrase(t.strip(), known)]
            kept = ", ".join(toks)
        out[field] = kept
        if dropped:
            warnings.append(f"{field}: dropped unverified token(s) {', '.join(dropped[:4])}")

    if out.get("dependency_names") or out.get("invocation"):
        out["types"].append("code")
    if out.get("platform_domains"):
        out["types"].append("platform")
    api_probe = " ".join((out.get("hosted_markers", ""), out.get("invocation", ""),
                          out.get("platform_domains", ""))).lower()
    if "api." in api_probe or "/v1/" in api_probe or "/api/" in api_probe:
        out["types"].append("api")
    if not out["types"]:
        out["types"] = ["code"]
    out["architecture_template"] = infer_architecture_template(out["types"])
    if not parsed and not (out.get("invocation") or out.get("cli_verbs")):
        warnings.append("LLM synthesis unavailable; prefill is deterministic-only "
                        "(invocation patterns need the docs pass).")
    if not cfg.get("competitors"):
        warnings.append("Competitors cannot be derived from the vendor repo "
                        "(its integrations are not rivals) - add them manually.")
    return {"repo": ctx["repo"], "config": out, "sources": ctx["sources"],
            "warnings": warnings,
            "suggestions": {"competitors": str(suggestions.get("competitors", "") or ""),
                            "neutral": str(suggestions.get("neutral", "") or "")}}
