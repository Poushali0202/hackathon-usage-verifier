"""Stage 1 domain tests: UI target config + architecture-template inference. No network."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from extract import (
    infer_architecture_template,
    _candidates,
    _commands_from_text,
    _interesting_files,
    _name_from_title,
    finalize,
)
from target import GENERIC_THRESHOLDS, GENERIC_WEIGHTS, Target


class TestGenericDefaults(unittest.TestCase):
    def test_team_scale_matches_ui_copy(self):
        self.assertEqual(GENERIC_WEIGHTS["dependency"], 1.0)
        self.assertEqual(GENERIC_WEIGHTS["invocation"], 1.5)
        self.assertEqual(GENERIC_WEIGHTS["api_usage"], 1.5)
        self.assertEqual(GENERIC_WEIGHTS["platform_deploy"], 1.5)
        self.assertEqual(GENERIC_THRESHOLDS, {"significant": 4.0, "moderate": 2.0, "less": 1.0})


class TestFromUiConfig(unittest.TestCase):
    def test_literals_not_raw_regex(self):
        t = Target.from_ui_config("LaserData", {
            "types": ["code", "platform", "api"],
            "dependency_names": "laser-sdk, @laserdata/laser-sdk",
            "architecture_template": "data_platform",
        })
        self.assertFalse(t.pipeline_scoring)
        self.assertEqual(t.architecture_template, "data_platform")
        self.assertIn("laser-sdk", t.import_hints)
        self.assertEqual(t.weights["invocation"], GENERIC_WEIGHTS["invocation"])

    def test_company_weights_override_defaults(self):
        t = Target.from_ui_config("Host", {
            "weights": {"platform_deploy": 5, "dependency": 0},
            "thresholds": {"significant": 3},
        })
        self.assertEqual(t.weights["platform_deploy"], 5)
        self.assertEqual(t.weights["dependency"], 0)
        self.assertEqual(t.weights["invocation"], GENERIC_WEIGHTS["invocation"])
        self.assertEqual(t.thresholds["significant"], 3)
        self.assertEqual(t.thresholds["moderate"], GENERIC_THRESHOLDS["moderate"])


class TestArchitectureTemplate(unittest.TestCase):
    def test_types_map(self):
        self.assertEqual(infer_architecture_template(["code"]), "sdk")
        self.assertEqual(infer_architecture_template(["api"]), "api")
        self.assertEqual(infer_architecture_template(["platform"]), "deploy")
        self.assertEqual(infer_architecture_template(["code", "platform"]), "data_platform")
        self.assertEqual(infer_architecture_template(["platform", "api"]), "data_platform")


class TestExtractPrefill(unittest.TestCase):
    def test_name_from_docs_title(self):
        self.assertEqual(_name_from_title("Quick Start - Hotdata Docs"), "Hotdata")
        self.assertEqual(_name_from_title("Hotdata CLI"), "Hotdata")

    def test_commands_skip_package_managers(self):
        text = "```bash\nhotdata auth login\nhotdata query SELECT\nbrew install hotdata-dev/tap/cli\n```"
        cmds = _commands_from_text(text)
        self.assertIn("hotdata auth login", cmds)
        self.assertTrue(any(c.startswith("hotdata query") for c in cmds))
        self.assertFalse(any(c.startswith("brew") for c in cmds))

    def test_interesting_files_include_rust_cli(self):
        pick = _interesting_files(["Cargo.toml", "README.md", "src/cli.rs", "tests/foo.rs"])
        self.assertIn("Cargo.toml", pick["pkg"])
        self.assertIn("README.md", pick["docs"])
        self.assertIn("src/cli.rs", pick["cli"])
        self.assertNotIn("tests/foo.rs", pick["cli"])

    def test_rust_cli_and_docs_fill_name_and_invocation(self):
        cargo = (
            "[package]\nname = \"hotdata-cli\"\n\n[[bin]]\nname = \"hotdata\"\n"
            "path = \"src/main.rs\"\n\n[dependencies]\nhotdata = { version = \"0.17.0\" }\n"
        )
        readme = (
            "<strong>Hotdata CLI</strong>\n\n"
            "https://www.hotdata.dev\n\n```sh\nhotdata manage upgrade\n```\n"
        )
        docs = (
            "Quick Start - Hotdata Docs\n\n"
            "```sh\nhotdata auth login\nhotdata query SELECT\nhotdata databases create\n```\n"
        )
        corpus = {
            "Cargo.toml": cargo,
            "README.md": readme,
            "docs:https://www.hotdata.dev/docs/quick-start": docs,
        }
        pick = {
            "pkg": ["Cargo.toml"], "env": [], "cli": [],
            "docs": ["README.md", "docs:https://www.hotdata.dev/docs/quick-start"],
            "consts": [],
        }
        cand, sources = _candidates(corpus, pick)
        ctx = {
            "repo": "hotdata-dev/hotdata-cli",
            "github_description": "CLI for Hotdata",
            "warnings": [],
            "corpus": corpus,
            "corpus_lower": "\n".join(corpus.values()).lower(),
            "candidates": cand,
            "sources": sources,
        }
        out = finalize(ctx, "")
        cfg = out["config"]
        self.assertEqual(cfg["name"], "Hotdata")
        self.assertIn("hotdata-cli", cfg["dependency_names"])
        self.assertTrue(cfg["invocation"])
        self.assertIn("hotdata", cfg["cli_verbs"].lower())
        self.assertNotIn("name", cfg["cli_verbs"].split(", "))
        self.assertNotIn("clap", cfg["dependency_names"])
        self.assertTrue("hotdata auth" in cfg["cli_verbs"] or "hotdata query" in cfg["invocation"]
                        or "hotdata auth" in cfg["invocation"])
        self.assertFalse(any("LLM synthesis unavailable" in w for w in out["warnings"]))

    def test_docs_prose_is_not_cli_or_editor_env(self):
        prose = (
            "Cognee turns documents into memory. Learn about the graph, "
            "extract-cognify-load pipeline, relationships with an ontology, "
            "routing and on similar nodes.\n"
            "PREFERENCE_DELETE_THRESHOLD PREFERENCE_NODE_SET PREFERENCE_RENDER_HEADER\n"
            "COGNEE_LLM_API_KEY=sk-test\n"
        )
        pkg = '{"name": "cognee", "private": false}'
        corpus = {
            "package.json": pkg,
            "docs:https://docs.cognee.ai/": prose,
        }
        pick = {"pkg": ["package.json"], "env": [], "cli": [],
                "docs": ["docs:https://docs.cognee.ai/"], "consts": []}
        cand, sources = _candidates(corpus, pick)
        ctx = {
            "repo": "topoteretes/cognee",
            "github_description": "AI memory",
            "warnings": [],
            "corpus": corpus,
            "corpus_lower": "\n".join(corpus.values()).lower(),
            "candidates": cand,
            "sources": sources,
        }
        cfg = finalize(ctx, "")["config"]
        cli = (cfg.get("cli_verbs") or "").lower()
        inv = (cfg.get("invocation") or "").lower()
        env = (cfg.get("hosted_markers") or "")
        self.assertNotIn("the graph", cli)
        self.assertNotIn("the graph", inv)
        self.assertNotIn("relationships with an", cli)
        self.assertNotIn("PREFERENCE_DELETE_THRESHOLD", env)
        self.assertIn("cognee", cfg.get("dependency_names", ""))
        self.assertNotIn("PREFERENCE_NODE_SET", env)
        self.assertNotIn("cognee-starter", cfg.get("dependency_names", ""))

    def test_monorepo_workspace_packages_are_not_the_sdk(self):
        corpus = {
            "pyproject.toml": 'name = "cognee"\n',
            "packages/cognee-mcp/package.json": '{"name": "cognee-mcp", "private": false}',
            "cognee-starter/package.json": '{"name": "cognee-starter", "private": false}',
            "evals/comparative-evals/package.json": '{"name": "comparative-evals", "private": false}',
            "cognee-frontend/src/constants.ts": "PREFERENCE_DELETE_THRESHOLD PREFERENCE_RENDER_HEADER\n",
            "README.md": (
                "# Cognee\n\n```python\nimport cognee\nawait cognee.add('x')\n"
                "await cognee.cognify()\nawait cognee.search('q')\n```\n"
                "PREFERENCE_DELETE_THRESHOLD PREFERENCE_NODE_SET\n"
                "COGNEE_LLM_API_KEY=sk-test\n"
            ),
        }
        pick = {
            "pkg": ["pyproject.toml", "packages/cognee-mcp/package.json",
                    "cognee-starter/package.json", "evals/comparative-evals/package.json"],
            "env": [], "cli": [], "docs": ["README.md"],
            "consts": ["cognee-frontend/src/constants.ts"],
        }
        skipped = _interesting_files([
            "pyproject.toml", "README.md", ".env.example", ".env.template",
            "cognee-frontend/src/constants.ts", "cognee-mcp/package.json",
            "cognee-starter-kit/package.json",
        ])
        self.assertIn("pyproject.toml", skipped["pkg"])
        self.assertIn(".env.template", skipped["env"])
        self.assertNotIn("cognee-frontend/src/constants.ts", skipped["consts"])
        self.assertNotIn("cognee-mcp/package.json", skipped["pkg"])
        cand, sources = _candidates(corpus, pick)
        ctx = {
            "repo": "topoteretes/cognee",
            "github_description": "AI memory",
            "warnings": [],
            "corpus": corpus,
            "corpus_lower": "\n".join(corpus.values()).lower(),
            "candidates": cand,
            "sources": sources,
        }
        cfg = finalize(ctx, "")["config"]
        deps = cfg.get("dependency_names", "")
        self.assertTrue(deps.startswith("cognee"))
        self.assertNotIn("cognee-mcp", deps)
        self.assertNotIn("cognee-starter", deps)
        self.assertNotIn("comparative-evals", deps)
        inv = (cfg.get("invocation") or "").lower()
        self.assertTrue("import cognee" in inv or "cognee.add" in inv)
        env = cfg.get("hosted_markers") or ""
        self.assertNotIn("PREFERENCE_DELETE_THRESHOLD", env)
        self.assertIn("COGNEE_LLM_API_KEY", env)
        self.assertNotIn("platform", cfg.get("types") or [])

    def test_readme_badges_domains_and_prose_are_not_product_fields(self):
        readme = (
            "<strong>TIER 1</strong>\n"
            "# Cognee\n\n"
            "https://cognee.ai/ see assets/cognee.svg\n"
            "Cognee turns documents into memory.\n"
            "Cognee에 텍스트 추가\n"
            "```\nCognee에 텍스트 추가\nCognee turns documents into\n"
            "cognee-cli add \"Cognee memory\"\n```\n"
            "```python\nimport cognee\nawait cognee.add('x')\n"
            "await cognee.cognify()\nawait cognee.search('q')\n```\n"
            "```bash\ncognee-cli demo\ncognee-cli -ui\n```\n"
            "COGNEE_ALLOWED_LOCAL_FILE_ROOTS=/tmp\n"
            "COGNEE_API_KEY=sk\n"
            "COGNEE_BASE_URL=https://api.cognee.ai\n"
        )
        corpus = {
            "pyproject.toml": (
                'name = "cognee"\n[project.scripts]\n'
                'cognee-cli = "cognee.cli:main"\n'
            ),
            "README.md": readme,
        }
        pick = {"pkg": ["pyproject.toml"], "env": [], "cli": [],
                "docs": ["README.md"], "consts": []}
        cand, _sources = _candidates(corpus, pick)
        ctx = {
            "repo": "topoteretes/cognee",
            "github_description": "AI memory",
            "warnings": [],
            "corpus": corpus,
            "corpus_lower": "\n".join(corpus.values()).lower(),
            "candidates": cand,
            "sources": _sources,
        }
        cfg = finalize(ctx, "")["config"]
        self.assertEqual(cfg["name"], "Cognee")
        inv = (cfg.get("invocation") or "").lower()
        self.assertIn("import cognee", inv)
        self.assertIn("cognee.add", inv)
        self.assertNotIn("cognee.ai", inv)
        self.assertNotIn("cognee.svg", inv)
        cli = cfg.get("cli_verbs") or ""
        self.assertIn("cognee-cli", cli.lower())
        self.assertNotIn("turns documents", cli.lower())
        self.assertNotIn("텍스트", cli)
        env = cfg.get("hosted_markers") or ""
        self.assertIn("COGNEE_API_KEY", env)
        self.assertNotIn("ALLOWED_LOCAL_FILE_ROOTS", env)
        self.assertNotIn("platform", cfg.get("types") or [])


class TestHydraPipeScan(unittest.TestCase):
    """Custom targets used as RocketRide nodes must score from committed .pipe files."""

    def test_name_derives_node_tokens(self):
        t = Target.from_ui_config("Hydra DB", {"types": ["code", "platform"]})
        self.assertIn("hydradb", t.import_hints)
        self.assertIn("db_hydradb", t.import_hints)
        self.assertFalse(t.pipeline_scoring)

    def test_short_name_does_not_become_a_token(self):
        t = Target.from_ui_config("Host", {})
        self.assertNotIn("host", t.import_hints)
        self.assertNotIn("db_host", t.import_hints)

    def test_pipe_with_db_hydradb_is_not_none(self):
        import json
        import engine as engine_mod

        pipe = json.dumps({
            "components": [
                {"id": "db_1", "provider": "db_hydradb"},
                {"id": "agent_1", "provider": "agent_rocketride"},
            ]
        })
        files = {
            "agent.pipe": pipe,
            "README.md": "# ReviewForge\n",
        }

        def gh(url: str):
            if "/git/trees/" in url:
                tree = [{"path": p, "type": "blob"} for p in files]
                return 200, json.dumps({"tree": tree, "truncated": False})
            if "/languages" in url:
                return 200, "{}"
            if "raw.githubusercontent.com" in url:
                name = url.rsplit("/", 1)[-1]
                return (200, files[name]) if name in files else (404, "")
            if "/repos/" in url:
                return 200, json.dumps({"default_branch": "main", "created_at": "2026-09-01T00:00:00Z"})
            return 404, ""

        tgt = Target.from_ui_config("Hydra DB", {"types": ["code", "platform"]})
        ev = engine_mod._gather_generic("https://github.com/acme/reviewforge", gh, None, None, tgt)
        self.assertTrue(ev.get("accessible"))
        self.assertFalse(ev.get("fetch_incomplete"))
        self.assertTrue(ev.get("dependency"))
        self.assertGreaterEqual(ev["sdk"]["callsites"], 1)
        self.assertTrue(any("agent.pipe" in f for f in (ev.get("platform") or {}).get("files") or []))
        res = engine_mod._evaluate_generic(ev, tgt)
        self.assertNotEqual(res["tag"], "None")
        self.assertGreaterEqual(res["score"], 2.0)
        self.assertEqual(res["scoring"], "generic")


class TestRawProtocolInvocation(unittest.TestCase):
    """A committed pipeline run over raw HTTP/WebSocket (no SDK) counts as called,
    and a renamed GitHub repo resolves instead of failing (OverlappAd / LemonGraph,
    2026-10-19 demo-pack false negatives)."""

    def test_env_post_to_task_counts_as_called(self):
        import engine as engine_mod
        srcs = [{
            "path": "pipeline/deploy.sh",
            "text": 'TEMPLATE="$HERE/castgraph-match.template.json"\n'
                    'curl -s -X POST "$ROCKETRIDE_URI/task" --data-binary @"$BODY"\n',
        }]
        called, sites = engine_mod.pipe_called("pipeline/castgraph-match.template.json", srcs)
        self.assertTrue(called)
        self.assertTrue(sites)

    def test_hosted_websocket_counts_cross_file(self):
        import engine as engine_mod
        srcs = [
            {"path": "app/find_creators.js",
             "text": 'const RR_WS = "wss://api.rocketride.ai/task/service";\n'},
            {"path": "app/config.js", "text": 'const PIPE = "match.pipe";\n'},
        ]
        called, _sites = engine_mod.pipe_called("pipeline/match.pipe", srcs)
        self.assertTrue(called)

    def test_health_checks_and_bare_env_do_not_count(self):
        import engine as engine_mod
        srcs = [{
            "path": "scripts/check.sh",
            "text": 'PIPE="match.pipe"\ncurl -fsS "$ROCKETRIDE_URI/version"\n'
                    'echo "$ROCKETRIDE_APIKEY"\ncurl "$ROCKETRIDE_URI/services"\n',
        }]
        called, _sites = engine_mod.pipe_called("pipeline/match.pipe", srcs)
        self.assertFalse(called)

    def test_follow_repo_redirect_resolves_rename(self):
        import json
        import engine as engine_mod

        def gh(url: str):
            if url.endswith("/repos/inthree3/LemonGraph"):
                return 301, json.dumps({"message": "Moved Permanently",
                                        "url": "https://api.github.com/repositories/1292663362"})
            if url.endswith("/repositories/1292663362"):
                return 200, json.dumps({"full_name": "inthree3/MoatGraph",
                                        "default_branch": "main"})
            return 404, ""

        st, body, owner, repo = engine_mod.follow_repo_redirect(gh, "inthree3", "LemonGraph")
        self.assertEqual(st, 200)
        self.assertEqual((owner, repo), ("inthree3", "MoatGraph"))
        self.assertIn("MoatGraph", body)

    def test_follow_repo_redirect_falls_back_on_empty_body(self):
        import engine as engine_mod
        st, _body, owner, repo = engine_mod.follow_repo_redirect(
            lambda url: (301, ""), "a", "b")
        self.assertEqual(st, 301)
        self.assertEqual((owner, repo), ("a", "b"))


class TestDetNoteArrow(unittest.TestCase):
    """QA D4: the judge-facing note uses the Unicode arrow, matching the UI's scoringSummary."""

    def test_pipeline_and_generic_notes_use_unicode_arrow(self):
        import engine as engine_mod
        base = {"score": 4.5, "tag": "Significant", "backbone": "Yes",
                "pipelines_called": 1, "pipelines_total": 1, "history_penalty": 2.0}
        pipe_note = engine_mod.det_note(base)
        generic_note = engine_mod.det_note({**base, "scoring": "generic", "breakdown": []})
        for note in (pipe_note, generic_note):
            self.assertIn("4.5 → Significant", note)
            self.assertNotIn("->", note)


class TestFirstCommitDate(unittest.TestCase):
    """QA D7: the 'work goes back to' date must be the TRUE first commit even when the history is
    longer than one API page (zod, ~3250 commits, was reported as 2026-08-29 instead of 2020-03-07;
    p-map at 106 commits is the smallest reproduction). The evaluator never sees headers and the
    replay driver allows only a few fetch rounds, so the engine asks for `<list>&page=last`, a
    marker the fetch layers resolve from page 1's Link header in one extra request."""

    @staticmethod
    def _repo(n_commits: int, start: str, path_shas=None, fail_until=False):
        """A fake GitHub commits endpoint: one commit per day from `start`, newest first, honouring
        per_page / page / path the way the real API does, plus the fetch layer's `&page=last`."""
        import json
        from datetime import date, timedelta
        from urllib.parse import parse_qs, urlparse

        d0 = date.fromisoformat(start)
        commits = []
        for i in range(n_commits):
            d = (d0 + timedelta(days=i)).isoformat() + "T12:00:00Z"
            commits.append({"sha": f"{i:07x}", "commit": {"author": {"date": d}, "committer": {"date": d}}})
        calls = [0]

        def gh(url: str):
            calls[0] += 1
            q = parse_qs(urlparse(url).query)
            lst = commits
            if "path" in q and path_shas is not None:
                lst = [c for c in commits if int(c["sha"], 16) in path_shas]
            newest_first = list(reversed(lst))
            per = int(q.get("per_page", ["30"])[0])
            page = q.get("page", ["1"])[0]
            if page == "last":
                if fail_until:
                    return 500, ""
                page = str(max(1, -(-len(newest_first) // per)))
            start = (int(page) - 1) * per
            return 200, json.dumps(newest_first[start:start + per])

        return gh, calls

    def _page(self, gh, path=""):
        import json
        extra = f"&path={path}" if path else ""
        st, body = gh(f"https://api.github.com/repos/a/b/commits?per_page=100{extra}")
        self.assertEqual(st, 200)
        return json.loads(body)

    def test_short_history_is_exact_without_extra_calls(self):
        import engine as engine_mod
        gh, calls = self._repo(38, "2026-08-03")
        page = self._page(gh)
        calls[0] = 0
        self.assertEqual(engine_mod.first_commit_date(gh, "a", "b", page), ("2026-08-03T12:00:00Z", True))
        self.assertEqual(calls[0], 0)

    def test_long_history_finds_the_true_first_commit(self):
        import engine as engine_mod
        gh, calls = self._repo(3250, "2017-06-10")           # zod-sized
        page = self._page(gh)
        self.assertEqual(len(page), 100)
        self.assertEqual(page[-1]["commit"]["committer"]["date"][:10], "2026-01-24")  # the old, wrong answer
        calls[0] = 0
        self.assertEqual(engine_mod.first_commit_date(gh, "a", "b", page), ("2017-06-10T12:00:00Z", True))
        self.assertEqual(calls[0], 1)        # one `page=last` request, so one extra replay round at most

    def test_just_over_one_page(self):
        import engine as engine_mod
        gh, _calls = self._repo(106, "2016-10-21")           # p-map-sized
        page = self._page(gh)
        self.assertEqual(engine_mod.first_commit_date(gh, "a", "b", page), ("2016-10-21T12:00:00Z", True))

    def test_per_path_history(self):
        import engine as engine_mod
        gh, calls = self._repo(3250, "2017-06-10", path_shas={5, 200, 3000})
        page = self._page(gh, "agent.pipe")
        self.assertEqual(engine_mod.first_commit_date(gh, "a", "b", page, "agent.pipe"),
                         ("2017-06-15T12:00:00Z", True))
        # a path with more than one page of its own history resolves through page=last as well
        gh, calls = self._repo(3250, "2017-06-10", path_shas=set(range(3250)))
        page = self._page(gh, "agent.pipe")
        calls[0] = 0
        self.assertEqual(engine_mod.first_commit_date(gh, "a", "b", page, "agent.pipe"),
                         ("2017-06-10T12:00:00Z", True))
        self.assertEqual(calls[0], 1)

    def test_api_failure_falls_back_to_the_page_and_says_so(self):
        import engine as engine_mod
        gh, _calls = self._repo(3250, "2017-06-10", fail_until=True)
        page = self._page(gh)
        got = engine_mod.first_commit_date(gh, "a", "b", page)
        self.assertEqual(got, ("2026-01-24T12:00:00Z", False))

    def test_det_note_says_at_least_when_not_exact(self):
        import engine as engine_mod
        base = {"score": 2.5, "tag": "Moderate", "backbone": "Yes", "pipelines": [], "sdk": {},
                "pipelines_called": 1, "pipelines_total": 1,
                "event_window": {"start": "2026-09-08", "end": "2026-09-12", "event": "2026-09-10"},
                "project_predates": {"date": "2026-08-03T00:00:00Z", "sha": "abc1234"},
                "earliest_commit": "2026-01-24T12:00:00Z", "history_penalty": 2}
        self.assertIn("work goes back to at least 2026-01-24",
                      engine_mod.det_note({**base, "earliest_commit_exact": False}))
        self.assertIn("work goes back to 2026-01-24",
                      engine_mod.det_note({**base, "earliest_commit_exact": True}))


class TestPrefillNameAndPlatform(unittest.TestCase):
    """QA T3 (prefill named Cognee after a docs heading) and T5 (Cognee typed as a platform because
    its docs mention a cloud console hostname)."""

    @staticmethod
    def _ctx(corpus, pick, repo):
        cand, sources = _candidates(corpus, pick)
        return {
            "repo": repo,
            "github_description": "",
            "warnings": [],
            "corpus": corpus,
            "corpus_lower": "\n".join(corpus.values()).lower(),
            "candidates": cand,
            "sources": sources,
        }

    def test_docs_heading_sentence_collapses_to_the_product_name(self):
        self.assertEqual(_name_from_title("Build AI Memory with Cognee - Cognee Documentation"), "Cognee")
        self.assertEqual(_name_from_title("Cognee Documentation"), "Cognee")
        corpus = {
            "pyproject.toml": 'name = "cognee"\n',
            "README.md": "# Build AI Memory with Cognee\n\n```python\nimport cognee\nawait cognee.add('x')\n```\n",
            "docs:https://docs.cognee.ai": "<html><head><title>Build AI Memory with Cognee - Cognee Documentation"
                                           "</title></head><body><h1>Build AI Memory with Cognee</h1></body></html>",
        }
        pick = {"pkg": ["pyproject.toml"], "env": [], "cli": [],
                "docs": ["README.md", "docs:https://docs.cognee.ai"], "consts": []}
        cfg = finalize(self._ctx(corpus, pick, "topoteretes/cognee"), "")["config"]
        self.assertEqual(cfg["name"], "Cognee")

    def test_cloud_console_hostname_alone_is_not_a_platform(self):
        corpus = {
            "pyproject.toml": 'name = "cognee"\n',
            "README.md": ("# Cognee\n\n```python\nimport cognee\nawait cognee.add('x')\n```\n"
                          "Sign in at https://cloud.cognee.ai then set\n"
                          "COGNEE_CLOUD_API_URL=https://api.cognee.ai\nCOGNEE_CLOUD_AUTH_TOKEN=x\n"),
        }
        pick = {"pkg": ["pyproject.toml"], "env": [], "cli": [], "docs": ["README.md"], "consts": []}
        cfg = finalize(self._ctx(corpus, pick, "topoteretes/cognee"), "")["config"]
        self.assertIn("cloud.cognee.ai", cfg.get("platform_domains") or "")
        self.assertIn("code", cfg["types"])
        self.assertNotIn("platform", cfg["types"])
        self.assertNotEqual(cfg["architecture_template"], "data_platform")

    def test_platform_needs_a_footprint_in_consumer_repos(self):
        corpus = {
            "pyproject.toml": 'name = "butterbase"\n',
            "README.md": ("# Butterbase\n\n```python\nimport butterbase\nclient = butterbase.create_client()\n```\n"
                          "Console: https://cloud.butterbase.ai\n"),
            "src/keys.py": 'if not key.startswith("bb_"):\n    raise ValueError("bad key")\n',
        }
        pick = {"pkg": ["pyproject.toml"], "env": [], "cli": [], "docs": ["README.md"], "consts": ["src/keys.py"]}
        cfg = finalize(self._ctx(corpus, pick, "butterbase-ai/butterbase"), "")["config"]
        self.assertIn("bb_", cfg.get("platform_markers") or "")
        self.assertIn("platform", cfg["types"])


class TestExplainPromptAttribution(unittest.TestCase):
    """QA H2: attribution is never model prose, so no prompt may ask the model for team members."""

    def test_prompt_never_asks_for_team_members(self):
        import engine
        self.assertNotIn("team_members", engine.EXPLAIN_PROMPT)
        evaluation = {"tag": "None", "backbone": "No", "score": 0, "pipelines": [], "platform": None}
        prompt = engine.explain_prompt(evaluation, "P", "o/r", "",
                                       "# Proj. Built by Alice and Bob", "RocketRide")
        self.assertNotIn("team_members", prompt)
        self.assertIn("README EXCERPT (for project_name / description only)", prompt)

    def test_batch_runner_does_not_copy_prose_names(self):
        src = (Path(__file__).resolve().parent.parent / "run_batch.py").read_text(encoding="utf-8")
        self.assertNotIn('prose["team_members"]', src)
        self.assertNotIn("prose.get(\"team_members\")", src)


if __name__ == "__main__":
    unittest.main()
