"""Build the self-contained engine bundle that runs INSIDE a RocketRide tool_python node
(M7 point 1). The bundle is assembled at runtime FROM THE REAL SOURCE FILES (target.py,
engine.py, run_batch.py) so the in-node engine can never drift from the in-process one -
the same functions, extracted textually, executed in the node sandbox.

Sandbox constraints handled here:
  - no filesystem, no repo imports -> everything inlined, `import run_batch as rb`
    rewritten to a shim built from the extracted parse_repo/OTHER_PLATFORMS
  - `from __future__ import annotations` is illegal mid-exec -> stripped (the code is
    3.10+ compatible without it)
  - only whitelisted modules -> bundle imports just json/re/datetime/dataclasses/urllib

The generic (custom-target) path is bundled. The RocketRide preset path stays in-process
by design - it is the fallback engine anyway.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _extract(src: str, anchor: str) -> str:
    """Grab a top-level block: from the line starting with `anchor` up to the next
    column-0 statement. Works for consts and defs alike (bodies are indented)."""
    lines = src.splitlines(keepends=True)
    start = next(i for i, ln in enumerate(lines) if ln.startswith(anchor))
    out = [lines[start]]
    for ln in lines[start + 1:]:
        if ln[:1] not in ("", " ", "\t", ")", "]", "}", "\n") and not ln.startswith(("#",)):
            break
        # a new top-level def/const also ends the block
        if re.match(r"[A-Za-z_@]", ln[:1] or ""):
            break
        out.append(ln)
    return "".join(out).rstrip() + "\n"


def build_bundle() -> str:
    target_src = (HERE / "target.py").read_text(encoding="utf-8")
    engine_src = (HERE / "engine.py").read_text(encoding="utf-8")
    rb_src = (HERE.parent / "run_batch.py").read_text(encoding="utf-8")

    # target.py minus filesystem bits (preset loader) and future import
    t = target_src
    t = t.replace("from __future__ import annotations\n", "")
    t = t.replace("from pathlib import Path\n", "")
    t = re.sub(r"_TARGETS_DIR = .*\n", "", t)
    t = t.split("def load_preset")[0]

    # engine pieces the generic path needs
    pieces = [_extract(engine_src, a) for a in (
        "EVENT_GRACE_DAYS", "DEFAULT_HISTORY_PENALTY", "_MANIFEST", "_SRC_EXT",
        "_TECH_EXT", "_TECH_FRAMEWORKS",
        "def event_window", "def history_tamper_scan", "def detect_tech",
        "def _gh_languages",
    )]

    # the whole target-agnostic generic section (gather + evaluate)
    marker = "# ---------------------------------------------------------------- target-agnostic generic path"
    generic = engine_src.split(marker, 1)[1]
    generic = generic.replace("import run_batch as rb\n", "rb = _RB\n")

    # rb shim from the real run_batch source
    rb_parse = _extract(rb_src, "def parse_repo")
    rb_others = _extract(rb_src, "OTHER_PLATFORMS")

    return "\n".join([
        "import json",
        "import re",
        "",
        rb_parse,
        rb_others,
        "class _RBNS:",
        "    parse_repo = staticmethod(parse_repo)",
        "    OTHER_PLATFORMS = OTHER_PLATFORMS",
        "_RB = _RBNS()",
        "",
        *pieces,
        "",
        t,
        "",
        "# " + marker.lstrip("# "),
        generic,
        "",
        "def run_verify(repo_url, target_cfg, gh, event_date=None, history_penalty=None):",
        "    t = Target.from_ui_config(str(target_cfg.get('name') or 'Target'), target_cfg)",
        "    ev = _gather_generic(repo_url, gh, event_date, history_penalty, t)",
        "    if not ev.get('accessible'):",
        "        return {'error': 'repo inaccessible', 'status': ev.get('status'), 'note': ev.get('note')}",
        "    res = _evaluate_generic(ev, t)",
        "    res['readme_title'] = ev.get('readme_title', '')",
        "    res['engine'] = 'rocketride-node'",
        "    return res",
        "",
    ])


def bundle_sha(bundle: str) -> str:
    return hashlib.sha256(bundle.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    b = build_bundle()
    print(f"bundle: {len(b)} chars, sha256 {bundle_sha(b)[:16]}...")
    ns: dict = {}
    exec(b, ns)  # compile check outside the sandbox
    print("exec OK; run_verify:", callable(ns.get("run_verify")))
