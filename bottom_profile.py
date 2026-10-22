"""The specified open longitudinal guide, not a validated 3D last bottom."""

import math

from last_shape import bezier, curve_bounds, derivative_roots

FIELDS = ("heel_height", "toe_spring", "seat_projected_length",
          "seat_inclination_deg", "contact_forward", "forepart_blend_length")
PROFILE = ("bottom_heel_seat", "bottom_waist", "bottom_forepart_blend", "bottom_forepart_ramp")
MM_TOLERANCE = 0.1
ANGLE_TOLERANCE = 0.001


def _number(name, value, minimum=0, maximum=10000, exclusive_max=False):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not minimum <= value <= maximum
            or (exclusive_max and value == maximum) or not math.isfinite(value)):
        boundary = "less than" if exclusive_max else "at most"
        raise ValueError(f"{name} must be finite, at least {minimum} and {boundary} {maximum}")
    return value


def read_bottom_inputs(top_inputs, bottom_inputs):
    if not isinstance(top_inputs, dict) or not isinstance(top_inputs.get("design"), dict):
        raise ValueError("top input must contain design.length")
    if (type(top_inputs.get("schema_version")) is not int or top_inputs["schema_version"] != 1
            or top_inputs.get("units") != "mm"):
        raise ValueError("top input requires schema_version 1 and units mm")
    length = _number("top design.length", top_inputs["design"].get("length"), 0.01)
    if (not isinstance(bottom_inputs, dict) or type(bottom_inputs.get("schema_version")) is not int
             or bottom_inputs["schema_version"] != 2 or bottom_inputs.get("units") != "mm"):
        raise ValueError("bottom input requires schema_version 2 and units mm; regenerate v1 data with explicit forepart_blend_length=10 and version 2")
    design = bottom_inputs.get("design")
    if not isinstance(design, dict) or set(design) != set(FIELDS):
        raise ValueError("bottom design must contain exactly: " + ", ".join(FIELDS))
    for name in FIELDS:
        if name == "seat_inclination_deg":
            _number(name, design[name], maximum=90, exclusive_max=True)
        else:
            _number(name, design[name])
    h, t, s, angle, c, blend = (design[k] for k in FIELDS)
    gaps = (s, c-s, blend, length-c-blend)
    if any(g < 0.01 and not math.isclose(g, 0.01, rel_tol=0, abs_tol=1e-11) for g in gaps):
        raise ValueError("require 0 < seat_projected_length < contact_forward; forepart_blend_length and projected_length-contact_forward-forepart_blend_length must each be >= 0.01 mm (0.01 mm gaps)")
    slope = -math.tan(math.radians(angle))
    front_height = h + slope*s
    waist_handle_height = front_height + slope*(c-s)/3
    if not math.isfinite(front_height) or front_height < 0:
        raise ValueError("seat front: B = heel_height - seat_projected_length*tan(seat_inclination_deg) must be >= 0")
    if not math.isfinite(waist_handle_height) or waist_handle_height < 0:
        raise ValueError("bottom_waist_handle_start: B - (contact_forward-seat_projected_length)*tan(seat_inclination_deg)/3 must be >= 0")
    return length, dict(design), slope, front_height


def build_bottom_model(top_inputs, bottom_inputs):
    length, d, slope, b = read_bottom_inputs(top_inputs, bottom_inputs)
    h, t, s, _, c, blend = (d[k] for k in FIELDS)
    ramp_slope = t/(length-c-blend/2)
    points = {}

    def point(name, y, z, kind="landmark"):
        points[name] = dict(y=y, z=z, kind=kind)

    point("bottom_heel_rear", 0, h)
    point("bottom_seat_front", s, b)
    point("bottom_forepart_contact", c, 0)
    point("bottom_forepart_blend_end", c+blend, ramp_slope*blend/2)
    point("bottom_toe_end", length, t)
    point("bottom_heel_ground", 0, 0, "reference")
    point("bottom_toe_ground", length, 0, "reference")
    point("bottom_seat_horizontal_front", s, h, "reference")
    point("bottom_forepart_blend_ground_end", c+blend, 0, "reference")
    endpoints = ("bottom_heel_rear", "bottom_seat_front", "bottom_forepart_contact", "bottom_forepart_blend_end", "bottom_toe_end")
    curves, connectors = {}, {}
    for name, start, end, (u, v) in zip(PROFILE, endpoints, endpoints[1:], ((slope,slope),(slope,0),(0,ramp_slope),(ramp_slope,ramp_slope))):
        p, q = points[start], points[end]
        interval = q["y"] - p["y"]
        hs, he = name + "_handle_start", name + "_handle_end"
        point(hs, p["y"]+interval/3, p["z"]+u*interval/3, "handle")
        point(he, q["y"]-interval/3, q["z"]-v*interval/3, "handle")
        curves[name] = dict(start=start, control1=hs, control2=he, end=end)
        for suffix, a, e in (("start_to_handle_start",start,hs), ("handle_start_to_handle_end",hs,he), ("handle_end_to_end",he,end)):
            connectors[name + "_" + suffix] = dict(start=a, end=e)
    refs = {
        "bottom_ground_projected_length": dict(start="bottom_heel_ground", end="bottom_toe_ground"),
        "bottom_heel_height": dict(start="bottom_heel_ground", end="bottom_heel_rear"),
        "bottom_toe_spring": dict(start="bottom_toe_ground", end="bottom_toe_end"),
        "bottom_seat_horizontal": dict(start="bottom_heel_rear", end="bottom_seat_horizontal_front"),
        "bottom_seat_chord": dict(start="bottom_heel_rear", end="bottom_seat_front"),
        "bottom_contact_forward": dict(start="bottom_heel_ground", end="bottom_forepart_contact"),
        "bottom_forepart_blend_projection": dict(start="bottom_forepart_contact", end="bottom_forepart_blend_ground_end"),
    }
    dimension_specs = (
        ("projected_length", length, "mm", "bottom_ground_projected_length", "Shared top design.length: forward separation, not arc length"),
        ("heel_height", h, "mm", "bottom_heel_height", "Rear guide endpoint height above z=0"),
        ("toe_spring", t, "mm", "bottom_toe_spring", "Toe guide endpoint height above z=0"),
        ("seat_projected_length", s, "mm", "bottom_seat_horizontal", "Horizontal seat projection"),
        ("seat_inclination_deg", d["seat_inclination_deg"], "deg", "bottom_seat_chord", "Downward-forward seat angle from horizontal"),
        ("contact_forward", c, "mm", "bottom_contact_forward", "Forward position of designated contact guide point"),
        ("forepart_blend_length", blend, "mm", "bottom_forepart_blend_projection", "Forward length of the rounded contact transition"),
    )
    dimensions = {name: dict(expected=value, units=unit, reference_line=ref, definition=definition)
                  for name,value,unit,ref,definition in dimension_specs}
    return dict(schema_version=2, kind="bottom_profile", units="mm", axes=["y","z"], closed=False,
                points=points, curves=curves, profile=list(PROFILE), reference_lines=refs,
                construction_lines=connectors, dimensions=dimensions,
                source="Made-up design values; provisional shared y range, not foot measurements")


def bottom_curve_points(model, name):
    curve = model["curves"][name]
    return [(model["points"][curve[key]]["y"], model["points"][curve[key]]["z"])
            for key in ("start", "control1", "control2", "end")]


def _split(points):
    def midpoint(a,b):
        return tuple((x+y)/2 for x,y in zip(a,b))
    a,b,c = (midpoint(p,q) for p,q in zip(points,points[1:]))
    d,e = midpoint(a,b), midpoint(b,c)
    f = midpoint(d,e)
    return [points[0],a,d,f], [f,e,c,points[-1]]


def arc_length_bounds(points, budget=0.001, depth=0):
    """Chord <= arc <= control polygon; split the remaining gap budget in half."""
    if budget <= 0 or not math.isfinite(budget):
        raise ValueError("arc-length budget must be positive and finite")
    lower = math.dist(points[0],points[-1])
    upper = sum(math.dist(p,q) for p,q in zip(points,points[1:]))
    if upper-lower <= budget:
        return lower, max(lower,upper)
    if depth >= 30:
        raise ValueError("arc-length bound did not converge within 30 subdivision levels")
    left,right = _split(points)
    a,b = arc_length_bounds(left,budget/2,depth+1)
    c,d = arc_length_bounds(right,budget/2,depth+1)
    return a+c,b+d


def _coordinate_roundoff(points, slope):
    """Few-ulp coordinate budget, including height error from rounded stations.

    Four ulps cover the short add/subtract/multiply chains used for handles.
    A nominal blend length and its stored endpoint difference can differ by
    station roundoff; multiplying that error by the slope also affects z.
    This is arithmetic uncertainty, unrelated to the 0.1 mm size tolerance.
    """
    y_error = 4*max(math.ulp(p[0]) for p in points)
    z_error = 4*max(math.ulp(p[1]) for p in points) + abs(slope)*y_error
    return y_error,z_error


def validate_bottom_model(model, top_inputs, bottom_inputs):
    """Measure actual curves; never trust dimension/reference metadata as evidence."""
    if (not isinstance(model,dict) or type(model.get("schema_version")) is not int
            or model["schema_version"] != 2 or model.get("units") != "mm"
            or model.get("axes") != ["y","z"] or model.get("kind") != "bottom_profile"
            or model.get("closed") is not False):
        raise ValueError("bottom model requires schema_version 2, units mm, axes ['y', 'z'], kind bottom_profile, closed false")
    length,d,m,b = read_bottom_inputs(top_inputs,bottom_inputs)
    if model.get("profile") != list(PROFILE):
        raise ValueError("profile must contain the four specified curves in order")
    curves = [bottom_curve_points(model,n) for n in PROFILE]
    for ps in curves:
        for p in ps:
            for value in p:
                _number("resulting coordinate",value,-10000,10000)
    checks = []

    def check(name,actual,expected,tolerance=MM_TOLERANCE,units="mm"):
        passed = math.isfinite(actual) and abs(actual-expected) <= tolerance
        checks.append(dict(name=name,actual=actual,expected=expected,tolerance=tolerance,units=units,passed=passed))

    def flag(name,passed):
        check(name,int(passed),1,0,"boolean")

    bounds_y = [curve_bounds(ps,0) for ps in curves]
    bounds_z = [curve_bounds(ps,1) for ps in curves]
    check("rear_y",curves[0][0][0],0)
    check("projected_length",max(v[1] for v in bounds_y)-min(v[0] for v in bounds_y),length)
    check("toe_forward",curves[-1][-1][0],length)
    check("heel_height",curves[0][0][1],d["heel_height"])
    check("toe_spring",curves[-1][-1][1],d["toe_spring"])
    check("seat_projected_length",curves[0][-1][0]-curves[0][0][0],d["seat_projected_length"])
    check("contact_forward",curves[1][-1][0],d["contact_forward"])
    check("forepart_blend_length",curves[2][-1][0]-curves[2][0][0],d["forepart_blend_length"])
    check("contact_height",curves[1][-1][1],0)
    check("minimum_height",min(v[0] for v in bounds_z),0)
    flag("no_below_ground",min(v[0] for v in bounds_z) >= -1e-9)
    # Measure the actual seat tangent at its midpoint; endpoint and handle
    # checks separately establish that the specified seat stays straight.
    seat_derivative = [sum(3*w*(q[axis]-p[axis]) for w,p,q in
                           zip((0.25,0.5,0.25),curves[0],curves[0][1:])) for axis in (0,1)]
    angle = math.degrees(math.atan2(-seat_derivative[1],seat_derivative[0]))
    check("seat_inclination_deg",angle,d["seat_inclination_deg"],ANGLE_TOLERANCE,"deg")
    check("seat_vertical_drop",curves[0][0][1]-curves[0][-1][1],-m*d["seat_projected_length"])
    c,blend = d["contact_forward"],d["forepart_blend_length"]
    ramp_slope = d["toe_spring"]/(length-c-blend/2)
    endpoints = [(0,d["heel_height"]),(d["seat_projected_length"],b),(c,0),
                 (c+blend,ramp_slope*blend/2),(length,d["toe_spring"])]
    slopes = ((m,m),(m,0),(0,ramp_slope),(ramp_slope,ramp_slope))
    tangents,tangent_errors = [],[]
    for i,(name,ps,(u,v)) in enumerate(zip(PROFILE,curves,slopes)):
        p,q = endpoints[i:i+2]
        interval = q[0]-p[0]
        expected = [p,(p[0]+interval/3,p[1]+u*interval/3),(q[0]-interval/3,q[1]-v*interval/3),q]
        for key,actual,target in zip(("start","control1","control2","end"),ps,expected):
            point_name = model["curves"][name][key]
            check(point_name+"_position_error",math.dist(actual,target),0)
        flag(name+"_strictly_forward",all(q[0]>p[0] for p,q in zip(ps,ps[1:])))
        # Control y spacing proves y(t) is linear for this construction.
        flag(name+"_linear_y",all(abs(ps[j][0]-(ps[0][0]+j*(ps[-1][0]-ps[0][0])/3)) <= 1e-9 for j in (1,2)))
        ends,errors = [],[]
        y_error,z_error = _coordinate_roundoff(ps,max(abs(u),abs(v)))
        for label,a,e,wanted in (("start",ps[0],ps[1],u),("end",ps[2],ps[3],v)):
            dy,dz = e[0]-a[0],e[1]-a[1]
            flag(name+"_"+label+"_nonzero_forward_tangent",dy>0)
            slope = dz/dy if dy>0 else math.inf
            # Propagate endpoint subtraction errors through dz/dy. The
            # denominator accounts for its own uncertainty; near-vertical
            # slopes on very short forward intervals amplify station ulps.
            denominator = dy-2*y_error
            error = ((2*z_error+2*abs(wanted)*y_error)/denominator
                     + 4*math.ulp(wanted)) if denominator>0 else 0
            check(name+"_"+label+"_slope",slope,wanted,max(1e-9,error),"dz/dy")
            ends.append(slope)
            errors.append(error)
        tangents.append(ends)
        tangent_errors.append(errors)
    for i in range(len(curves)-1):
        check(PROFILE[i]+"_join_gap",math.dist(curves[i][-1],curves[i+1][0]),0,1e-9)
        check(PROFILE[i]+"_join_slope_difference",abs(tangents[i][1]-tangents[i+1][0]),0,
              max(1e-9,tangent_errors[i][1]+tangent_errors[i+1][0]),"dz/dy")
    # Independent shape checks on actual control differences, not expected
    # handle positions: a cubic's second derivative interpolates these two
    # second differences. Linear y makes their z signs curvature signs.
    for index in (2,3):
        ps = curves[index]
        y_error,z_error = _coordinate_roundoff(ps,ramp_slope)
        second_z = [ps[i+2][1]-2*ps[i+1][1]+ps[i][1] for i in (0,1)]
        check(PROFILE[index]+"_nonnegative_slope",min(0,min(q[1]-p[1] for p,q in zip(ps,ps[1:]))),0,max(1e-9,2*z_error))
        if index == 2:
            check("forepart_blend_convex_up",min(0,min(second_z)),0,max(1e-9,4*z_error))
            # Coefficient absolute sums are 4 for a second difference and
            # 8 for their difference (the cubic's third difference).
            check("forepart_blend_quadratic",abs(second_z[1]-second_z[0]),0,max(1e-9,8*z_error))
        else:
            for axis in (0,1):
                check("forepart_ramp_second_difference_"+"yz"[axis],
                      max(abs(ps[i+2][axis]-2*ps[i+1][axis]+ps[i][axis]) for i in (0,1)),0,
                      max(1e-9,4*(y_error if axis==0 else z_error)))
    flag("positive_toe_spring_has_inclined_end",d["toe_spring"] == 0 or tangents[-1][1]>0)
    # Find ground intervals and isolated roots from the actual polynomials.
    intervals,contacts = [],[]
    for name,ps in zip(PROFILE,curves):
        if all(p[1] == 0 for p in ps):
            intervals.append(dict(curve=name,start_y=ps[0][0],end_y=ps[-1][0]))
        else:
            cuts = [0]+derivative_roots([p[1] for p in ps])+[1]
            # Do not turn a very small positive designed clearance into contact.
            # For the admitted nonnegative monotone curves, roots are endpoints
            # unless the whole segment is flat at zero.
            contacts.extend(bezier(ps,t)[0] for t in cuts if bezier(ps,t)[1] == 0)
    contacts = sorted(set(round(y,10) for y in contacts
                          if not any(v["start_y"]<=y<=v["end_y"] for v in intervals)))
    # A dimensional tolerance is not permission to float above the ground.
    # Only the forward position gets a subtraction-roundoff allowance; the
    # contact roots/intervals above require actual zero height on the curves.
    contact_y = d["contact_forward"]
    flag("designated_station_has_ground_contact",
         any(v["start_y"]-1e-9 <= contact_y <= v["end_y"]+1e-9 for v in intervals)
         or any(math.isclose(y,contact_y,rel_tol=0,abs_tol=1e-9) for y in contacts))
    lowers,uppers = zip(*(arc_length_bounds(ps,0.01/len(curves)) for ps in curves))
    lower,upper = sum(lowers),sum(uppers)
    return dict(passed=all(c["passed"] for c in checks),units="mm",checks=checks,
                ground_contact=dict(intervals=intervals,isolated_y=contacts),
                bottom_arc_length=dict(actual=(lower+upper)/2,lower_bound=lower,upper_bound=upper,
                                       uncertainty_mm=(upper-lower)/2,units="mm",derived=True),
                limits=["0.1 mm and 0.001 degree tolerances are software checks, not fit allowances.",
                        "Arc bounds use recursive chord/control-polygon bounds; total gap <=0.01 mm, depth limit 30.",
                        "Strict forward curves and closed internal joins form an open graph without self-crossings.",
                        "C1 means matching dz/dy, not matching local-parameter derivative magnitudes or curvature.",
                        "Shared top length is provisional alignment, not a validated spatial correspondence.",
                        "No 3D bottom, sole, posture transformation, toe-clearance or fit prediction."])
