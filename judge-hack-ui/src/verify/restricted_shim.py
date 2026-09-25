# Fetch shim for the tool_python evaluator (RestrictedPython-safe: no leading-underscore names,
# no os/sys/subprocess, nothing on disk). Every byte of a repository comes from the GitHub
# REST API / raw.githubusercontent.com; there is no git clone anywhere in this path.
#
# Two fetch modes, chosen at run time:
#   direct  - urllib is importable in this engine's sandbox: fetch here with the judge's token.
#   replay  - urllib is not allowed (staging today): the app fetches over the catalog
#             tool_http_request node and hands the bodies in as CACHE; any URL the evaluator
#             asks for that is not cached is reported back as `missing` and the app re-runs.
#             Selection of what to fetch stays 100% in the evaluator - the app never decides.
OTHER_PLATFORMS = ["butterbase", "supabase", "xtrace", "photon", "langchain",
                   "crewai", "firebase", "pinecone", "weaviate"]
UA = "hackjudge-python-v1"
GITHUB_HOSTS = ("api.github.com", "raw.githubusercontent.com")
RETRY_STATUSES = (429, 500, 502, 503)

try:
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    from urllib.parse import quote, urljoin, urlparse
    HAVE_URLLIB = True
except ImportError:
    HAVE_URLLIB = False

try:
    from html import unescape as html_unescape
    HAVE_HTML = True
except ImportError:
    HAVE_HTML = False

SAFE_URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~/"
UrlParts = namedtuple("UrlParts", ["scheme", "netloc", "path", "params", "query", "fragment"])
HTML_ENTITIES = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ",
                 "#39": "'", "#x27": "'", "#x2F": "/", "#47": "/", "ndash": "-", "mdash": "-",
                 "hellip": "...", "copy": "(c)", "reg": "(R)", "trade": "(TM)", "laquo": "<<",
                 "raquo": ">>", "lsquo": "'", "rsquo": "'", "ldquo": '"', "rdquo": '"'}

if not HAVE_URLLIB:
    def quote(text, safe="/"):
        out = []
        for ch in str(text):
            if ch in SAFE_URL_CHARS or ch in safe:
                out.append(ch)
            else:
                for b in ch.encode("utf-8"):
                    out.append("%%%02X" % b)
        return "".join(out)

    def urlparse(url):
        m = re.match(r"^(?:([a-zA-Z][a-zA-Z0-9+.-]*):)?(?://([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$", str(url or ""))
        if not m:
            return UrlParts("", "", str(url or ""), "", "", "")
        return UrlParts(m.group(1) or "", m.group(2) or "", m.group(3) or "", "", m.group(4) or "", m.group(5) or "")

    def urljoin(base, href):
        href = str(href or "")
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", href):
            return href
        b = urlparse(base)
        origin = "%s://%s" % (b.scheme, b.netloc)
        if href.startswith("//"):
            return "%s:%s" % (b.scheme, href)
        if href.startswith("/"):
            return origin + href
        base_dir = b.path.rsplit("/", 1)[0] + "/" if "/" in b.path else "/"
        return origin + base_dir + href

if not HAVE_HTML:
    def html_unescape(text):
        def repl(m):
            name = m.group(1)
            if name in HTML_ENTITIES:
                return HTML_ENTITIES[name]
            if name.startswith("#x") or name.startswith("#X"):
                try:
                    return chr(int(name[2:], 16))
                except ValueError:
                    return m.group(0)
            if name.startswith("#"):
                try:
                    return chr(int(name[1:]))
                except ValueError:
                    return m.group(0)
            return m.group(0)
        return re.sub(r"&(#?[xX]?[0-9A-Za-z]+);", repl, str(text or ""))


def parse_repo(url):
    m = re.search(r"github\.com[/:]+([^/\s]+)/([^/\s#?]+)", url or "", re.I)
    return (m.group(1), m.group(2).removesuffix(".git")) if m else None


def make_gh(token):
    """Direct mode: get(url) -> (status, body). Status 0 means the request never completed."""
    tok = (token or "").strip()

    def get(url):
        headers = {"User-Agent": UA, "Accept": "application/vnd.github+json"}
        if tok and any(h in url for h in GITHUB_HOSTS):
            headers["Authorization"] = "Bearer " + tok
        attempt = 0
        while attempt < 3:
            try:
                with urlopen(Request(url, headers=headers), timeout=45) as r:
                    return r.status, r.read().decode("utf-8", "replace")
            except HTTPError as e:
                body = ""
                try:
                    body = e.read().decode("utf-8", "replace")
                except Exception:
                    body = ""
                if e.code in RETRY_STATUSES and attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    attempt = attempt + 1
                    continue
                return e.code, body
            except Exception as e:
                if attempt < 2:
                    time.sleep(1.0)
                    attempt = attempt + 1
                    continue
                return 0, str(e)
        return 0, ""

    return get


def make_cache_gh(cache, missing):
    """Replay mode: serve (status, body) from `cache` {url: [status, body]}; record misses.
    A miss answers status 0 so the evaluator's own fail-closed paths run unchanged; the
    driver turns any recorded miss into a `need_fetch` reply instead of a verdict."""
    def get(url):
        hit = cache.get(url)
        if hit is None:
            if url not in missing:
                missing.append(url)
            return 0, ""
        return int(hit[0]), str(hit[1] or "")

    return get
