"""Stage 1 domain tests: UI target config + architecture-template inference. No network."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract import infer_architecture_template
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


if __name__ == "__main__":
    unittest.main()
