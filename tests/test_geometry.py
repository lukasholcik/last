import copy
import json
import math
from pathlib import Path
import unittest

from last_shape import (bezier, build_model, curve_bounds, curve_points,
                        section_extent, section_roots, segments_intersect, validate_model)


class GeometryTests(unittest.TestCase):
    def setUp(self):
        self.inputs = json.loads((Path(__file__).resolve().parents[1] / "examples/baseline.json").read_text())

    def test_known_cubic(self):
        ps = [(0,0), (0,4), (4,4), (4,0)]
        self.assertEqual(bezier(ps, 0.5), (2,3))
        self.assertEqual(curve_bounds(ps, 1), (0,3))
        roots = section_roots(ps, 2.25)
        self.assertEqual(len(roots), 2)
        self.assertAlmostEqual(roots[0], 0.25)
        self.assertAlmostEqual(roots[1], 0.75)

    def test_linear_and_tangent_roots(self):
        self.assertAlmostEqual(section_roots([(0,0),(1,1),(2,2),(3,3)], 1.5)[0], 0.5)
        self.assertEqual(section_roots([(0,0),(0,4),(4,4),(4,0)], 3), [0.5])

    def test_baseline_and_names(self):
        model = build_model(self.inputs)
        report = validate_model(model, self.inputs)
        self.assertTrue(report["passed"], report)
        self.assertEqual(model, build_model(self.inputs))
        self.assertEqual(model["dimensions"]["medial_ball_half_width"]["station_y"], 175)
        self.assertEqual(model["dimensions"]["length"]["expected"], 250)
        json.dumps(model, allow_nan=False)
        for curve in model["curves"].values():
            self.assertTrue(all(name in model["points"] for name in curve.values()))
        self.assertTrue(all(p["kind"] in ("landmark", "handle", "reference") for p in model["points"].values()))
        lo, hi = section_extent(model, 175)
        self.assertAlmostEqual(lo, -46)
        self.assertGreater(hi-lo, 46)
        self.assertNotAlmostEqual(hi-lo, 46+48, places=3)

    def test_closure_and_exact_first_derivative_joins(self):
        model = build_model(self.inputs)
        curves = [curve_points(model, name) for name in model["outline"]]
        for a,b in zip(curves, curves[1:] + curves[:1]):
            self.assertEqual(a[-1], b[0])
            for axis in (0,1):
                self.assertAlmostEqual(a[3][axis]-a[2][axis], b[1][axis]-b[0][axis])

    def test_nonextremal_landmarks_follow_neighbouring_widths(self):
        model = build_model(self.inputs)
        # Both toe stations lie on a narrowing contour, not a width extremum.
        for side in ("medial", "lateral"):
            name = f"{side}_toe"
            c = next(c for c in model["curves"].values() if c["start"] == name)
            p, h = model["points"][name], model["points"][c["control1"]]
            self.assertGreater(abs(h["x"] - p["x"]), 1)
            # Slope of positive side extent with respect to forward y is negative.
            sign = -1 if side == "medial" else 1
            self.assertLess(sign * (h["x"] - p["x"]) / (h["y"] - p["y"]), 0)
        # Actual width maxima still have a vertical tangent.
        c = model["curves"]["lateral_ball_to_lateral_toe"]
        self.assertEqual(model["points"][c["control1"]]["x"], 48)

    def test_curve_extrema_do_not_overshoot_neighbouring_widths(self):
        variations = [copy.deepcopy(self.inputs) for _ in range(4)]
        variations[1]["design"]["lateral_ball_width"] += 5
        variations[2]["design"]["medial_toe_y"] -= 8
        variations[3]["design"]["lateral_heel_width"] = 34
        for inputs in variations:
            model = build_model(inputs)
            self.assertTrue(validate_model(model, inputs)["passed"])
            for name in model["outline"]:
                ps = curve_points(model, name)
                lo, hi = curve_bounds(ps, 0)
                self.assertGreaterEqual(lo, min(ps[0][0], ps[-1][0]) - 1e-9)
                self.assertLessEqual(hi, max(ps[0][0], ps[-1][0]) + 1e-9)

    def test_caps_have_longer_horizontal_handles_without_moving_tips(self):
        model = build_model(self.inputs)
        for tip, region in (("heel_tip", "heel"), ("toe_tip", "toe")):
            c = next(c for c in model["curves"].values() if c["start"] == tip)
            p, h = model["points"][tip], model["points"][c["control1"]]
            width = min(self.inputs["design"][f"{s}_{region}_width"] for s in ("medial", "lateral"))
            self.assertAlmostEqual(abs(h["x"] - p["x"]), width / 2)
            self.assertEqual(h["y"], p["y"])

    def test_validator_rejects_width_overshoot(self):
        model = build_model(self.inputs)
        c = model["curves"]["lateral_ball_to_lateral_toe"]
        model["points"][c["control1"]]["x"] = 60
        checks = validate_model(model, self.inputs)["checks"]
        check = next(c for c in checks if c["name"] == "lateral_ball_to_lateral_toe_width_monotonicity")
        self.assertFalse(check["passed"])

    def test_validation_uses_curves_not_echoed_design(self):
        model = build_model(self.inputs)
        model["design"]["length"] = 1
        self.assertTrue(validate_model(model, self.inputs)["passed"])
        # Change a handle, not a landmark: force a true cubic longitudinal overshoot.
        name = model["curves"][model["outline"][4]]["control1"]
        model["points"][name]["y"] = 1000
        report = validate_model(model, self.inputs)
        self.assertFalse(report["passed"])
        toe = next(c for c in report["checks"] if c["name"] == "toe_y")
        self.assertGreater(toe["actual"], 250)

    def test_section_validation_detects_changed_curve_width(self):
        model = build_model(self.inputs)
        # Move only a medial handle across the lateral ball section. The true
        # section must notice this extra intersection, despite unchanged landmarks.
        name = model["curves"][model["outline"][7]]["control1"]
        model["points"][name]["x"] += 500
        report = validate_model(model, self.inputs)
        self.assertFalse(report["passed"])
        self.assertTrue(any(not c["passed"] for c in report["checks"] if "half_width" in c["name"]))

    def test_modest_variations(self):
        for scale in (0.8, 1, 1.2):
            inputs = copy.deepcopy(self.inputs)
            inputs["design"] = {k: v*scale for k,v in inputs["design"].items()}
            inputs["design"]["medial_ball_y"] += 4
            inputs["design"]["lateral_ball_width"] += 5
            self.assertTrue(validate_model(build_model(inputs), inputs)["passed"])

    def test_invalid_inputs(self):
        for value in (math.nan, math.inf, -math.inf, 0, -1, True, "250", 10**400):
            inputs = copy.deepcopy(self.inputs)
            inputs["design"]["length"] = value
            with self.assertRaises(ValueError):
                build_model(inputs)
        for field,value in (("medial_ball_y", 90), ("lateral_toe_y", 250), ("medial_heel_width", 0)):
            inputs = copy.deepcopy(self.inputs)
            inputs["design"][field] = value
            with self.assertRaises(ValueError):
                build_model(inputs)
        inputs = copy.deepcopy(self.inputs)
        inputs["design"]["extra"] = 3
        with self.assertRaises(ValueError):
            build_model(inputs)
        for key,value in (("schema_version", True), ("schema_version", 2), ("units", "cm"), ("design", {})):
            inputs = copy.deepcopy(self.inputs)
            inputs[key] = value
            with self.assertRaises(ValueError):
                build_model(inputs)

    def test_nonfinite_result_rejected(self):
        model = build_model(self.inputs)
        model["points"]["toe_tip"]["x"] = math.nan
        with self.assertRaisesRegex(ValueError, "finite"):
            validate_model(model, self.inputs)

    def test_minimum_gap_boundary(self):
        inputs = copy.deepcopy(self.inputs)
        inputs["design"]["medial_toe_y"] = 175.01
        build_model(inputs)
        for y in (175.009999, 175, 174.99):
            inputs["design"]["medial_toe_y"] = y
            with self.assertRaisesRegex(ValueError, "0.01 mm gaps"):
                build_model(inputs)

    def test_disconnected_and_nonsmooth_result_fail(self):
        model = build_model(self.inputs)
        model["curves"][model["outline"][0]]["end"] = "lateral_waist"
        self.assertFalse(validate_model(model, self.inputs)["passed"])
        model = build_model(self.inputs)
        name = model["curves"][model["outline"][0]]["control2"]
        model["points"][name]["y"] += 1
        report = validate_model(model, self.inputs)
        self.assertTrue(any(not c["passed"] for c in report["checks"] if "tangent_difference" in c["name"]))

    def test_intersection_fixture(self):
        self.assertTrue(segments_intersect((0,0),(2,2),(0,2),(2,0)))
        self.assertTrue(segments_intersect((0,0),(2,0),(1,0),(3,0)))
        self.assertFalse(segments_intersect((0,0),(1,0),(0,1),(1,1)))


if __name__ == "__main__":
    unittest.main()
