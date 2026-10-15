"""A made-up top silhouette, not a foot, sole outline, or fit prediction."""

import math
from typing import Any

TOLERANCE_MM = 0.1
REGIONS = ("heel", "waist", "ball", "toe")
SIDES = ("medial", "lateral")


def read_dimensions(inputs):
    """Accept only the small, explicit v1 input format."""
    if (not isinstance(inputs, dict) or type(inputs.get("schema_version")) is not int
            or inputs.get("schema_version") != 1):
        raise ValueError("schema_version must be 1")
    if inputs.get("units") != "mm":
        raise ValueError("units must be mm")
    dimensions = inputs.get("design")
    required = {"length"} | {
        f"{side}_{region}_{field}"
        for side in SIDES for region in REGIONS for field in ("y", "width")
    }
    if not isinstance(dimensions, dict) or set(dimensions) != required:
        raise ValueError("design must contain length and each side/region's y and width")
    for name, value in dimensions.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{name} must be a finite number")
        # Compare range first: enormous JSON integers cannot convert to a float.
        if not 0.01 <= value <= 10000 or not math.isfinite(value):
            raise ValueError(f"{name} must be finite and between 0.01 and 10000 mm")
    length = dimensions["length"]
    for side in SIDES:
        positions = [0] + [dimensions[f"{side}_{r}_y"] for r in REGIONS] + [length]
        # Only allow subtraction roundoff, not the 0.1 mm dimension tolerance.
        if any(b - a < 0.01 and not math.isclose(b - a, 0.01, rel_tol=0, abs_tol=1e-11)
               for a, b in zip(positions, positions[1:])):
            raise ValueError(f"{side}: require heel < waist < ball < toe < length, with 0.01 mm gaps")
    return dict(dimensions)


def build_model(inputs) -> dict[str, Any]:
    d = read_dimensions(inputs)
    points, curves, references = {}, {}, {}

    def point(name, x, y, kind="landmark"):
        points[name] = {"x": x, "y": y, "kind": kind}

    point("heel_tip", 0.0, 0.0)
    point("toe_tip", 0.0, d["length"])
    for side, sign in (("medial", -1), ("lateral", 1)):
        for region in REGIONS:
            name = f"{side}_{region}"
            point(name, sign * d[f"{name}_width"], d[f"{name}_y"])
            center = f"{name}_center"
            point(center, 0.0, d[f"{name}_y"], "reference")
            references[f"{name}_half_width"] = {"start": center, "end": name}
    references["length_axis"] = {"start": "heel_tip", "end": "toe_tip"}
    dimensions = {
        "length": {"kind": "length", "axis": "y", "start_y": 0.0,
                   "end_y": d["length"], "expected": d["length"],
                   "reference_line": "length_axis"}
    }
    for side in SIDES:
        for region in REGIONS:
            name = f"{side}_{region}_half_width"
            dimensions[name] = {
                "kind": "side_extent", "axis": "x", "side": side,
                "station_y": d[f"{side}_{region}_y"],
                "expected": d[f"{side}_{region}_width"],
                "reference_line": name,
                "definition": "Positive distance from x=0 to this side at station_y",
            }
    order = (["heel_tip"] + [f"lateral_{r}" for r in REGIONS]
             + ["toe_tip"] + [f"medial_{r}" for r in reversed(REGIONS)])
    tangents: dict[str, tuple[float, float]] = {
        "heel_tip": (1.5 * min(d["medial_heel_width"], d["lateral_heel_width"]), 0),
        "toe_tip": (-1.5 * min(d["medial_toe_width"], d["lateral_toe_width"]), 0),
    }
    for side, direction in (("lateral", 1), ("medial", -1)):
        ys = [0] + [d[f"{side}_{r}_y"] for r in REGIONS] + [d["length"]]
        widths = [0] + [d[f"{side}_{r}_width"] for r in REGIONS] + [0]
        for i, region in enumerate(REGIONS, 1):
            before, after = ys[i] - ys[i-1], ys[i+1] - ys[i]
            dw_before, dw_after = widths[i] - widths[i-1], widths[i+1] - widths[i]
            a, b = dw_before / before, dw_after / after
            # A weighted harmonic slope follows increasing/decreasing widths.
            # Only a genuine extremum or flat interval gets a vertical tangent.
            slope = 0.0
            if a * b > 0:
                w1, w2 = 2 * after + before, after + 2 * before
                slope = (w1 + w2) / (w1 / a + w2 / b)
            reach = 1.5 * min(before, after)
            if slope:
                # Each x handle uses at most half its neighbouring width gap.
                # Together with the y bound, every control polygon is monotone.
                reach = min(reach, 1.5 * min(abs(dw_before), abs(dw_after)) / abs(slope))
            # x sign and traversal direction cancel on the medial side.
            tangents[f"{side}_{region}"] = (slope * reach, direction * reach)
    outline = []
    for start, end in zip(order, order[1:] + order[:1]):
        name = f"{start}_to_{end}"
        c1, c2 = f"{name}_handle_start", f"{name}_handle_end"
        a, b = points[start], points[end]
        ta, tb = tangents[start], tangents[end]
        point(c1, a["x"] + ta[0] / 3, a["y"] + ta[1] / 3, "handle")
        point(c2, b["x"] - tb[0] / 3, b["y"] - tb[1] / 3, "handle")
        curves[name] = dict(start=start, control1=c1, control2=c2, end=end)
        outline.append(name)
    return dict(schema_version=1, units="mm", points=points, curves=curves,
                reference_lines=references, outline=outline,
                dimensions=dimensions,
                design=d, source="made-up design dimensions; not measured foot data")


def curve_points(model, name):
    curve = model["curves"][name]
    return [(model["points"][curve[k]]["x"], model["points"][curve[k]]["y"])
            for k in ("start", "control1", "control2", "end")]


def bezier(points, t):
    u = 1 - t
    weights = (u**3, 3*u*u*t, 3*u*t*t, t**3)
    return tuple(sum(w*p[axis] for w, p in zip(weights, points)) for axis in (0, 1))


def derivative_roots(values):
    """Real interior extrema of a cubic, from its quadratic derivative."""
    p0, p1, p2, p3 = values
    a = -p0 + 3*p1 - 3*p2 + p3
    b = 2*(p0 - 2*p1 + p2)
    c = p1 - p0
    if abs(a) < 1e-12:
        roots = [] if abs(b) < 1e-12 else [-c/b]
    else:
        discriminant = b*b - 4*a*c
        if discriminant < 0:
            roots = []
        else:
            q = -0.5 * (b + math.copysign(math.sqrt(discriminant), b))
            roots = [-b/(2*a)] if q == 0 else [q/a, c/q]
    return sorted(set(t for t in roots if 0 < t < 1))


def curve_bounds(points, axis):
    ts = [0, 1] + derivative_roots([p[axis] for p in points])
    values = [bezier(points, t)[axis] for t in ts]
    return min(values), max(values)


def section_roots(points, y):
    """Split at analytic extrema, then bisect each monotone piece (60 steps)."""
    cuts = [0] + derivative_roots([p[1] for p in points]) + [1]
    roots = []
    for lo, hi in zip(cuts, cuts[1:]):
        flo, fhi = bezier(points, lo)[1] - y, bezier(points, hi)[1] - y
        if abs(flo) <= 1e-9:
            roots.append(lo)
        if abs(fhi) <= 1e-9:
            roots.append(hi)
        if flo * fhi < 0:
            for _ in range(60):
                mid = (lo + hi) / 2
                fm = bezier(points, mid)[1] - y
                if flo * fm <= 0:
                    hi = mid
                else:
                    lo, flo = mid, fm
            roots.append((lo + hi) / 2)
    return sorted(set(round(t, 14) for t in roots))


def section_extent(model, y):
    xs = [bezier(ps, t)[0] for name in model["outline"]
          for ps in [curve_points(model, name)] for t in section_roots(ps, y)]
    if not xs:
        raise ValueError(f"outline does not intersect y={y}")
    return min(xs), max(xs)


def segments_intersect(a, b, c, d):
    def cross(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0])

    def on(p, q, r):
        return (min(p[0], q[0])-1e-9 <= r[0] <= max(p[0], q[0])+1e-9
                and min(p[1], q[1])-1e-9 <= r[1] <= max(p[1], q[1])+1e-9)

    ab_c, ab_d, cd_a, cd_b = cross(a,b,c), cross(a,b,d), cross(c,d,a), cross(c,d,b)
    if ab_c * ab_d < 0 and cd_a * cd_b < 0:
        return True
    return any(abs(v) <= 1e-9 and on(p,q,r) for v,p,q,r in
               ((ab_c,a,b,c), (ab_d,a,b,d), (cd_a,c,d,a), (cd_b,c,d,b)))


def validate_model(model, inputs) -> dict[str, Any]:
    """Check resulting curves independently of stored design and reference lines."""
    d = read_dimensions(inputs)
    checks = []

    def check(name, actual, expected, tolerance=TOLERANCE_MM):
        checks.append(dict(name=name, actual=actual, expected=expected,
                           tolerance=tolerance, passed=abs(actual-expected) <= tolerance))

    curves = [curve_points(model, n) for n in model["outline"]]
    if not curves or any(not math.isfinite(v) for ps in curves for p in ps for v in p):
        raise ValueError("outline must contain finite cubic curves")
    bounds = [curve_bounds(ps, 1) for ps in curves]
    check("heel_y", min(b[0] for b in bounds), 0)
    check("toe_y", max(b[1] for b in bounds), d["length"])
    check("longitudinal_length", max(b[1] for b in bounds)-min(b[0] for b in bounds), d["length"])
    sections = []
    for side in SIDES:
        for region in REGIONS:
            key = f"{side}_{region}"
            y = d[f"{key}_y"]
            lo, hi = section_extent(model, y)
            actual = -lo if side == "medial" else hi
            check(f"{key}_half_width", actual, d[f"{key}_width"])
            sections.append(dict(name=key, y=y, medial_x=lo, lateral_x=hi, width=hi-lo))
    for i, ps in enumerate(curves):
        following = curves[(i+1) % len(curves)]
        check(f"join_{i}_closure", math.dist(ps[-1], following[0]), 0, 1e-9)
        outgoing = tuple(3*(ps[3][a]-ps[2][a]) for a in (0,1))
        incoming = tuple(3*(following[1][a]-following[0][a]) for a in (0,1))
        check(f"join_{i}_tangent_difference", math.dist(outgoing, incoming), 0, 1e-9)
        check(f"join_{i}_nonzero_tangent", int(math.hypot(*outgoing) > 1e-9), 1, 0)
    # Convex-hull certificate: each side stays in its own half-plane and moves
    # strictly along y. Horizontal tangents at the two tips are allowed.
    for name, ps in zip(model["outline"], curves):
        lateral = "lateral" in name
        sign = 1 if lateral else -1
        ys = [p[1] for p in ps]
        monotone = all(sign*(b-a) >= -1e-9 for a,b in zip(ys, ys[1:]))
        half_plane = all(sign*p[0] >= -1e-9 for p in ps) and any(sign*p[0] > 0 for p in ps)
        check(f"{name}_side_and_monotonicity", int(monotone and half_plane and abs(ys[-1]-ys[0]) > 0), 1, 0)
        xs = [p[0] for p in ps]
        x_direction = 1 if xs[-1] >= xs[0] else -1
        check(f"{name}_width_monotonicity",
              int(all(x_direction*(b-a) >= -1e-9 for a,b in zip(xs, xs[1:]))), 1, 0)
    samples_per_curve = 32
    poly = [bezier(ps, i/samples_per_curve) for ps in curves for i in range(samples_per_curve)]
    segments = list(zip(poly, poly[1:] + poly[:1]))
    crossings = sum(segments_intersect(a,b,c,e)
                    for i,(a,b) in enumerate(segments) for j,(c,e) in enumerate(segments)
                    if j > i+1 and not (i == 0 and j == len(segments)-1))
    check("sampled_nonadjacent_intersections", crossings, 0, 0)
    return dict(passed=all(c["passed"] for c in checks), units="mm", checks=checks,
                sections=sections, limits=[
                    "Dimensions use cubic extrema and section roots, not landmark distances.",
                     "Join checks require matching first derivatives, not curvature continuity.",
                     "Monotone x control polygons prevent width overshoot between neighbouring landmarks.",
                    "Monotone, opposite-half-plane curves certify this construction's simple outline.",
                    "Additional intersection test uses 32 chords per curve; it is not an exact general curve test.",
                    "This top silhouette says nothing about bottom geometry, toe clearance, or shoe fit."])
