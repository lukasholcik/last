import copy
import json
import math
from pathlib import Path
import unittest

from bottom_profile import (PROFILE, arc_length_bounds, bottom_curve_points,
                            build_bottom_model, validate_bottom_model)
from last_shape import bezier

ROOT = Path(__file__).resolve().parents[1]


class BottomProfileTests(unittest.TestCase):
    def setUp(self):
        self.top = json.loads((ROOT/"examples/baseline.json").read_text())
        self.bottom = json.loads((ROOT/"examples/bottom-baseline.json").read_text())

    def test_baseline_dimensions_and_no_mutation(self):
        before = copy.deepcopy((self.top,self.bottom))
        model = build_bottom_model(self.top,self.bottom)
        report = validate_bottom_model(model,self.top,self.bottom)
        self.assertTrue(report["passed"],report)
        self.assertEqual(model,build_bottom_model(self.top,self.bottom))
        self.assertEqual((self.top,self.bottom),before)
        self.assertEqual(model["axes"],["y","z"])
        self.assertFalse(model["closed"])
        self.assertEqual(model["profile"],list(PROFILE))
        self.assertEqual(len(model["construction_lines"]),12)
        self.assertEqual(len(model["points"]),17)
        self.assertEqual(len(model["dimensions"]),7)
        self.assertEqual(report["ground_contact"],dict(intervals=[],isolated_y=[175]))
        self.assertGreater(report["bottom_arc_length"]["lower_bound"],250)
        self.assertLessEqual(report["bottom_arc_length"]["uncertainty_mm"],0.01)
        json.dumps(model,allow_nan=False)

    def test_arc_bounds_known_line(self):
        lower,upper = arc_length_bounds([(0,0),(1,4/3),(2,8/3),(3,4)])
        self.assertAlmostEqual(lower,5)
        self.assertAlmostEqual(upper,5)

    def test_arc_bounds_known_curved_integral(self):
        # Cubic representation of (t,t^2), independent exact integral.
        ps = [(0,0),(1/3,0),(2/3,1/3),(1,1)]
        actual = math.sqrt(5)/2+math.asinh(2)/4
        lower,upper = arc_length_bounds(ps,1e-6)
        self.assertLessEqual(lower,actual)
        self.assertGreaterEqual(upper,actual)
        self.assertLessEqual(upper-lower,1e-6)

    def test_profile_arc_against_independent_simpson(self):
        model = build_bottom_model(self.top,self.bottom)
        report = validate_bottom_model(model,self.top,self.bottom)
        integral = 0
        for name in PROFILE:
            ps = bottom_curve_points(model,name)
            def speed(t):
                v = [tuple(3*(b[a]-p[a]) for a in (0,1)) for p,b in zip(ps,ps[1:])]
                d = [sum(w*p[a] for w,p in zip(((1-t)**2,2*t*(1-t),t*t),v)) for a in (0,1)]
                return math.hypot(*d)
            n = 2000
            integral += (speed(0)+speed(1)+sum((4 if i%2 else 2)*speed(i/n) for i in range(1,n)))/(3*n)
        bounds = report["bottom_arc_length"]
        self.assertLessEqual(bounds["lower_bound"],integral)
        self.assertGreaterEqual(bounds["upper_bound"],integral)
        lo,hi = arc_length_bounds(bottom_curve_points(model,PROFILE[0]),1e-8)
        self.assertAlmostEqual((lo+hi)/2,50/math.cos(math.radians(2)),places=8)

    def test_global_slopes_not_equal_local_derivatives(self):
        model = build_bottom_model(self.top,self.bottom)
        a,b = [bottom_curve_points(model,n) for n in PROFILE[:2]]
        self.assertEqual(a[-1],b[0])
        da = tuple(a[-1][i]-a[-2][i] for i in (0,1))
        db = tuple(b[1][i]-b[0][i] for i in (0,1))
        self.assertNotAlmostEqual(da[0],db[0])
        self.assertAlmostEqual(da[1]/da[0],db[1]/db[0])
        self.assertTrue(validate_bottom_model(model,self.top,self.bottom)["passed"])

    def test_zero_heights_report_intervals(self):
        self.bottom["design"].update(heel_height=0,seat_inclination_deg=0,toe_spring=0)
        report = validate_bottom_model(build_bottom_model(self.top,self.bottom),self.top,self.bottom)
        self.assertTrue(report["passed"])
        self.assertEqual(len(report["ground_contact"]["intervals"]),4)
        self.assertEqual(report["ground_contact"]["isolated_y"],[])
        self.bottom["design"].update(heel_height=8)
        report = validate_bottom_model(build_bottom_model(self.top,self.bottom),self.top,self.bottom)
        self.assertEqual([v["curve"] for v in report["ground_contact"]["intervals"]],list(PROFILE[-2:]))
        self.assertEqual(report["ground_contact"]["isolated_y"],[])

    def test_all_six_variants_and_shared_length(self):
        specs = json.loads((ROOT/"examples/bottom-variants.json").read_text())["variants"]
        for spec in specs:
            inputs = copy.deepcopy(self.bottom)
            inputs["design"][spec["input"]] = spec["value"]
            self.assertTrue(validate_bottom_model(build_bottom_model(self.top,inputs),self.top,inputs)["passed"])
        self.top["design"]["length"] = 260
        model = build_bottom_model(self.top,self.bottom)
        self.assertEqual(model["points"]["bottom_toe_end"]["y"],260)
        self.assertTrue(validate_bottom_model(model,self.top,self.bottom)["passed"])

    def test_tiny_positive_height_is_not_ground_contact(self):
        self.bottom["design"].update(heel_height=1e-10,seat_inclination_deg=0,toe_spring=1e-10)
        report = validate_bottom_model(build_bottom_model(self.top,self.bottom),self.top,self.bottom)
        self.assertTrue(report["passed"])
        self.assertEqual(report["ground_contact"],dict(intervals=[],isolated_y=[175]))

    def test_translated_profile_must_still_contact_ground(self):
        for clearance in (0.05,1e-10):
            with self.subTest(clearance=clearance):
                model = build_bottom_model(self.top,self.bottom)
                for point in model["points"].values():
                    if point["kind"] in ("landmark","handle"):
                        point["z"] += clearance
                report = validate_bottom_model(model,self.top,self.bottom)
                self.assertFalse(report["passed"])
                self.assertEqual(report["ground_contact"],dict(intervals=[],isolated_y=[]))
                contact = next(c for c in report["checks"] if c["name"]=="designated_station_has_ground_contact")
                self.assertFalse(contact["passed"])

    def test_model_identity_guard(self):
        contradictions = {
            "schema_version": (True,1,3,"2"), "units": ("cm",),
            "axes": (["x","y"],["z","y"]), "kind": ("top_profile","unknown"),
            "closed": (True,0),
        }
        for key,values in contradictions.items():
            for value in (*values,None):
                with self.subTest(key=key,value=value):
                    model = build_bottom_model(self.top,self.bottom)
                    if value is None:
                        del model[key]
                    else:
                        model[key] = value
                    with self.assertRaisesRegex(ValueError,"bottom model requires"):
                        validate_bottom_model(model,self.top,self.bottom)

    def test_blend_quadratic_and_exact_inclined_ramp(self):
        for toe,blend in ((10,10),(15,20),(1,0.01),(0,10)):
            self.bottom["design"].update(toe_spring=toe,forepart_blend_length=blend)
            model = build_bottom_model(self.top,self.bottom)
            report = validate_bottom_model(model,self.top,self.bottom)
            self.assertTrue(report["passed"],report)
            k = toe/(75-blend/2)
            a = bottom_curve_points(model,PROFILE[2])
            ramp = bottom_curve_points(model,PROFILE[3])
            for t in (0,0.13,0.5,0.82,1):
                y,z = bezier(a,t)
                self.assertAlmostEqual(y,175+blend*t)
                self.assertAlmostEqual(z,k*(y-175)**2/(2*blend))
                y,z = bezier(ramp,t)
                self.assertAlmostEqual(z,k*(y-175-blend/2))
            end_slope = (ramp[-1][1]-ramp[-2][1])/(ramp[-1][0]-ramp[-2][0])
            self.assertAlmostEqual(end_slope,k)
            if toe:
                self.assertGreater(end_slope,0)

    def test_actual_shape_checks_reject_bent_ramp_and_s_shaped_blend(self):
        model = build_bottom_model(self.top,self.bottom)
        model["points"]["bottom_forepart_ramp_handle_start"]["z"] += 0.01
        checks = validate_bottom_model(model,self.top,self.bottom)["checks"]
        self.assertFalse(next(c for c in checks if c["name"]=="forepart_ramp_second_difference_z")["passed"])
        model = build_bottom_model(self.top,self.bottom)
        # Flattening the blend's end introduces a negative second derivative.
        model["points"]["bottom_forepart_blend_handle_end"]["z"] = model["points"]["bottom_forepart_blend_end"]["z"]
        checks = validate_bottom_model(model,self.top,self.bottom)["checks"]
        self.assertFalse(next(c for c in checks if c["name"]=="forepart_blend_convex_up")["passed"])

    def test_blend_gap_limits_and_old_version_rejection(self):
        for blend in (0,0.009999,75,76,10**400,True,math.nan,math.inf):
            self.bottom["design"]["forepart_blend_length"] = blend
            with self.subTest(blend=str(blend)[:20]),self.assertRaises(ValueError):
                build_bottom_model(self.top,self.bottom)
        for blend in (0.01,74.99):
            self.bottom["design"]["forepart_blend_length"] = blend
            build_bottom_model(self.top,self.bottom)
        self.bottom["design"]["forepart_blend_length"] = 74.990001
        with self.assertRaisesRegex(ValueError,"0.01 mm"):
            build_bottom_model(self.top,self.bottom)
        self.bottom["schema_version"] = 1
        with self.assertRaisesRegex(ValueError,"regenerate v1 data.*forepart_blend_length=10"):
            build_bottom_model(self.top,self.bottom)

    def test_short_steep_forepart_roundoff_boundaries(self):
        cases = ((250,249.98,10,2),(10000,9999.98,10000,0))
        for length,contact,toe,angle in cases:
            with self.subTest(length=length):
                self.top["design"]["length"] = length
                self.bottom["design"].update(contact_forward=contact,toe_spring=toe,
                                           seat_inclination_deg=angle,forepart_blend_length=0.01)
                model = build_bottom_model(self.top,self.bottom)
                report = validate_bottom_model(model,self.top,self.bottom)
                self.assertTrue(report["passed"],[c for c in report["checks"] if not c["passed"]])
                # A meaningful edit remains many orders above arithmetic error,
                # even for the large-height, short-interval boundary case.
                model["points"]["bottom_forepart_ramp_handle_start"]["z"] += 0.01
                report = validate_bottom_model(model,self.top,self.bottom)
                self.assertFalse(report["passed"])
                self.assertFalse(next(c for c in report["checks"] if c["name"]=="forepart_ramp_second_difference_z")["passed"])
                model = build_bottom_model(self.top,self.bottom)
                model["points"]["bottom_forepart_blend_handle_end"]["z"] = model["points"]["bottom_forepart_blend_end"]["z"]
                report = validate_bottom_model(model,self.top,self.bottom)
                self.assertFalse(next(c for c in report["checks"] if c["name"]=="forepart_blend_convex_up")["passed"])
                self.bottom["design"]["forepart_blend_length"] = 0.009999
                with self.assertRaisesRegex(ValueError,"0.01 mm"):
                    build_bottom_model(self.top,self.bottom)

    def test_invalid_inputs(self):
        for field in self.bottom["design"]:
            for bad in (True,math.nan,math.inf,-math.inf,10**400,-1,"8"):
                inputs = copy.deepcopy(self.bottom)
                inputs["design"][field] = bad
                with self.subTest(field=field,bad=str(bad)[:20]),self.assertRaises(ValueError):
                    build_bottom_model(self.top,inputs)
        for changes in (dict(seat_inclination_deg=90),dict(seat_projected_length=175),
                        dict(contact_forward=250),dict(heel_height=1),dict(seat_inclination_deg=20),
                        dict(projected_length=250)):
            inputs = copy.deepcopy(self.bottom)
            inputs["design"].update(changes)
            with self.assertRaises(ValueError):
                build_bottom_model(self.top,inputs)
        self.top["design"]["length"] = 10**400
        with self.assertRaises(ValueError):
            build_bottom_model(self.top,self.bottom)

    def test_gap_boundary_and_named_inequalities(self):
        self.bottom["design"].update(heel_height=0,seat_inclination_deg=0,seat_projected_length=175,contact_forward=175.01)
        build_bottom_model(self.top,self.bottom)
        self.bottom["design"]["contact_forward"] = 175.009999
        with self.assertRaisesRegex(ValueError,"0.01 mm"):
            build_bottom_model(self.top,self.bottom)
        self.bottom["design"].update(heel_height=1,seat_inclination_deg=2,seat_projected_length=50,contact_forward=175)
        with self.assertRaisesRegex(ValueError,"seat front: B"):
            build_bottom_model(self.top,self.bottom)
        self.bottom["design"]["heel_height"] = 2
        with self.assertRaisesRegex(ValueError,"bottom_waist_handle_start"):
            build_bottom_model(self.top,self.bottom)

    def test_validation_uses_curves_not_metadata(self):
        model = build_bottom_model(self.top,self.bottom)
        model["dimensions"]["heel_height"]["expected"] = 1000
        model["reference_lines"] = {}
        self.assertTrue(validate_bottom_model(model,self.top,self.bottom)["passed"])
        model["points"]["bottom_waist_handle_start"]["z"] = -5
        report = validate_bottom_model(model,self.top,self.bottom)
        self.assertFalse(report["passed"])
        self.assertFalse(next(c for c in report["checks"] if c["name"]=="no_below_ground")["passed"])

    def test_changed_handle_and_station_fail(self):
        for point,axis in (("bottom_toe_end","z"),("bottom_forepart_contact","y"),
                           ("bottom_heel_seat_handle_end","z"),("bottom_waist_handle_end","y")):
            model = build_bottom_model(self.top,self.bottom)
            model["points"][point][axis] += 1
            self.assertFalse(validate_bottom_model(model,self.top,self.bottom)["passed"])
        model["points"]["bottom_toe_end"]["z"] = math.nan
        with self.assertRaises(ValueError):
            validate_bottom_model(model,self.top,self.bottom)


if __name__ == "__main__":
    unittest.main()
