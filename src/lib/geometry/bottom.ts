import {
  InputError,
  type BottomModel,
  type ProjectedBottom,
  type PointKind,
  type Cubic,
  type Vec2,
  type ValidationReport,
} from "./types";
import {
  number,
  gap,
  radians,
  degrees,
  bezier,
  derivativeRoots,
  curveBounds,
  distance,
  checker,
  sum,
  ulp,
  round,
  arcLengthBounds,
} from "./math";

export const PROFILE = [
  "bottom_heel_seat",
  "bottom_waist",
  "bottom_forepart_blend",
  "bottom_forepart_ramp",
] as const;
export function readBottom(
  length: number,
  d: ProjectedBottom,
): [number, number] {
  number("top design.length", length, 0.01);
  for (const [k, v] of Object.entries(d))
    number(k, v, 0, k === "seat_inclination_deg" ? 90 : 10000);
  if (d.seat_inclination_deg >= 90)
    throw new InputError("seat_inclination_deg must be less than 90");
  const {
    heel_height: h,
    seat_projected_length: s,
    contact_forward: c,
    forepart_blend_length: b,
  } = d;
  if (![s, c - s, b, length - c - b].every(gap))
    throw new InputError(
      "require 0 < seat_projected_length < contact_forward; forepart_blend_length and projected_length-contact_forward-forepart_blend_length must each be >= 0.01 mm (0.01 mm gaps)",
    );
  const m = -Math.tan(radians(d.seat_inclination_deg)),
    front = h + m * s;
  if (!Number.isFinite(front) || front < 0)
    throw new InputError(
      "seat front: B = heel_height - seat_projected_length*tan(seat_inclination_deg) must be >= 0",
    );
  if (front + (m * (c - s)) / 3 < 0)
    throw new InputError(
      "bottom_waist_handle_start: B - (contact_forward-seat_projected_length)*tan(seat_inclination_deg)/3 must be >= 0",
    );
  return [m, front];
}
export function buildBottom(length: number, d: ProjectedBottom): BottomModel {
  const [m, front] = readBottom(length, d),
    {
      heel_height: h,
      toe_spring: t,
      seat_projected_length: s,
      contact_forward: c,
      forepart_blend_length: b,
    } = d,
    k = t / (length - c - b / 2);
  const model: BottomModel = {
    schema_version: 2,
    kind: "bottom_profile",
    units: "mm",
    axes: ["y", "z"],
    closed: false,
    points: {},
    curves: {},
    profile: [...PROFILE],
    reference_lines: {},
    construction_lines: {},
    dimensions: {},
    source:
      "Made-up design values; provisional shared y range, not foot measurements",
  };
  const point = (
    name: string,
    y: number,
    z: number,
    kind: PointKind = "landmark",
  ) => {
    model.points[name] = { y, z, kind };
  };
  point("bottom_heel_rear", 0, h);
  point("bottom_seat_front", s, front);
  point("bottom_forepart_contact", c, 0);
  point("bottom_forepart_blend_end", c + b, (k * b) / 2);
  point("bottom_toe_end", length, t);
  point("bottom_heel_ground", 0, 0, "reference");
  point("bottom_toe_ground", length, 0, "reference");
  point("bottom_seat_horizontal_front", s, h, "reference");
  point("bottom_forepart_blend_ground_end", c + b, 0, "reference");
  const endpoints = [
      "bottom_heel_rear",
      "bottom_seat_front",
      "bottom_forepart_contact",
      "bottom_forepart_blend_end",
      "bottom_toe_end",
    ],
    slopes: Vec2[] = [
      [m, m],
      [m, 0],
      [0, k],
      [k, k],
    ];
  PROFILE.forEach((name, i) => {
    const start = endpoints[i]!,
      end = endpoints[i + 1]!,
      p = model.points[start]!,
      q = model.points[end]!,
      interval = q.y - p.y,
      [u, v] = slopes[i]!,
      hs = name + "_handle_start",
      he = name + "_handle_end";
    point(hs, p.y + interval / 3, p.z + (u * interval) / 3, "handle");
    point(he, q.y - interval / 3, q.z - (v * interval) / 3, "handle");
    model.curves[name] = { start, control1: hs, control2: he, end };
    for (const [suffix, a, e] of [
      ["start_to_handle_start", start, hs],
      ["handle_start_to_handle_end", hs, he],
      ["handle_end_to_end", he, end],
    ] as const)
      model.construction_lines[name + "_" + suffix] = { start: a, end: e };
  });
  model.reference_lines = {
    bottom_ground_projected_length: {
      start: "bottom_heel_ground",
      end: "bottom_toe_ground",
    },
    bottom_heel_height: {
      start: "bottom_heel_ground",
      end: "bottom_heel_rear",
    },
    bottom_toe_spring: { start: "bottom_toe_ground", end: "bottom_toe_end" },
    bottom_seat_horizontal: {
      start: "bottom_heel_rear",
      end: "bottom_seat_horizontal_front",
    },
    bottom_seat_chord: { start: "bottom_heel_rear", end: "bottom_seat_front" },
    bottom_contact_forward: {
      start: "bottom_heel_ground",
      end: "bottom_forepart_contact",
    },
    bottom_forepart_blend_projection: {
      start: "bottom_forepart_contact",
      end: "bottom_forepart_blend_ground_end",
    },
  };
  const specs: [string, number, "mm" | "deg", string, string][] = [
    [
      "projected_length",
      length,
      "mm",
      "bottom_ground_projected_length",
      "Shared top design.length: forward separation, not arc length",
    ],
    [
      "heel_height",
      h,
      "mm",
      "bottom_heel_height",
      "Rear guide endpoint height above z=0",
    ],
    [
      "toe_spring",
      t,
      "mm",
      "bottom_toe_spring",
      "Toe guide endpoint height above z=0",
    ],
    [
      "seat_projected_length",
      s,
      "mm",
      "bottom_seat_horizontal",
      "Horizontal seat projection",
    ],
    [
      "seat_inclination_deg",
      d.seat_inclination_deg,
      "deg",
      "bottom_seat_chord",
      "Downward-forward seat angle from horizontal",
    ],
    [
      "contact_forward",
      c,
      "mm",
      "bottom_contact_forward",
      "Forward position of designated contact guide point",
    ],
    [
      "forepart_blend_length",
      b,
      "mm",
      "bottom_forepart_blend_projection",
      "Forward length of the rounded contact transition",
    ],
  ];
  for (const [name, expected, units, reference_line, definition] of specs)
    model.dimensions[name] = { expected, units, reference_line, definition };
  return model;
}
export function bottomCurvePoints(model: BottomModel, name: string): Cubic {
  const c = model.curves[name];
  if (!c) throw new InputError("Unknown bottom curve");
  const get = (n: string): Vec2 => {
    const p = model.points[n];
    if (!p) throw new InputError("Missing bottom point");
    return [p.y, p.z];
  };
  return [get(c.start), get(c.control1), get(c.control2), get(c.end)];
}
function coordinateRoundoff(p: Cubic, slope: number): Vec2 {
  const y = 4 * Math.max(...p.map((p) => ulp(p[0]))),
    z = 4 * Math.max(...p.map((p) => ulp(p[1]))) + Math.abs(slope) * y;
  return [y, z];
}
export function validateBottom(
  model: BottomModel,
  length: number,
  d: ProjectedBottom,
): ValidationReport {
  if (
    model.schema_version !== 2 ||
    model.kind !== "bottom_profile" ||
    model.units !== "mm" ||
    model.closed !== false ||
    JSON.stringify(model.axes) !== '["y","z"]'
  )
    throw new InputError(
      "bottom model requires schema_version 2, units mm, axes ['y', 'z'], kind bottom_profile, closed false",
    );
  const [m, front] = readBottom(length, d);
  if (JSON.stringify(model.profile) !== JSON.stringify(PROFILE))
    throw new InputError(
      "profile must contain the four specified curves in order",
    );
  const curves = model.profile.map((n) => bottomCurvePoints(model, n));
  curves.forEach((ps) =>
    ps.forEach((p) =>
      p.forEach((v) => number("resulting coordinate", v, -10000)),
    ),
  );
  const { checks, check, flag } = checker(0.1, "mm"),
    ys = curves.map((p) => curveBounds(p, 0)),
    zs = curves.map((p) => curveBounds(p, 1)),
    first = curves[0]!,
    last = curves[3]!;
  check("rear_y", first[0][0], 0);
  check(
    "projected_length",
    Math.max(...ys.map((b) => b[1])) - Math.min(...ys.map((b) => b[0])),
    length,
  );
  check("toe_forward", last[3][0], length);
  check("heel_height", first[0][1], d.heel_height);
  check("toe_spring", last[3][1], d.toe_spring);
  check(
    "seat_projected_length",
    first[3][0] - first[0][0],
    d.seat_projected_length,
  );
  check("contact_forward", curves[1]![3][0], d.contact_forward);
  check(
    "forepart_blend_length",
    curves[2]![3][0] - curves[2]![0][0],
    d.forepart_blend_length,
  );
  check("contact_height", curves[1]![3][1], 0);
  check("minimum_height", Math.min(...zs.map((b) => b[0])), 0);
  flag("no_below_ground", Math.min(...zs.map((b) => b[0])) >= -1e-9);
  const derivative = (axis: 0 | 1) =>
    sum(
      [0.25, 0.5, 0.25].map(
        (w, i) => 3 * w * (first[i + 1]![axis] - first[i]![axis]),
      ),
    );
  check(
    "seat_inclination_deg",
    degrees(Math.atan2(-derivative(1), derivative(0))),
    d.seat_inclination_deg,
    0.001,
    "deg",
  );
  check(
    "seat_vertical_drop",
    first[0][1] - first[3][1],
    -m * d.seat_projected_length,
  );
  const c = d.contact_forward,
    b = d.forepart_blend_length,
    k = d.toe_spring / (length - c - b / 2),
    endpoints: Vec2[] = [
      [0, d.heel_height],
      [d.seat_projected_length, front],
      [c, 0],
      [c + b, (k * b) / 2],
      [length, d.toe_spring],
    ],
    slopes: Vec2[] = [
      [m, m],
      [m, 0],
      [0, k],
      [k, k],
    ],
    tangents: number[][] = [],
    tangentErrors: number[][] = [];
  curves.forEach((ps, i) => {
    const name = PROFILE[i]!,
      p = endpoints[i]!,
      q = endpoints[i + 1]!,
      [u, v] = slopes[i]!,
      interval = q[0] - p[0];
    const expected: Cubic = [
      p,
      [p[0] + interval / 3, p[1] + (u * interval) / 3],
      [q[0] - interval / 3, q[1] - (v * interval) / 3],
      q,
    ];
    (["start", "control1", "control2", "end"] as const).forEach((key, j) =>
      check(
        model.curves[name]![key] + "_position_error",
        distance(ps[j]!, expected[j]!),
        0,
      ),
    );
    flag(
      name + "_strictly_forward",
      ps.slice(1).every((q, j) => q[0] > ps[j]![0]),
    );
    flag(
      name + "_linear_y",
      [1, 2].every(
        (j) =>
          Math.abs(ps[j]![0] - (ps[0][0] + (j * (ps[3][0] - ps[0][0])) / 3)) <=
          1e-9,
      ),
    );
    const [ye, ze] = coordinateRoundoff(ps, Math.max(Math.abs(u), Math.abs(v))),
      ends: number[] = [],
      errors: number[] = [];
    for (const [label, a, e, wanted] of [
      ["start", ps[0], ps[1], u],
      ["end", ps[2], ps[3], v],
    ] as const) {
      const dy = e[0] - a[0],
        dz = e[1] - a[1],
        slope = dy > 0 ? dz / dy : Infinity,
        denom = dy - 2 * ye,
        error =
          denom > 0
            ? (2 * ze + 2 * Math.abs(wanted) * ye) / denom + 4 * ulp(wanted)
            : 0;
      flag(name + "_" + label + "_nonzero_forward_tangent", dy > 0);
      check(
        name + "_" + label + "_slope",
        slope,
        wanted,
        Math.max(1e-9, error),
        "dz/dy",
      );
      ends.push(slope);
      errors.push(error);
    }
    tangents.push(ends);
    tangentErrors.push(errors);
  });
  for (let i = 0; i < 3; i++) {
    check(
      PROFILE[i] + "_join_gap",
      distance(curves[i]![3], curves[i + 1]![0]),
      0,
      1e-9,
    );
    check(
      PROFILE[i] + "_join_slope_difference",
      Math.abs(tangents[i]![1]! - tangents[i + 1]![0]!),
      0,
      Math.max(1e-9, tangentErrors[i]![1]! + tangentErrors[i + 1]![0]!),
      "dz/dy",
    );
  }
  for (const index of [2, 3]) {
    const ps = curves[index]!,
      [ye, ze] = coordinateRoundoff(ps, k),
      second = [0, 1].map((i) => ps[i + 2]![1] - 2 * ps[i + 1]![1] + ps[i]![1]);
    check(
      PROFILE[index] + "_nonnegative_slope",
      Math.min(0, ...ps.slice(1).map((q, i) => q[1] - ps[i]![1])),
      0,
      Math.max(1e-9, 2 * ze),
    );
    if (index === 2) {
      check(
        "forepart_blend_convex_up",
        Math.min(0, ...second),
        0,
        Math.max(1e-9, 4 * ze),
      );
      check(
        "forepart_blend_quadratic",
        Math.abs(second[1]! - second[0]!),
        0,
        Math.max(1e-9, 8 * ze),
      );
    } else
      for (const axis of [0, 1] as const)
        check(
          "forepart_ramp_second_difference_" + "yz"[axis],
          Math.max(
            ...[0, 1].map((i) =>
              Math.abs(ps[i + 2]![axis] - 2 * ps[i + 1]![axis] + ps[i]![axis]),
            ),
          ),
          0,
          Math.max(1e-9, 4 * (axis === 0 ? ye : ze)),
        );
  }
  flag(
    "positive_toe_spring_has_inclined_end",
    d.toe_spring === 0 || tangents[3]![1]! > 0,
  );
  const intervals: { curve: string; start_y: number; end_y: number }[] = [],
    contacts: number[] = [];
  curves.forEach((ps, i) => {
    if (ps.every((p) => p[1] === 0))
      intervals.push({
        curve: PROFILE[i]!,
        start_y: ps[0][0],
        end_y: ps[3][0],
      });
    else
      for (const t of [0, ...derivativeRoots(ps.map((p) => p[1])), 1])
        if (bezier(ps, t)[1] === 0) contacts.push(bezier(ps, t)[0]);
  });
  const isolated = [
    ...new Set(
      contacts
        .filter((y) => !intervals.some((v) => v.start_y <= y && y <= v.end_y))
        .map((y) => round(y, 10)),
    ),
  ].sort((a, b) => a - b);
  flag(
    "designated_station_has_ground_contact",
    intervals.some((v) => v.start_y - 1e-9 <= c && c <= v.end_y + 1e-9) ||
      isolated.some((y) => Math.abs(y - c) <= 1e-9),
  );
  const bounds = curves.map((ps) => arcLengthBounds(ps, 0.01 / curves.length)),
    lower = sum(bounds.map((v) => v[0])),
    upper = sum(bounds.map((v) => v[1]));
  return {
    passed: checks.every((c) => c.passed),
    units: "mm",
    checks,
    ground_contact: { intervals, isolated_y: isolated },
    bottom_arc_length: {
      actual: (lower + upper) / 2,
      lower_bound: lower,
      upper_bound: upper,
      uncertainty_mm: (upper - lower) / 2,
      units: "mm",
      derived: true,
    },
    limits: [
      "0.1 mm and 0.001 degree tolerances are software checks, not fit allowances.",
      "Arc bounds use recursive chord/control-polygon bounds; total gap <=0.01 mm, depth limit 30.",
      "Strict forward curves and closed internal joins form an open graph without self-crossings.",
      "C1 means matching dz/dy, not matching local-parameter derivative magnitudes or curvature.",
      "Shared top length is provisional alignment, not a validated spatial correspondence.",
      "No 3D bottom, sole, posture transformation, toe-clearance or fit prediction.",
    ],
  };
}
