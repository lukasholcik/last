import copy
import json
import math
from pathlib import Path
import unittest

from bottom_profile import bottom_curve_points
from contour_last import STATIONS, build_contour_last, validate_contour_last
from last_shape import section_extent

ROOT=Path(__file__).resolve().parents[1]


def simpson_length(points,n=1000,end=1):
    """Independent derivative quadrature, not the production polygon bounds."""
    differences=[tuple(3*(q[i]-p[i]) for i in (0,1)) for p,q in zip(points,points[1:])]

    def speed(t):
        weights=((1-t)**2,2*t*(1-t),t*t)
        return math.hypot(*(sum(w*p[i] for w,p in zip(weights,differences)) for i in (0,1)))

    return end*(speed(0)+speed(end)+sum((4 if i%2 else 2)*speed(end*i/n) for i in range(1,n)))/(3*n)


class ContourTests(unittest.TestCase):
    def setUp(self):
        self.inputs=json.loads((ROOT/"examples/contour-baseline.json").read_text())

    def test_baseline_and_heel_sweep_actual_regional_arcs_and_widths(self):
        before=copy.deepcopy(self.inputs)
        projections=[]
        models=[]
        for height in (8,40,60,80):
            inputs=copy.deepcopy(self.inputs)
            inputs["design"]["bottom"]["heel_height"]=height
            state=build_contour_last(inputs)
            self.assertTrue(all(r["passed"] for r in state["reports"].values()))
            self.assertEqual(state["inputs"],inputs)
            self.assertNotIn("projected_inputs",state)
            bottom=state["models"]["bottom"]
            points=[bottom_curve_points(bottom,n) for n in bottom["profile"]]
            lengths=[simpson_length(ps) for ps in points]
            for actual,expected in zip(lengths,(50,125,10,65)):
                self.assertAlmostEqual(actual,expected,delta=0.001)
            self.assertAlmostEqual(sum(lengths),250,delta=0.001)
            self.assertEqual(state["reports"]["bottom"]["ground_contact"],dict(intervals=[],isolated_y=[round(points[1][-1][0],10)]))
            bounds=state["reports"]["contour"]["last_length_bounds"]
            self.assertLessEqual(bounds["lower"],sum(lengths)+1e-8)
            self.assertGreaterEqual(bounds["upper"],sum(lengths)-1e-8)
            projections.append(state["derived"]["projected_length"])
            top=state["models"]["top"]
            for name in STATIONS:
                y=top["points"][name]["y"]
                low,high=section_extent(top,y)
                extent=-low if name.startswith("medial") else high
                self.assertAlmostEqual(extent,inputs["design"]["top"][name+"_width"],delta=0.1)
                self.assertEqual(state["derived"]["station_map"][name]["y"],y)
                accumulated=0
                for ps,length in zip(points,lengths):
                    if y<=ps[-1][0]:
                        t=(y-ps[0][0])/(ps[-1][0]-ps[0][0])
                        accumulated+=simpson_length(ps,end=t)
                        break
                    accumulated+=length
                self.assertAlmostEqual(accumulated,inputs["design"]["top"][name+"_s"],delta=0.001)
            for a,b in zip(points,points[1:]):
                self.assertEqual(a[-1],b[0])
                self.assertAlmostEqual((a[-1][1]-a[-2][1])/(a[-1][0]-a[-2][0]),
                                       (b[1][1]-b[0][1])/(b[1][0]-b[0][0]),places=8)
            models.append(state)
        self.assertTrue(all(a>b for a,b in zip(projections,projections[1:])))
        for current in models[1:]:
            a=models[0]["models"]["bottom"]
            b=current["models"]["bottom"]
            old_seat=bottom_curve_points(a,"bottom_heel_seat")
            new_seat=bottom_curve_points(b,"bottom_heel_seat")
            for p,q in zip(old_seat,new_seat):
                self.assertAlmostEqual(p[0],q[0])
                self.assertAlmostEqual(q[1]-p[1],b["points"]["bottom_heel_rear"]["z"]-8)
            for name in ("bottom_forepart_blend","bottom_forepart_ramp"):
                old,new=bottom_curve_points(a,name),bottom_curve_points(b,name)
                shift=new[0][0]-old[0][0]
                for p,q in zip(old,new):
                    self.assertAlmostEqual(q[0]-p[0],shift)
                    self.assertAlmostEqual(q[1],p[1])
            ratios=[current["derived"]["station_map"][n]["y"]/models[0]["derived"]["station_map"][n]["y"] for n in STATIONS]
            self.assertGreater(max(ratios)-min(ratios),0.01)
        self.assertEqual(self.inputs,before)

    def test_determinism_independent_actual_validation_and_no_metadata_trust(self):
        state=build_contour_last(self.inputs)
        self.assertEqual(state,build_contour_last(self.inputs))
        state["derived"]["projected_length"]=1
        state["derived"]["station_map"]={}
        state["models"]["bottom"]["dimensions"]={}
        self.assertTrue(validate_contour_last(state,self.inputs)["passed"])
        state["models"]["bottom"]["points"]["bottom_toe_end"]["z"]+=2
        self.assertFalse(validate_contour_last(state,self.inputs)["passed"])
        state=build_contour_last(self.inputs)
        state["models"]["top"]["points"]["medial_waist"]["y"]+=1
        self.assertFalse(validate_contour_last(state,self.inputs)["passed"])

    def test_flat_cases_and_changed_target(self):
        for height in (0,8):
            inputs=copy.deepcopy(self.inputs)
            inputs["design"]["bottom"].update(heel_height=height,seat_inclination_deg=0,toe_spring=0)
            state=build_contour_last(inputs)
            self.assertTrue(all(r["passed"] for r in state["reports"].values()))
            self.assertTrue(state["reports"]["bottom"]["ground_contact"]["intervals"])
        self.inputs["design"]["last_length"]=260
        state=build_contour_last(self.inputs)
        self.assertTrue(state["reports"]["contour"]["passed"])
        self.assertAlmostEqual(sum(simpson_length(bottom_curve_points(state["models"]["bottom"],n))
                                   for n in state["models"]["bottom"]["profile"]),260,delta=0.001)

    def test_impossible_regions_are_readable_rejections(self):
        for changes,reason in ((dict(heel_height=0),"seat front"),
                               (dict(heel_height=200),"waist arc"),
                               (dict(toe_spring=75),"toe_spring"),
                               (dict(contact_s=245),"arc gaps"),
                               (dict(seat_inclination_deg=89.999999,heel_height=80),"seat projection")):
            inputs=copy.deepcopy(self.inputs)
            inputs["design"]["bottom"].update(changes)
            with self.subTest(changes=changes),self.assertRaisesRegex(ValueError,reason):
                build_contour_last(inputs)

    def test_strict_keys_finite_types_and_depth(self):
        cases=[]
        for value in (True,math.nan,math.inf,-math.inf,10**400,-1,"250"):
            inputs=copy.deepcopy(self.inputs)
            inputs["design"]["last_length"]=value
            cases.append(inputs)
        for key in self.inputs["design"]["bottom"]:
            for value in (True,math.nan,math.inf,10**400):
                inputs=copy.deepcopy(self.inputs)
                inputs["design"]["bottom"][key]=value
                cases.append(inputs)
        inputs=copy.deepcopy(self.inputs)
        inputs["design"]["bottom"]["seat_inclination_deg"]=90
        cases.append(inputs)
        for group,key in (("bottom","projected_length"),("top","medial_heel_y")):
            inputs=copy.deepcopy(self.inputs)
            inputs["design"][group][key]=1
            cases.append(inputs)
        cases.extend(({},None,{"top":{},"bottom":{}}))
        for inputs in cases:
            with self.subTest(inputs=str(inputs)[:60]),self.assertRaises(ValueError):
                build_contour_last(inputs)
        nested=[]
        for _ in range(70):
            nested=[nested]
        inputs=copy.deepcopy(self.inputs)
        inputs["description"]=nested
        with self.assertRaisesRegex(ValueError,"nesting"):
            build_contour_last(inputs)

    def test_arc_gap_boundary_and_projected_minimum_are_not_fudged(self):
        inputs=copy.deepcopy(self.inputs)
        inputs["design"]["bottom"].update(heel_height=0,toe_spring=0,seat_inclination_deg=0,
                                           seat_arc_length=50,contact_s=50.01)
        state=build_contour_last(inputs)
        self.assertTrue(state["reports"]["contour"]["passed"])
        inputs["design"]["bottom"]["contact_s"]=50.009999
        with self.assertRaisesRegex(ValueError,"0.01 mm"):
            build_contour_last(inputs)
        inputs=copy.deepcopy(self.inputs)
        inputs["design"]["top"]["medial_waist_s"]=30.01
        # The arc gap is admitted, but its nonflat projection is below 0.01.
        with self.assertRaises(ValueError):
            build_contour_last(inputs)

    def test_legal_waist_cap_uses_constructor_roundoff_without_changing_inputs(self):
        self.inputs["design"]["bottom"].update(heel_height=40,seat_inclination_deg=35,contact_s=99)
        before=copy.deepcopy(self.inputs)
        state=build_contour_last(self.inputs)
        self.assertTrue(all(r["passed"] for r in state["reports"].values()))
        waist=bottom_curve_points(state["models"]["bottom"],"bottom_waist")
        self.assertAlmostEqual(simpson_length(waist),49,delta=0.001)
        self.assertEqual(state["inputs"],before)
        self.assertEqual(self.inputs,before)
        # The seat is an actual straight incline, so station inversion is
        # analytic rather than prematurely stopping an arc bisection.
        y=state["derived"]["station_map"]["medial_heel"]["y"]
        self.assertAlmostEqual(y,30*math.cos(math.radians(35)),delta=1e-12)
        for contact in (101,101.01):
            invalid=copy.deepcopy(before)
            invalid["design"]["bottom"]["contact_s"]=contact
            with self.assertRaisesRegex(ValueError,"waist arc.*unattainable"):
                build_contour_last(invalid)
            self.assertEqual(self.inputs,before)

    def test_flat_minimum_station_gap_maps_exactly_without_spreading(self):
        self.inputs["design"]["bottom"].update(heel_height=0,seat_inclination_deg=0,toe_spring=0)
        self.inputs["design"]["top"]["medial_waist_s"]=30.01
        before=copy.deepcopy(self.inputs)
        state=build_contour_last(self.inputs)
        self.assertTrue(all(r["passed"] for r in state["reports"].values()))
        for name in STATIONS:
            self.assertEqual(state["derived"]["station_map"][name]["y"],self.inputs["design"]["top"][name+"_s"])
        self.assertEqual(state["models"]["top"]["points"]["medial_heel"]["y"],30)
        self.assertEqual(state["models"]["top"]["points"]["medial_waist"]["y"],30.01)
        self.assertEqual(state["inputs"],before)
        self.assertEqual(self.inputs,before)
        invalid=copy.deepcopy(before)
        invalid["design"]["top"]["medial_waist_s"]=30.009999
        with self.assertRaisesRegex(ValueError,"0.01 mm gaps"):
            build_contour_last(invalid)


if __name__=="__main__":
    unittest.main()
