"""Renderer fixtures are intentionally invented, not last-generation rules."""

import copy
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

from diagram import render_svg


def fixture():
    return {
        "units": "mm",
        "points": {
            "heel": {"x": 0, "y": 0, "kind": "landmark"},
            "toe": {"x": -5, "y": 260, "kind": "landmark"},
            "medial_rear_handle": {"x": -50, "y": 30, "kind": "handle"},
            "medial_front_handle": {"x": -55, "y": 250, "kind": "handle"},
            "lateral_front_handle": {"x": 55, "y": 250, "kind": "handle"},
            "lateral_rear_handle": {"x": 45, "y": 20, "kind": "handle"},
            "reference_front": {"x": 0, "y": 240, "kind": "reference"},
        },
        "curves": {
            "medial_outline": {"start": "heel", "control1": "medial_rear_handle", "control2": "medial_front_handle", "end": "toe"},
            "lateral_outline": {"start": "toe", "control1": "lateral_front_handle", "control2": "lateral_rear_handle", "end": "heel"},
        },
        "reference_lines": {"longitudinal_reference": {"start": "heel", "end": "reference_front"}},
        "outline": ["medial_outline", "lateral_outline"],
    }


NS = {"s": "http://www.w3.org/2000/svg"}


class DiagramTests(unittest.TestCase):
    def test_deterministic_without_mutation(self):
        model = fixture()
        before = copy.deepcopy(model)
        self.assertEqual(render_svg(model), render_svg(model))
        reverse = {**model, "points": dict(reversed(list(model["points"].items())))}
        self.assertEqual(render_svg(model), render_svg(reverse))
        self.assertEqual(model, before)

    def test_clean_and_diagnostic_preserve_path(self):
        clean = ET.fromstring(render_svg(fixture(), False))
        diagnostic = ET.fromstring(render_svg(fixture()))
        a = clean.find('.//s:path[@id="outline"]', NS)
        b = diagnostic.find('.//s:path[@id="outline"]', NS)
        assert a is not None and b is not None
        self.assertEqual(a.attrib["d"], b.attrib["d"])
        self.assertTrue(a.attrib["d"].endswith(" Z"))
        self.assertEqual(a.attrib["stroke"], "none")
        self.assertEqual(len(clean.findall('.//s:path', NS)), 1)
        self.assertEqual(len(clean.findall('.//s:circle', NS)), 0)
        self.assertTrue(clean.attrib["width"].endswith("mm"))
        group = clean.find('.//s:g', NS)
        assert group is not None
        self.assertIn("scale(1 -1)", group.attrib["transform"])

    def test_all_construction_has_unique_names_and_legend(self):
        model = fixture()
        root = ET.fromstring(render_svg(model))
        ids = [e.attrib["id"] for e in root.iter() if "id" in e.attrib]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(sum(i.startswith("curve-") for i in ids), len(model["curves"]))
        self.assertEqual(sum(i.startswith("connector-") for i in ids), 3 * len(model["curves"]))
        self.assertEqual(sum(i.startswith("reference-") and not i.startswith("reference-label-") for i in ids), 1)
        text = " ".join(root.itertext())
        for name in (*model["points"], *model["curves"], *model["reference_lines"]):
            self.assertIn(name, text)
        for curve in model["curves"]:
            for suffix in ("start_to_control1", "control1_to_control2", "control2_to_end"):
                self.assertIn(curve + "." + suffix, text)

    def test_xml_escaping_and_safe_ids(self):
        model = fixture()
        name = 'medial <outline> & "choice"'
        model["curves"][name] = model["curves"].pop("medial_outline")
        model["outline"][0] = name
        svg = render_svg(model)
        root = ET.fromstring(svg)
        self.assertIn(name, " ".join(root.itertext()))
        self.assertIn("&lt;outline&gt; &amp;", svg)

    def test_semantic_dimensions_are_keyed_and_diagnostic_only(self):
        model = fixture()
        model["dimensions"] = {
            "length": {"kind": "length", "expected": 260, "start_y": 0,
                       "end_y": 260, "reference_line": "longitudinal_reference"},
            "medial_ball_half_width": {"kind": "side_extent", "expected": 42.5,
                                       "station_y": 170, "reference_line": "longitudinal_reference"},
        }
        svg = render_svg(model)
        self.assertIn("R01  Length: 260 mm (y=0 to 260 mm)", svg)
        self.assertIn("R01  Medial ball side extent: 42.5 mm at y=170 mm", svg)
        self.assertIn("entered targets, not fit checks", svg)
        self.assertNotIn("42.5 mm", render_svg(model, False))

    def test_text_and_callouts_inside_page(self):
        model = fixture()
        # Many coincident points stress callout spacing without altering the curve.
        for i in range(40):
            model["points"][f"extra_reference_{i:02d}"] = {"x": 0, "y": 0, "kind": "reference"}
        root = ET.fromstring(render_svg(model))
        _, _, width, height = map(float, root.attrib["viewBox"].split())
        for e in root.findall("s:text", NS):
            x, y = float(e.attrib["x"]), float(e.attrib["y"])
            self.assertGreaterEqual(x, 20)
            self.assertLess(x, width - 20)
            self.assertGreaterEqual(y, 20)
            self.assertLess(y, height - 20)
            if e.attrib.get("font-family") == "monospace":
                self.assertLess(x + len(e.text or "") * 7.3, width - 20)

    def test_invalid_units_and_nonfinite_coordinates(self):
        model = fixture()
        model["units"] = "cm"
        with self.assertRaises(ValueError):
            render_svg(model)
        model = fixture()
        model["points"]["heel"]["x"] = float("nan")
        with self.assertRaises(ValueError):
            render_svg(model)

    def test_ten_curve_baseline_legend_and_bounds(self):
        from last_shape import build_model
        inputs = json.loads((Path(__file__).resolve().parents[1] / "examples" / "baseline.json").read_text())
        model = build_model(inputs)
        root = ET.fromstring(render_svg(model))
        clean = ET.fromstring(render_svg(model, False))
        diagnostic_path = root.find('.//s:path[@id="outline"]', NS)
        clean_path = clean.find('.//s:path[@id="outline"]', NS)
        assert diagnostic_path is not None and clean_path is not None
        self.assertEqual(diagnostic_path.get("d"), clean_path.get("d"))
        self.assertEqual(len(root.findall('.//s:circle', NS)), len(model["points"]))
        _, _, width, height = map(float, root.attrib["viewBox"].split())
        self.assertLess(height, 1300)
        text = " ".join(root.itertext())
        for name in (*model["points"], *model["curves"], *model["reference_lines"]):
            self.assertIn(name, text)
        for e in root.findall("s:text", NS):
            x, y = float(e.attrib["x"]), float(e.attrib["y"])
            self.assertTrue(0 < x < width and 0 < y < height - 20)
            if e.get("font-family") == "monospace":
                self.assertLess(x + len(e.text or "") * 7.3, width - 20)
        self.assertEqual(sum(e.get("id", "").startswith("reference-label-")
                              for e in root.findall("s:text", NS)), 9)


if __name__ == "__main__":
    unittest.main()
