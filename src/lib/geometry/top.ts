import {
  SIDES,
  REGIONS,
  InputError,
  type TopModel,
  type Cubic,
  type Vec2,
  type PointKind,
} from "./types";
import {
  gap,
  number,
  bezier,
  curveBounds,
  derivativeRoots,
  distance,
  checker,
  round,
} from "./math";

export function buildTop(d: Record<string, number>): TopModel {
  const required = [
    "length",
    ...SIDES.flatMap((s) =>
      REGIONS.flatMap((r) => [`${s}_${r}_y`, `${s}_${r}_width`]),
    ),
  ];
  if (
    Object.keys(d).length !== required.length ||
    required.some((k) => !(k in d))
  )
    throw new InputError(
      "design must contain length and each side/region's y and width",
    );
  for (const [k, v] of Object.entries(d)) number(k, v, 0.01);
  for (const s of SIDES) {
    const ys = [0, ...REGIONS.map((r) => d[`${s}_${r}_y`]!), d.length!];
    if (ys.slice(1).some((v, i) => !gap(v - ys[i]!)))
      throw new InputError(
        `${s}: require heel < waist < ball < toe < length, with 0.01 mm gaps`,
      );
  }
  const model: TopModel = {
    schema_version: 1,
    units: "mm",
    points: {},
    curves: {},
    reference_lines: {},
    outline: [],
    dimensions: {},
    design: { ...d },
    source: "made-up design dimensions; not measured foot data",
  };
  const point = (
    name: string,
    x: number,
    y: number,
    kind: PointKind = "landmark",
  ) => {
    model.points[name] = { x, y, kind };
  };
  point("heel_tip", 0, 0);
  point("toe_tip", 0, d.length!);
  for (const side of SIDES)
    for (const region of REGIONS) {
      const name = `${side}_${region}`,
        y = d[`${name}_y`]!;
      point(name, (side === "medial" ? -1 : 1) * d[`${name}_width`]!, y);
      point(`${name}_center`, 0, y, "reference");
      model.reference_lines[`${name}_half_width`] = {
        start: `${name}_center`,
        end: name,
      };
    }
  model.reference_lines.length_axis = { start: "heel_tip", end: "toe_tip" };
  model.dimensions.length = {
    kind: "length",
    axis: "y",
    start_y: 0,
    end_y: d.length!,
    expected: d.length!,
    reference_line: "length_axis",
  };
  for (const side of SIDES)
    for (const region of REGIONS) {
      const name = `${side}_${region}_half_width`;
      model.dimensions[name] = {
        kind: "side_extent",
        axis: "x",
        side,
        station_y: d[`${side}_${region}_y`]!,
        expected: d[`${side}_${region}_width`]!,
        reference_line: name,
        definition: "Positive distance from x=0 to this side at station_y",
      };
    }
  const order = [
    "heel_tip",
    ...REGIONS.map((r) => `lateral_${r}`),
    "toe_tip",
    ...[...REGIONS].reverse().map((r) => `medial_${r}`),
  ];
  const tangents: Record<string, Vec2> = {
    heel_tip: [1.5 * Math.min(d.medial_heel_width!, d.lateral_heel_width!), 0],
    toe_tip: [-1.5 * Math.min(d.medial_toe_width!, d.lateral_toe_width!), 0],
  };
  for (const side of ["lateral", "medial"] as const) {
    const direction = side === "lateral" ? 1 : -1;
    const ys = [0, ...REGIONS.map((r) => d[`${side}_${r}_y`]!), d.length!],
      widths = [0, ...REGIONS.map((r) => d[`${side}_${r}_width`]!), 0];
    REGIONS.forEach((r, j) => {
      const i = j + 1,
        before = ys[i]! - ys[i - 1]!,
        after = ys[i + 1]! - ys[i]!,
        dwBefore = widths[i]! - widths[i - 1]!,
        dwAfter = widths[i + 1]! - widths[i]!,
        a = dwBefore / before,
        b = dwAfter / after;
      let slope = 0;
      if (a * b > 0) {
        const w1 = 2 * after + before,
          w2 = after + 2 * before;
        slope = (w1 + w2) / (w1 / a + w2 / b);
      }
      let reach = 1.5 * Math.min(before, after);
      if (slope)
        reach = Math.min(
          reach,
          (1.5 * Math.min(Math.abs(dwBefore), Math.abs(dwAfter))) /
            Math.abs(slope),
        );
      tangents[`${side}_${r}`] = [slope * reach, direction * reach];
    });
  }
  order.forEach((start, i) => {
    const end = order[(i + 1) % order.length]!,
      name = `${start}_to_${end}`,
      c1 = `${name}_handle_start`,
      c2 = `${name}_handle_end`,
      a = model.points[start]!,
      b = model.points[end]!,
      ta = tangents[start]!,
      tb = tangents[end]!;
    point(c1, a.x + ta[0] / 3, a.y + ta[1] / 3, "handle");
    point(c2, b.x - tb[0] / 3, b.y - tb[1] / 3, "handle");
    model.curves[name] = { start, control1: c1, control2: c2, end };
    model.outline.push(name);
  });
  return model;
}
export function topCurvePoints(model: TopModel, name: string): Cubic {
  const c = model.curves[name];
  if (!c) throw new InputError("Unknown top curve");
  const get = (n: string): Vec2 => {
    const p = model.points[n];
    if (!p) throw new InputError("Missing top point");
    return [p.x, p.y];
  };
  return [get(c.start), get(c.control1), get(c.control2), get(c.end)];
}
export function sectionRoots(p: Cubic, y: number): number[] {
  const cuts = [0, ...derivativeRoots(p.map((p) => p[1])), 1],
    roots: number[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    let lo = cuts[i]!,
      hi = cuts[i + 1]!,
      flo = bezier(p, lo)[1] - y;
    const fhi = bezier(p, hi)[1] - y;
    if (Math.abs(flo) <= 1e-9) roots.push(lo);
    if (Math.abs(fhi) <= 1e-9) roots.push(hi);
    if (flo * fhi < 0) {
      for (let j = 0; j < 60; j++) {
        const mid = (lo + hi) / 2,
          fm = bezier(p, mid)[1] - y;
        if (flo * fm <= 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      roots.push((lo + hi) / 2);
    }
  }
  return [...new Set(roots.map((t) => round(t, 14)))].sort((a, b) => a - b);
}
export function sectionExtent(model: TopModel, y: number): Vec2 {
  const xs = model.outline.flatMap((n) => {
    const p = topCurvePoints(model, n);
    return sectionRoots(p, y).map((t) => bezier(p, t)[0]);
  });
  if (!xs.length) throw new InputError(`outline does not intersect y=${y}`);
  return [Math.min(...xs), Math.max(...xs)];
}
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const on = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.min(p[0], q[0]) - 1e-9 <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) + 1e-9 &&
    Math.min(p[1], q[1]) - 1e-9 <= r[1] &&
    r[1] <= Math.max(p[1], q[1]) + 1e-9;
  const ac = cross(a, b, c),
    ad = cross(a, b, d),
    ca = cross(c, d, a),
    cb = cross(c, d, b);
  return (
    (ac * ad < 0 && ca * cb < 0) ||
    (Math.abs(ac) <= 1e-9 && on(a, b, c)) ||
    (Math.abs(ad) <= 1e-9 && on(a, b, d)) ||
    (Math.abs(ca) <= 1e-9 && on(c, d, a)) ||
    (Math.abs(cb) <= 1e-9 && on(c, d, b))
  );
}
export function validateTop(model: TopModel, d: Record<string, number>) {
  const { checks, check } = checker(),
    curves = model.outline.map((n) => topCurvePoints(model, n));
  if (
    !curves.length ||
    curves.some((ps) => ps.some((p) => p.some((v) => !Number.isFinite(v))))
  )
    throw new InputError("outline must contain finite cubic curves");
  const bounds = curves.map((p) => curveBounds(p, 1)),
    low = Math.min(...bounds.map((b) => b[0])),
    high = Math.max(...bounds.map((b) => b[1]));
  check("heel_y", low, 0);
  check("toe_y", high, d.length!);
  check("longitudinal_length", high - low, d.length!);
  const sections = [];
  for (const side of SIDES)
    for (const r of REGIONS) {
      const name = `${side}_${r}`,
        y = d[`${name}_y`]!,
        [lo, hi] = sectionExtent(model, y);
      check(
        `${name}_half_width`,
        side === "medial" ? -lo : hi,
        d[`${name}_width`]!,
      );
      sections.push({ name, y, medial_x: lo, lateral_x: hi, width: hi - lo });
    }
  curves.forEach((ps, i) => {
    const following = curves[(i + 1) % curves.length]!;
    check(`join_${i}_closure`, distance(ps[3], following[0]), 0, 1e-9);
    const out: Vec2 = [3 * (ps[3][0] - ps[2][0]), 3 * (ps[3][1] - ps[2][1])],
      incoming: Vec2 = [
        3 * (following[1][0] - following[0][0]),
        3 * (following[1][1] - following[0][1]),
      ];
    check(`join_${i}_tangent_difference`, distance(out, incoming), 0, 1e-9);
    check(`join_${i}_nonzero_tangent`, Number(Math.hypot(...out) > 1e-9), 1, 0);
  });
  model.outline.forEach((name, i) => {
    const ps = curves[i]!,
      sign = name.includes("lateral") ? 1 : -1,
      ys = ps.map((p) => p[1]);
    const monotone = ys.slice(1).every((v, j) => sign * (v - ys[j]!) >= -1e-9),
      half =
        ps.every((p) => sign * p[0] >= -1e-9) &&
        ps.some((p) => sign * p[0] > 0);
    check(
      name + "_side_and_monotonicity",
      Number(monotone && half && Math.abs(ys[3]! - ys[0]!) > 0),
      1,
      0,
    );
    const xs = ps.map((p) => p[0]),
      direction = xs[3]! >= xs[0]! ? 1 : -1;
    check(
      name + "_width_monotonicity",
      Number(xs.slice(1).every((v, j) => direction * (v - xs[j]!) >= -1e-9)),
      1,
      0,
    );
  });
  const poly = curves.flatMap((p) =>
    Array.from({ length: 32 }, (_, i) => bezier(p, i / 32)),
  );
  let crossings = 0;
  for (let i = 0; i < poly.length; i++)
    for (let j = i + 2; j < poly.length; j++)
      if (
        !(i === 0 && j === poly.length - 1) &&
        segmentsIntersect(
          poly[i]!,
          poly[(i + 1) % poly.length]!,
          poly[j]!,
          poly[(j + 1) % poly.length]!,
        )
      )
        crossings++;
  check("sampled_nonadjacent_intersections", crossings, 0, 0);
  return {
    passed: checks.every((c) => c.passed),
    units: "mm" as const,
    checks,
    sections,
    limits: [
      "Dimensions use cubic extrema and section roots, not landmark distances.",
      "Join checks require matching first derivatives, not curvature continuity.",
      "Monotone x control polygons prevent width overshoot between neighbouring landmarks.",
      "Monotone, opposite-half-plane curves certify this construction's simple outline.",
      "Additional intersection test uses 32 chords per curve; it is not an exact general curve test.",
      "This top silhouette says nothing about bottom geometry, toe clearance, or shoe fit.",
    ],
  };
}
