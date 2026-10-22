import copy
import math
import unittest
import xml.etree.ElementTree as ET

from bottom_diagram import render_bottom_svg, render_bottom_comparison

NS = {"s": "http://www.w3.org/2000/svg"}


def fixture():
    """Representative published-spec fixture only; not production model generation."""
    m = -math.tan(math.radians(2))
    k = 10/(75-10/2)
    points = {}
    for name, y, z, kind in (("bottom_heel_rear", 0, 8, "landmark"),
                              ("bottom_seat_front", 50, 8+m*50, "landmark"),
                              ("bottom_forepart_contact", 175, 0, "landmark"),
                              ("bottom_forepart_blend_end", 185, k*10/2, "landmark"),
                              ("bottom_forepart_blend_ground_end", 185, 0, "reference"),
                              ("bottom_toe_end", 250, 10, "landmark"),
                              ("bottom_heel_ground", 0, 0, "reference"),
                              ("bottom_toe_ground", 250, 0, "reference"),
                              ("bottom_seat_horizontal_front", 50, 8, "reference")):
        points[name] = dict(y=y, z=z, kind=kind)
    curves = {}
    for name, a, b, u, v in (("bottom_heel_seat", "bottom_heel_rear", "bottom_seat_front", m, m),
                              ("bottom_waist", "bottom_seat_front", "bottom_forepart_contact", m, 0),
                              ("bottom_forepart_blend", "bottom_forepart_contact", "bottom_forepart_blend_end", 0, k),
                              ("bottom_forepart_ramp", "bottom_forepart_blend_end", "bottom_toe_end", k, k)):
        p, q = points[a], points[b]
        h = q["y"]-p["y"]
        c1, c2 = name+"_handle_start", name+"_handle_end"
        points[c1] = dict(y=p["y"]+h/3, z=p["z"]+u*h/3, kind="handle")
        points[c2] = dict(y=q["y"]-h/3, z=q["z"]-v*h/3, kind="handle")
        curves[name] = dict(start=a, control1=c1, control2=c2, end=b)
    refs = {}
    for name, a, b in (("bottom_ground_projected_length", "bottom_heel_ground", "bottom_toe_ground"),
                       ("bottom_heel_height", "bottom_heel_ground", "bottom_heel_rear"),
                       ("bottom_toe_spring", "bottom_toe_ground", "bottom_toe_end"),
                       ("bottom_seat_horizontal", "bottom_heel_rear", "bottom_seat_horizontal_front"),
                       ("bottom_seat_chord", "bottom_heel_rear", "bottom_seat_front"),
                       ("bottom_contact_forward", "bottom_heel_ground", "bottom_forepart_contact"),
                       ("bottom_forepart_blend_projection", "bottom_forepart_contact", "bottom_forepart_blend_ground_end")):
        refs[name] = dict(start=a, end=b)
    dimensions = {}
    for name, value, unit, ref in (("projected_length", 250, "mm", "bottom_ground_projected_length"),
                                  ("heel_height", 8, "mm", "bottom_heel_height"),
                                  ("toe_spring", 10, "mm", "bottom_toe_spring"),
                                  ("seat_projected_length", 50, "mm", "bottom_seat_horizontal"),
                                  ("seat_inclination_deg", 2, "deg", "bottom_seat_chord"),
                                  ("contact_forward", 175, "mm", "bottom_contact_forward"),
                                  ("forepart_blend_length", 10, "mm", "bottom_forepart_blend_projection")):
        dimensions[name] = dict(expected=value, units=unit, reference_line=ref, definition=name)
    return dict(schema_version=2, kind="bottom_profile", units="mm", axes=["y", "z"], closed=False,
                points=points, curves=curves, profile=list(curves), reference_lines=refs, dimensions=dimensions)


class BottomDiagramTests(unittest.TestCase):
    def test_deterministic_unchanged_geometry_and_open_path(self):
        model = fixture()
        before = copy.deepcopy(model)
        self.assertEqual(render_bottom_svg(model), render_bottom_svg(model))
        clean, diagnostic = [ET.fromstring(render_bottom_svg(model, d)) for d in (False, True)]
        a = clean.find('.//s:path[@id="bottom-profile"]', NS)
        b = diagnostic.find('.//s:path[@id="bottom-profile"]', NS)
        assert a is not None and b is not None
        self.assertEqual(a.attrib["d"], b.attrib["d"])
        self.assertNotIn("Z", a.attrib["d"])
        self.assertEqual(a.attrib["d"].count("C "), 4)
        self.assertEqual(a.get("fill"), "none")
        self.assertIn("16.6666666667", a.attrib["d"])
        self.assertEqual(clean.find("s:g", NS).get("transform"), diagnostic.find("s:g", NS).get("transform"))
        self.assertIn("scale(3 -3)", clean.find("s:g", NS).get("transform"))
        self.assertTrue(clean.attrib["width"].endswith("mm"))
        self.assertEqual(model, before)

    def test_exhaustive_names_and_unique_ids(self):
        model = fixture()
        root = ET.fromstring(render_bottom_svg(model))
        ids = [e.attrib["id"] for e in root.iter() if "id" in e.attrib]
        self.assertEqual(len(ids), len(set(ids)))
        text = " ".join(root.itertext())
        for name in (*model["points"], *model["curves"], *model["reference_lines"], *model["dimensions"]):
            self.assertIn(name, text)
        for name in model["curves"]:
            for suffix in ("start_to_handle_start", "handle_start_to_handle_end", "handle_end_to_end"):
                self.assertIn(name+"_"+suffix, text)
        self.assertEqual(len(root.findall('.//s:circle', NS)), 17)
        self.assertEqual(sum(e.get("id", "").startswith("connector-") for e in root.iter()), 12)

    def test_bad_models_rejected(self):
        model = fixture()
        model["schema_version"] = 1
        with self.assertRaisesRegex(ValueError, "requires schema_version 2"):
            render_bottom_svg(model)
        for key, value in (("units", "cm"), ("axes", ["z", "y"]), ("closed", True)):
            model = fixture()
            model[key] = value
            with self.assertRaises(ValueError):
                render_bottom_svg(model)
        model = fixture()
        model["points"]["bottom_heel_rear"]["z"] = math.nan
        with self.assertRaises(ValueError):
            render_bottom_svg(model)
        model = fixture()
        model["profile"].reverse()
        with self.assertRaises(ValueError):
            render_bottom_svg(model)

    def test_xml_escaping_and_label_bounds(self):
        model = fixture()
        model["dimensions"]['label <unsafe> & "quoted"'] = model["dimensions"]["heel_height"]
        root = ET.fromstring(render_bottom_svg(model))
        self.assertIn('label <unsafe> & "quoted"', " ".join(root.itertext()))
        _, _, width, height = map(float, root.attrib["viewBox"].split())
        for text in root.findall("s:text", NS):
            x, y = float(text.attrib["x"]), float(text.attrib["y"])
            self.assertTrue(15 < x < width-15 and 15 < y < height-15)
            if text.get("font-family") == "monospace":
                self.assertLess(x+len(text.text or "")*7.3, width-15)

    def test_coincident_points_and_zero_references_keep_names(self):
        model = fixture()
        for point in model["points"].values():
            point["z"] = 0
        root = ET.fromstring(render_bottom_svg(model))
        self.assertEqual(len(root.findall('.//s:circle', NS)), 17)
        self.assertEqual(sum(e.get("id", "").startswith("reference-") for e in root.iter()), 7)

    def test_comparison_uses_identical_axis_scale_and_path(self):
        model = fixture()
        variants = [dict(name="test <one>", label="Heel & height", change={"field": "heel_height", "from": 8, "to": 12}, model=model)]
        root = ET.fromstring(render_bottom_comparison(model, variants))
        group = root.find("s:g", NS)
        assert group is not None
        self.assertIn("scale(3 -3)", group.attrib["transform"])
        paths = group.findall("s:path", NS)
        self.assertEqual(paths[1].get("d"), paths[2].get("d"))
        self.assertIn("Heel & height", " ".join(root.itertext()))


if __name__ == "__main__":
    unittest.main()
