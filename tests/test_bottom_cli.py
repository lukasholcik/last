import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from bottom_profile import bottom_curve_points, build_bottom_model, validate_bottom_model
from generate_bottom import generate_bottom

ROOT = Path(__file__).resolve().parents[1]


class BottomCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.output = self.folder/"output"
        self.top = json.loads((ROOT/"examples/baseline.json").read_text())
        self.bottom = json.loads((ROOT/"examples/bottom-baseline.json").read_text())
        self.specs = json.loads((ROOT/"examples/bottom-variants.json").read_text())["variants"]
        self.top_path,self.bottom_path,self.variants_path = [self.folder/n for n in ("top.json","bottom.json","variants.json")]
        self.top_path.write_text(json.dumps(self.top))
        self.bottom_path.write_text(json.dumps(self.bottom))
        self.variants_path.write_text(json.dumps(dict(variants=self.specs)))

    def run_cli(self,variants=False,input_path=None):
        command = [sys.executable,str(ROOT/"generate_bottom.py"),"--top-input",str(self.top_path),
                   "--input",str(input_path or self.bottom_path),"--output-dir",str(self.output)]
        if variants:
            command += ["--variants",str(self.variants_path)]
        return subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=30)

    def seed_success(self,variants=False):
        result = self.run_cli(variants)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(json.loads((self.output/"baseline/report.json").read_text())["passed"])

    def test_baseline_only(self):
        self.seed_success()
        for name in ("clean.svg","diagram.svg","model.json","report.json"):
            self.assertTrue((self.output/"baseline"/name).is_file())
        self.assertFalse((self.output/"comparison-report.json").exists())
        self.assertEqual(self.top_path.read_text(),json.dumps(self.top))

    def test_variants_dimensions_and_actual_curve_audit(self):
        self.seed_success(True)
        baseline = json.loads((self.output/"baseline/model.json").read_text())
        audit = json.loads((self.output/"comparison-report.json").read_text())
        self.assertTrue(audit["passed"])
        self.assertEqual(len(audit["variants"]),6)
        for spec,entry in zip(self.specs,audit["variants"]):
            folder = self.output/spec["name"]
            inputs = json.loads((folder/"input.json").read_text())
            self.assertEqual([k for k in inputs["design"] if inputs["design"][k]!=self.bottom["design"][k]],[spec["input"]])
            model = json.loads((folder/"model.json").read_text())
            self.assertTrue(validate_bottom_model(model,self.top,inputs)["passed"])
            changed = [n for n in baseline["profile"] if bottom_curve_points(baseline,n)!=bottom_curve_points(model,n)]
            self.assertEqual(entry["changed_curves"],changed)
            self.assertEqual(entry["identical_curves"],[n for n in baseline["profile"] if n not in changed])
        self.assertTrue((self.output/"comparison.svg").is_file())

    def test_parse_missing_and_numeric_failures_clear_success(self):
        for failure in ("parse","missing","numeric","variants_parse"):
            with self.subTest(failure=failure):
                self.bottom_path.write_text(json.dumps(self.bottom))
                self.variants_path.write_text(json.dumps(dict(variants=self.specs)))
                self.seed_success(True)
                source = self.bottom_path
                if failure=="parse":
                    source.write_text("{")
                elif failure=="missing":
                    source = self.folder/"missing.json"
                elif failure=="numeric":
                    bad = copy.deepcopy(self.bottom)
                    bad["design"]["heel_height"] = 10**400
                    source.write_text(json.dumps(bad))
                else:
                    self.variants_path.write_text("{")
                result = self.run_cli(True,source)
                self.assertNotEqual(result.returncode,0)
                self.assertIn("Bottom generation failed:",result.stderr)
                self.assertNotIn("Traceback",result.stderr)
                self.assertFalse((self.output/"comparison-report.json").exists())
                self.assertFalse((self.output/"baseline/report.json").exists())
                for spec in self.specs:
                    self.assertFalse((self.output/spec["name"]/"report.json").exists())

    def test_output_conflict_clears_reports_without_recursive_deletion(self):
        self.seed_success(True)
        conflict = self.output/"baseline/clean.svg"
        conflict.unlink()
        conflict.mkdir()
        marker = conflict/"keep.txt"
        marker.write_text("keep")
        unrelated = self.output/"keep.txt"
        unrelated.write_text("keep too")
        result = self.run_cli(True)
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn("Traceback",result.stderr)
        self.assertFalse((self.output/"baseline/report.json").exists())
        self.assertFalse((self.output/"comparison-report.json").exists())
        self.assertEqual(marker.read_text(),"keep")
        self.assertEqual(unrelated.read_text(),"keep too")

    def test_invalid_variant_configurations_clear_previous_success(self):
        for configuration in (dict(variants=None),{},dict(variants=[]),[],None):
            with self.subTest(configuration=configuration):
                self.variants_path.write_text(json.dumps(dict(variants=self.specs)))
                self.seed_success(True)
                self.variants_path.write_text(json.dumps(configuration))
                result = self.run_cli(True)
                self.assertNotEqual(result.returncode,0)
                self.assertIn("nonempty variants list",result.stderr)
                self.assertNotIn("Traceback",result.stderr)
                self.assertFalse((self.output/"comparison-report.json").exists())
                self.assertFalse((self.output/"baseline/report.json").exists())
                for spec in self.specs:
                    self.assertFalse((self.output/spec["name"]/"report.json").exists())

    def test_old_bottom_version_rejected_without_stale_success(self):
        self.seed_success(True)
        old = copy.deepcopy(self.bottom)
        old["schema_version"] = 1
        del old["design"]["forepart_blend_length"]
        self.bottom_path.write_text(json.dumps(old))
        result = self.run_cli(True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn("regenerate v1 data",result.stderr)
        self.assertIn("forepart_blend_length=10",result.stderr)
        self.assertNotIn("Traceback",result.stderr)
        self.assertFalse((self.output/"comparison-report.json").exists())
        self.assertFalse((self.output/"baseline/report.json").exists())

    def test_report_directory_conflicts_warn_and_preserve(self):
        for relative in ("comparison-report.json","baseline/report.json"):
            with self.subTest(relative=relative),tempfile.TemporaryDirectory() as directory:
                self.output = Path(directory)/"output"
                self.seed_success(True)
                report = self.output/relative
                report.unlink()
                report.mkdir()
                marker = report/"keep.txt"
                marker.write_text("keep")
                result = self.run_cli(True)
                self.assertNotEqual(result.returncode,0)
                self.assertIn("existing report may be stale",result.stderr)
                self.assertNotIn("Traceback",result.stderr)
                self.assertEqual(marker.read_text(),"keep")

    def test_protect_input_inside_output(self):
        self.output.mkdir()
        source = self.output/"comparison-report.json"
        source.write_text(json.dumps(self.bottom))
        before = source.read_text()
        result = self.run_cli(input_path=source)
        self.assertNotEqual(result.returncode,0)
        self.assertIn("input paths must be outside",result.stderr)
        self.assertEqual(source.read_text(),before)

    def test_direct_call_invalidates_on_rejected_variant_and_keeps_inputs(self):
        self.seed_success(True)
        before = copy.deepcopy((self.top,self.bottom))
        with self.assertRaises(ValueError):
            generate_bottom(self.top,self.bottom,self.output,[dict(name="bad",input="toe_spring",value=-1)])
        self.assertFalse((self.output/"comparison-report.json").exists())
        self.assertEqual((self.top,self.bottom),before)
        for spec in (dict(name="../bad",input="toe_spring",value=11),
                     dict(name="bad",input="projected_length",value=260),
                     dict(name="unchanged",input="toe_spring",value=10)):
            with self.assertRaises(ValueError):
                generate_bottom(self.top,self.bottom,self.output,[spec])


if __name__ == "__main__":
    unittest.main()
