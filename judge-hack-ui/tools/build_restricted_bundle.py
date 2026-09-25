#!/usr/bin/env python3
"""Flatten the Python evaluator into ONE RestrictedPython-compatible script.

The catalog `tool_python` node runs code through RestrictedPython (see
rocketride-server/packages/ai/src/ai/common/sandbox.py). That policy forbids a
handful of constructs the evaluator sources use freely, so this script rewrites
the AST instead of forking the algorithm:

  * identifiers starting with "_"        -> prefixed "hj_"
  * @dataclass Target (AnnAssign body)    -> collections.namedtuple + module ctors
  * other annotated assignments           -> plain assignments
  * `d[k] += v` / `o.a += v`              -> `d[k] = d[k] + v`
  * `from target import ...` etc.         -> dropped (single flat namespace)
  * `rb.parse_repo` / `rb.OTHER_PLATFORMS` -> flat names from the fetch shim
  * `load_preset()`                       -> inlined preset JSON

Source of truth stays Projects/hackathon-usage-verifier/eval/*.py. Invoked by
tools/gen-evaluator-bundle.mjs; prints the flat script to stdout.
"""
from __future__ import annotations

import ast
import copy
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
APP_ROOT = HERE.parent
EVAL_ROOT = APP_ROOT.parent.parent / "Projects" / "hackathon-usage-verifier" / "eval"
VERIFY_ROOT = APP_ROOT / "src" / "verify"

PREFIX = "hj_"
# urllib/html are imported once, guarded, by the fetch shim (the sandbox may forbid them);
# the evaluator modules' own imports of them are dropped and resolved from the flat namespace.
DROP_MODULES = {"__future__", "pathlib", "target", "engine", "run_batch", "os", "sys", "urllib", "html"}


def rn(name: str | None) -> str | None:
    if not name or name == "_":
        return name
    if name.startswith("__") and name.endswith("__"):
        return name
    if name.startswith("_"):
        stripped = name.lstrip("_")
        return PREFIX + stripped if stripped else "hj_unused"
    return name


def _load(node: ast.expr) -> ast.expr:
    node = copy.deepcopy(node)
    for sub in ast.walk(node):
        if isinstance(sub, (ast.Name, ast.Subscript, ast.Attribute, ast.Tuple, ast.List)):
            sub.ctx = ast.Load()
    return node


def _field_default(value: ast.expr | None) -> ast.expr:
    """Default expression for one dataclass field, as a plain value."""
    if value is None:
        return ast.Constant("")
    if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "field":
        for kw in value.keywords:
            if kw.arg == "default_factory":
                f = kw.value
                if isinstance(f, ast.Lambda):
                    return f.body
                if isinstance(f, ast.Name) and f.id == "dict":
                    return ast.Dict(keys=[], values=[])
                if isinstance(f, ast.Name) and f.id == "list":
                    return ast.List(elts=[], ctx=ast.Load())
                return ast.Call(func=f, args=[], keywords=[])
            if kw.arg == "default":
                return kw.value
        return ast.Constant(None)
    return value


def top_level_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, ast.Assign):
            names.update(t.id for t in n.targets if isinstance(t, ast.Name))
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
            names.add(n.target.id)
    return names


class Restrict(ast.NodeTransformer):
    def __init__(self, local_renames: dict[str, str] | None = None) -> None:
        super().__init__()
        self.in_target_ctor = False
        # module-private renames for top-level names that collide with an earlier module
        self.local = local_renames or {}

    # ---- identifiers -------------------------------------------------------
    def visit_Name(self, node: ast.Name):
        if self.in_target_ctor and node.id == "cls":
            return ast.copy_location(ast.Name(id="Target", ctx=node.ctx), node)
        node.id = rn(self.local.get(node.id, node.id))
        return node

    def visit_arg(self, node: ast.arg):
        node.arg = rn(node.arg)
        node.annotation = None
        return node

    def visit_keyword(self, node: ast.keyword):
        node.arg = rn(node.arg)
        self.generic_visit(node)
        return node

    def visit_ExceptHandler(self, node: ast.ExceptHandler):
        node.name = rn(node.name)
        self.generic_visit(node)
        return node

    def visit_Global(self, node: ast.Global):
        node.names = [rn(n) for n in node.names]
        return node

    def visit_alias(self, node: ast.alias):
        node.asname = rn(node.asname)
        return node

    def visit_FunctionDef(self, node: ast.FunctionDef):
        if node.name == "load_preset":
            return None
        node.name = rn(self.local.get(node.name, node.name))
        node.returns = None
        self.generic_visit(node)
        return node

    def visit_Attribute(self, node: ast.Attribute):
        if isinstance(node.value, ast.Name):
            if node.value.id == "rb":
                return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
            if node.value.id == "Target" and node.attr in ("from_preset", "from_ui_config"):
                return ast.copy_location(ast.Name(id="target_" + node.attr, ctx=node.ctx), node)
        self.generic_visit(node)
        node.attr = rn(node.attr)
        return node

    # ---- statements --------------------------------------------------------
    def visit_AnnAssign(self, node: ast.AnnAssign):
        if node.value is None:
            return None
        new = ast.Assign(targets=[node.target], value=node.value)
        ast.copy_location(new, node)
        new.lineno = node.lineno
        return self.visit(new)

    def visit_AugAssign(self, node: ast.AugAssign):
        if isinstance(node.target, (ast.Subscript, ast.Attribute)):
            new = ast.Assign(
                targets=[node.target],
                value=ast.BinOp(left=_load(node.target), op=node.op, right=node.value),
            )
            ast.copy_location(new, node)
            return self.visit(new)
        self.generic_visit(node)
        return node

    def visit_ImportFrom(self, node: ast.ImportFrom):
        if (node.module or "").split(".")[0] in DROP_MODULES:
            return None
        self.generic_visit(node)
        return node

    def visit_Import(self, node: ast.Import):
        node.names = [a for a in node.names if a.name.split(".")[0] not in DROP_MODULES]
        if not node.names:
            return None
        self.generic_visit(node)
        return node

    def visit_Assign(self, node: ast.Assign):
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            tid = node.targets[0].id
            if tid == "_TARGETS_DIR":
                return None
            if tid == "ROCKETRIDE" and isinstance(node.value, ast.Call) \
                    and isinstance(node.value.func, ast.Name) and node.value.func.id == "load_preset":
                node.value = ast.parse("target_from_preset(json.loads(PRESET_JSON))").body[0].value
        self.generic_visit(node)
        return node

    def visit_ClassDef(self, node: ast.ClassDef):
        if node.name != "Target":
            node.decorator_list = []
            self.generic_visit(node)
            return node
        fields: list[str] = []
        defaults: list[ast.expr] = []
        ctors: list[ast.FunctionDef] = []
        for item in node.body:
            if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                fields.append(item.target.id)
                defaults.append(_field_default(item.value))
            elif isinstance(item, ast.FunctionDef):
                ctors.append(item)
        nt = ast.parse("Target = namedtuple('Target', [], defaults=[])").body[0]
        nt.value.args[1] = ast.List(elts=[ast.Constant(f) for f in fields], ctx=ast.Load())
        nt.value.keywords[0].value = ast.List(elts=defaults, ctx=ast.Load())
        out: list[ast.stmt] = [nt]
        for fn in ctors:
            fn.decorator_list = []
            fn.name = "target_" + fn.name
            fn.args.args = fn.args.args[1:]  # drop cls
            self.in_target_ctor = True
            fn = self.visit_FunctionDef(fn)
            self.in_target_ctor = False
            out.append(fn)
        return out


def transform(src: str, filename: str, seen: set[str]) -> str:
    """Rewrite one module. `seen` accumulates top-level names already defined by earlier
    modules so a later module's same-named definition is renamed <module>_<name> (the
    modules share one flat namespace after bundling)."""
    tree = ast.parse(src, filename=filename)
    stem = pathlib.Path(filename).stem
    imported = {a.name for n in tree.body if isinstance(n, ast.ImportFrom) for a in n.names}
    own = top_level_names(tree)
    local = {n: f"{stem}_{n}" for n in own if n in seen and n not in imported}
    seen.update(own - set(local))
    tree = Restrict(local).visit(tree)
    ast.fix_missing_locations(tree)
    return ast.unparse(tree)


def pystr(value: str) -> str:
    """JSON string literals are valid Python string literals."""
    return json.dumps(value, ensure_ascii=True)


def build() -> str:
    preset = (EVAL_ROOT / "targets" / "rocketride.json").read_text(encoding="utf-8")
    seen: set[str] = set()

    def module(name: str) -> str:
        return transform((EVAL_ROOT / name).read_text(encoding="utf-8"), name, seen)

    parts = [
        "# Generated by tools/build_restricted_bundle.py - do not edit. Flat, RestrictedPython-safe",
        "# evaluator: target.py + fetch shim + engine.py + extract.py + drivers.",
        "import json",
        "import re",
        "import time",
        "from collections import namedtuple",
        "",
        "PRESET_JSON = " + pystr(preset),
        "",
        module("target.py"),
        "",
        (VERIFY_ROOT / "restricted_shim.py").read_text(encoding="utf-8"),
        "",
        module("engine.py"),
        "",
        module("extract.py"),
        "",
        (VERIFY_ROOT / "restricted_drivers.py").read_text(encoding="utf-8"),
        "",
    ]
    return "\n".join(parts)


if __name__ == "__main__":
    text = build()
    if len(sys.argv) > 1 and sys.argv[1] != "-":
        pathlib.Path(sys.argv[1]).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
