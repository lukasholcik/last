import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

from compare_variants import generate_comparisons
from diagram import render_svg
from last_shape import build_model

ROOT = Path(__file__).resolve().parents[1]
NS = {"s": "http://www.w3.org/2000/svg"}


class VariantTests(unittest.TestCase):
    def run_cli(self, output, variants):
        return subprocess.run(
            [sys.executable, str(ROOT / "compare_variants.py"),
             "--baseline", str(ROOT / "examples/baseline.json"),
             "--variants", str(variants), "--output-dir", str(output)],
            capture_output=True, text=True, cwd=ROOT, timeout=30)

    def seed_success(self, output):
        result = self.run_cli(output, ROOT / "examples/variants.json")
        self.assertEqual(result.returncode, 0, result.stderr)
        audit = json.loads((output / "comparison-report.json").read_text())
        self.assertTrue(audit["baseline_passed"])
        self.assertTrue(all(v["passed"] for v in audit["variants"]))

    def test_cli_bad_json_invalidates_previous_success(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            output = folder / "output"
            self.seed_success(output)
            bad = folder / "bad.json"
            bad.write_text("{")
            result = self.run_cli(output, bad)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Comparison generation failed:", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertFalse((output / "comparison-report.json").exists())

    def test_cli_missing_input_invalidates_previous_success(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            output = folder / "output"
            self.seed_success(output)
            result = self.run_cli(output, folder / "missing.json")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Comparison generation failed:", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertFalse((output / "comparison-report.json").exists())

    def test_cli_report_directory_warns_and_preserves_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            self.seed_success(output)
            report = output / "comparison-report.json"
            report.unlink()
            report.mkdir()
            marker = report / "keep.txt"
            marker.write_text("keep")
            unrelated = output / "unrelated.txt"
            unrelated.write_text("keep too")
            result = self.run_cli(output, ROOT / "examples/variants.json")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("existing report may be stale", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(marker.read_text(), "keep")
            self.assertEqual(unrelated.read_text(), "keep too")

    def test_direct_numeric_failure_invalidates_previous_success(self):
        inputs = json.loads((ROOT / "examples/baseline.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            self.seed_success(output)
            with self.assertRaises(ValueError):
                generate_comparisons(inputs, [{"name": "bad", "input": "length", "value": -1}], output)
            self.assertFalse((output / "comparison-report.json").exists())

    def test_variants_dimensions_dependency_and_shared_scale(self):
        inputs = json.loads((ROOT / "examples/baseline.json").read_text())
        specs = json.loads((ROOT / "examples/variants.json").read_text())["variants"]
        before = json.dumps(inputs, sort_keys=True)
        with tempfile.TemporaryDirectory() as directory:
            audit = generate_comparisons(inputs, specs, directory)
            output = Path(directory)
            svg = ET.fromstring((output / "comparison.svg").read_text())
            groups = svg.findall("s:g", NS)
            self.assertEqual(len(groups), 4)
            self.assertEqual({g.get("data-scale-px-per-mm") for g in groups}, {"2.1"})
            baseline = build_model(inputs)
            clean = ET.fromstring(render_svg(baseline, False))
            baseline_path = clean.find('.//s:path[@id="outline"]', NS)
            assert baseline_path is not None
            for group, entry in zip(groups, audit["variants"]):
                self.assertTrue(entry["passed"])
                self.assertLessEqual(entry["max_dimension_error_mm"], .1)
                self.assertEqual(len(entry["dimension_checks"]), 9)
                self.assertEqual(set(entry["changed_curves"]) | set(entry["identical_curves"]), set(baseline["outline"]))
                self.assertTrue(entry["identical_curves"])
                saved = json.loads((output / entry["name"] / "input.json").read_text())
                changes = [k for k,v in saved["design"].items() if v != inputs["design"][k]]
                self.assertEqual(changes, [entry["input_change"]["name"]])
                for path in group.findall("s:path", NS):
                    if path.get("id", "").startswith("baseline-"):
                        self.assertEqual(path.get("d"), baseline_path.get("d"))
            toe = next(e for e in audit["variants"] if e["name"] == "narrower_medial_toe")
            self.assertIn("lateral_toe_to_toe_tip", toe["changed_curves"])
            self.assertIn("heel_tip_to_lateral_heel", toe["identical_curves"])
            lateral_changes = {"lateral_heel_to_lateral_waist", "lateral_waist_to_lateral_ball",
                               "lateral_ball_to_lateral_toe", "lateral_toe_to_toe_tip"}
            for entry in audit["variants"]:
                if entry["input_change"]["name"] == "lateral_ball_width":
                    self.assertEqual(set(entry["changed_curves"]), lateral_changes)
                    self.assertEqual(max(entry["max_control_displacement_mm"].values()), 6)
            self.assertEqual(set(toe["changed_curves"]), {"lateral_toe_to_toe_tip", "toe_tip_to_medial_toe",
                                                       "medial_toe_to_medial_ball"})
            self.assertEqual(json.dumps(inputs, sort_keys=True), before)


if __name__ == "__main__":
    unittest.main()
