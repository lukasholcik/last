import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.input = self.folder / "input.json"
        self.output = self.folder / "output"
        self.baseline = json.loads((ROOT / "examples/baseline.json").read_text())

    def run_cli(self, inputs):
        self.input.write_text(json.dumps(inputs))
        return subprocess.run(
            [sys.executable, str(ROOT / "generate.py"), "--input", str(self.input),
             "--output-dir", str(self.output)],
            capture_output=True, text=True, cwd=ROOT, timeout=30)

    def generate_baseline(self):
        result = self.run_cli(self.baseline)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads((self.output / "report.json").read_text())["passed"])

    def test_output_directory_conflict_invalidates_old_success_first(self):
        self.generate_baseline()
        silhouette = self.output / "silhouette.svg"
        silhouette.unlink()
        silhouette.mkdir()
        marker = silhouette / "keep.txt"
        marker.write_text("keep")
        unrelated = self.output / "unrelated.txt"
        unrelated.write_text("keep")
        result = self.run_cli({})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Generation failed:", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertFalse((self.output / "report.json").exists())
        self.assertEqual(marker.read_text(), "keep")
        self.assertEqual(unrelated.read_text(), "keep")

    def test_report_directory_conflict_warns_and_preserves_contents(self):
        self.generate_baseline()
        report = self.output / "report.json"
        report.unlink()
        report.mkdir()
        marker = report / "keep.json"
        marker.write_text('{"passed": true}')
        result = self.run_cli({})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("existing report may be stale", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(marker.read_text(), '{"passed": true}')
        self.assertTrue((self.output / "silhouette.svg").is_file())

    def test_oversized_integer_is_readable_failure(self):
        self.baseline["design"]["length"] = 10**400
        result = self.run_cli(self.baseline)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("length must be finite and between", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertFalse((self.output / "report.json").exists())


if __name__ == "__main__":
    unittest.main()
