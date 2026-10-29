import {
  SIDES,
  REGIONS,
  InputError,
  type ContourInput,
  type TopControls,
  type BottomControls,
  type Station,
  type Cubic,
  type Vec2,
  type BottomModel,
  type ProjectedBottom,
  type LegacyLastState,
  type ValidationReport,
} from "./types";
import {
  number,
  gap,
  radians,
  arc,
  prefix,
  split,
  bezier,
  ulp,
  nextafter,
  fsum,
  sum,
  arcLengthBounds,
} from "./math";
import { buildTop, validateTop } from "./top";
import { buildBottom, bottomCurvePoints, validateBottom } from "./bottom";

export const STATIONS: Station[] = SIDES.flatMap((s) =>
  REGIONS.map((r) => `${s}_${r}` as const),
);
const BOTTOM_FIELDS = [
  "heel_height",
  "toe_spring",
  "seat_arc_length",
  "seat_inclination_deg",
  "contact_s",
  "blend_arc_length",
] as const;
const ARC_BUDGET = 1e-5;
export function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function keys(
  v: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(v).length === expected.length &&
    expected.every((k) => Object.hasOwn(v, k))
  );
}
export function jsonValues(v: unknown, depth = 0): void {
  if (depth > 64) throw new InputError("JSON nesting is too deep");
  if (typeof v === "number" && !Number.isFinite(v))
    throw new InputError("JSON numbers must be finite");
  if (Array.isArray(v)) v.forEach((v) => jsonValues(v, depth + 1));
  else if (record(v)) Object.values(v).forEach((v) => jsonValues(v, depth + 1));
}
function assertTop(v: unknown): asserts v is TopControls {
  if (
    !record(v) ||
    !keys(
      v,
      STATIONS.flatMap((n) => [n + "_s", n + "_width"]),
    )
  )
    throw new InputError(
      "top requires each named region's contour station _s and side _width",
    );
  for (const [k, value] of Object.entries(v)) number(k, value, 0.01);
}
function assertBottom(v: unknown): asserts v is BottomControls {
  if (!record(v) || !keys(v, BOTTOM_FIELDS))
    throw new InputError(
      "bottom requires heel_height, toe_spring, seat_arc_length, seat_inclination_deg, contact_s, blend_arc_length",
    );
  for (const [k, value] of Object.entries(v))
    number(k, value, 0, k === "seat_inclination_deg" ? 90 : 10000);
}
export function parseContourInput(value: unknown): ContourInput {
  jsonValues(value);
  if (record(value) && ("top" in value || "bottom" in value))
    throw new InputError(
      "Obsolete projected {top,bottom} format; use one contour_last input document",
    );
  if (
    !record(value) ||
    !keys(value, [
      "schema_version",
      "kind",
      "units",
      "description",
      "design",
    ]) ||
    value.schema_version !== 1 ||
    value.kind !== "contour_last" ||
    value.units !== "mm" ||
    typeof value.description !== "string"
  )
    throw new InputError(
      "Expected contour_last schema_version 1, units mm, description and design",
    );
  const d = value.design;
  if (!record(d) || !keys(d, ["last_length", "top", "bottom"]))
    throw new InputError("design requires exactly last_length, top and bottom");
  const a = number("last_length", d.last_length, 0.01),
    top = d.top,
    bottom = d.bottom;
  assertTop(top);
  assertBottom(bottom);
  for (const side of SIDES) {
    const stations = [0, ...REGIONS.map((r) => top[`${side}_${r}_s`]), a];
    if (stations.slice(1).some((v, i) => !gap(v - stations[i]!)))
      throw new InputError(
        `${side} contour stations must satisfy 0 < heel_s < waist_s < ball_s < toe_s < last_length, with 0.01 mm gaps`,
      );
  }
  if (bottom.seat_inclination_deg >= 90)
    throw new InputError("seat_inclination_deg must be less than 90");
  const { seat_arc_length: s, contact_s: c, blend_arc_length: j } = bottom;
  if (![s, c - s, j, a - c - j].every(gap))
    throw new InputError(
      "Require 0 < seat_arc_length < contact_s < contact_s+blend_arc_length < last_length with 0.01 mm arc gaps",
    );
  return {
    schema_version: 1,
    kind: "contour_last",
    units: "mm",
    description: value.description,
    design: { last_length: a, top: { ...top }, bottom: { ...bottom } },
  };
}
function forepart(
  total: number,
  contact: number,
  blendArc: number,
  toe: number,
): [number, number] {
  const rampArc = total - contact - blendArc;
  if (toe >= blendArc + rampArc)
    throw new InputError(
      "toe_spring must be smaller than the available forepart arc last_length-contact_s",
    );
  const projections = (k: number): [number, number] => {
    const q =
      k < 1e-5
        ? 1 + (k * k) / 6 - k ** 4 / 40
        : (Math.hypot(1, k) + Math.asinh(k) / k) / 2;
    return [blendArc / q, rampArc / Math.hypot(1, k)];
  };
  if (toe === 0) return [blendArc, rampArc];
  let lo = 0,
    hi = 1,
    found = false;
  for (let i = 0; i < 64; i++) {
    const [b, r] = projections(hi);
    if (hi * (b / 2 + r) >= toe) {
      found = true;
      break;
    }
    hi *= 2;
  }
  if (!found)
    throw new InputError(
      "toe_spring forepart solve could not bracket a finite slope",
    );
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2,
      [b, r] = projections(mid);
    if (mid * (b / 2 + r) < toe) lo = mid;
    else hi = mid;
  }
  const [b, r] = projections((lo + hi) / 2);
  if (!gap(b) || !gap(r))
    throw new InputError(
      "forepart arc/height conflict: projected blend and ramp must each retain 0.01 mm",
    );
  return [b, r];
}
function bottomInputs(
  d: BottomControls,
  seat: number,
  waist: number,
  blend: number,
  ramp: number,
): [number, ProjectedBottom] {
  return [
    fsum([seat, waist, blend, ramp]),
    {
      heel_height: d.heel_height,
      toe_spring: d.toe_spring,
      seat_projected_length: seat,
      seat_inclination_deg: d.seat_inclination_deg,
      contact_forward: seat + waist,
      forepart_blend_length: blend,
      ...(d.arch_start_reach_ratio === undefined
        ? {}
        : { arch_start_reach_ratio: d.arch_start_reach_ratio }),
      ...(d.arch_contact_reach_ratio === undefined
        ? {}
        : { arch_contact_reach_ratio: d.arch_contact_reach_ratio }),
    },
  ];
}
export function solveBottom(
  total: number,
  d: BottomControls,
): [BottomModel, number, ProjectedBottom] {
  const s = d.seat_arc_length,
    c = d.contact_s,
    j = d.blend_arc_length,
    angle = radians(d.seat_inclination_deg),
    seat = s * Math.cos(angle),
    front = d.heel_height - s * Math.sin(angle);
  if (front < 0)
    throw new InputError(
      "seat front: B = heel_height - seat_arc_length*sin(seat_inclination_deg) must be >= 0",
    );
  if (!gap(seat))
    throw new InputError(
      "seat arc/angle conflict: seat projection must retain 0.01 mm",
    );
  const [blend, ramp] = forepart(total, c, j, d.toe_spring),
    target = c - s,
    slope = Math.tan(angle),
    actualFront = d.heel_height - slope * seat;
  const startReach = d.arch_start_reach_ratio ?? 1 / 3;
  let upper = target;
  if (slope) {
    upper = Math.min(
      upper,
      nextafter(
        startReach === 1 / 3
          ? (3 * actualFront) / slope
          : actualFront / (slope * startReach),
        0,
      ),
    );
    const limit = upper,
      budget =
        8 *
        (ulp(seat) +
          ulp(upper) +
          ulp(seat + upper) +
          ulp(actualFront) /
            (startReach === 1 / 3 ? slope : slope * startReach));
    let legal = false;
    for (let i = 0; i < 32; i++) {
      if (
        actualFront -
          (startReach === 1 / 3
            ? (slope * (seat + upper - seat)) / 3
            : slope * startReach * (seat + upper - seat)) >=
        0
      ) {
        legal = true;
        break;
      }
      upper = nextafter(upper - Math.max(ulp(upper), ulp(seat + upper)), 0);
      if (limit - upper > budget)
        throw new InputError(
          "waist upper bracket cannot satisfy the nonnegative-handle rule within arithmetic roundoff",
        );
    }
    if (!legal)
      throw new InputError(
        "waist upper bracket could not be made legal within 32 ulp retreats",
      );
  }
  let lower = 0.01;
  if (upper < lower) {
    if (gap(upper)) lower = upper;
    else
      throw new InputError(
        "waist arc/vertical-drop/seat-angle conflict: no nonnegative-handle projection >= 0.01 mm",
      );
  }
  const candidate = (
    w: number,
  ): [number, BottomModel, number, ProjectedBottom] => {
    const [length, inputs] = bottomInputs(d, seat, w, blend, ramp),
      model = buildBottom(length, inputs);
    return [
      arc(bottomCurvePoints(model, "bottom_waist")),
      model,
      length,
      inputs,
    ];
  };
  const lowArc = candidate(lower)[0],
    highArc = candidate(upper)[0];
  if (target < lowArc - ARC_BUDGET || target > highArc + ARC_BUDGET)
    throw new InputError(
      "waist arc/vertical-drop/seat-angle conflict: requested contact_s-seat_arc_length is unattainable without changing regions",
    );
  for (let i = 0; i < 64; i++) {
    const mid = (lower + upper) / 2,
      [actual, model, length, inputs] = candidate(mid);
    if (Math.abs(actual - target) <= 2e-5) return [model, length, inputs];
    if (actual < target) lower = mid;
    else upper = mid;
  }
  throw new InputError("waist arc solve did not converge within 64 steps");
}
function straightArc(p: Cubic, index: number): number | undefined {
  const actuallyFlat = p.every((q) => q[1] === p[0][1]);
  if (index !== 0 && index !== 3 && !actuallyFlat) return;
  const dy = p[3][0] - p[0][0],
    dz = p[3][1] - p[0][1];
  if (dy <= 0) return;
  const error =
    8 *
    (Math.max(...p.map((p) => ulp(p[1]))) +
      Math.abs(dz / dy) * Math.max(...p.map((p) => ulp(p[0]))));
  if (
    p
      .slice(1, -1)
      .some(
        (q) =>
          Math.abs(q[1] - (p[0][1] + (dz * (q[0] - p[0][0])) / dy)) > error,
      )
  )
    return;
  return Math.hypot(dy, dz);
}
/** Evaluate actual bottom arc station s as [posed y, z], not a Bézier t fraction. */
export function pointAtStation(
  curves: Cubic[],
  lengths: number[],
  station: number,
  total = sum(lengths),
): Vec2 {
  const measuredTotal = sum(lengths);
  if (
    curves.length === 0 ||
    curves.length !== lengths.length ||
    lengths.some((length) => !Number.isFinite(length) || length <= 0) ||
    !Number.isFinite(total) ||
    !Number.isFinite(station) ||
    station < 0 ||
    station > total ||
    Math.abs(measuredTotal - total) > 0.01
  )
    throw new InputError("contour station is outside the resulting guide");
  if (station === 0) return [...curves[0]![0]];
  // The accepted solve's measured total may differ from the target by its
  // existing numerical tolerance. Anchor exact target endpoints, never rescale s.
  if (station === total) return [...curves.at(-1)![3]];
  let offset = 0;
  for (let i = 0; i < curves.length; i++) {
    const p = curves[i]!,
      length = lengths[i]!;
    if (station <= offset + length || i === curves.length - 1) {
      const local = Math.max(0, Math.min(length, station - offset));
      if (local === 0) return [...p[0]];
      if (local === length) return [...p[3]];
      const line = straightArc(p, i);
      if (line !== undefined)
        return [
          p[0][0] + (local * (p[3][0] - p[0][0])) / line,
          p[0][1] + (local * (p[3][1] - p[0][1])) / line,
        ];
      let lo = 0,
        hi = 1;
      for (let j = 0; j < 48; j++) {
        const t = (lo + hi) / 2,
          measured = arc(prefix(p, t), 1e-7),
          ylo = bezier(p, lo)[0],
          yhi = bezier(p, hi)[0],
          resolution = Math.max(
            8 * Math.max(ulp(ylo), ulp(yhi)),
            (p[3][0] - p[0][0]) * 2 ** -46,
          );
        if (yhi - ylo <= resolution) return bezier(p, t);
        if (measured < local) lo = t;
        else hi = t;
      }
      throw new InputError("contour station inverse did not converge");
    }
    offset += length;
  }
  throw new InputError("contour station is outside the resulting guide");
}
/** Projection-only compatibility wrapper; station_map retains posed bottom y. */
export function mapStation(
  curves: Cubic[],
  lengths: number[],
  station: number,
): number {
  return pointAtStation(curves, lengths, station)[0];
}
/** Request-local acceleration for dense display sampling. These are exact cubic
 * subcurves with bounded actual arcs, not a polyline or a t-as-arc lookup. */
export function createStationEvaluator(curves: Cubic[], total: number) {
  const pieces: Cubic[] = [];
  const lengths: number[] = [];
  const subdivide = (p: Cubic, depth: number) => {
    if (depth === 0) {
      pieces.push(p);
      lengths.push(arc(p, 1e-7 / 64));
      return;
    }
    const [left, right] = split(p);
    subdivide(left, depth - 1);
    subdivide(right, depth - 1);
  };
  curves.forEach((p, index) => {
    const line = straightArc(p, index);
    if (line !== undefined) {
      pieces.push(p);
      lengths.push(line);
    } else subdivide(p, 6);
  });
  return (station: number): Vec2 =>
    pointAtStation(pieces, lengths, station, total);
}
export function arcToY(curves: Cubic[], lengths: number[], y: number): number {
  let offset = 0;
  for (let i = 0; i < curves.length; i++) {
    const p = curves[i]!,
      length = lengths[i]!;
    if (y <= p[3][0]) {
      let lo = 0,
        hi = 1;
      for (let j = 0; j < 48; j++) {
        const t = (lo + hi) / 2;
        if (bezier(p, t)[0] < y) lo = t;
        else hi = t;
      }
      return offset + arc(prefix(p, (lo + hi) / 2));
    }
    offset += length;
  }
  return offset;
}
export function validateContour(
  state: Pick<LegacyLastState, "models">,
  input: ContourInput,
): ValidationReport {
  const { last_length: total, top, bottom } = input.design,
    model = state.models.bottom,
    curves = model.profile.map((n) => bottomCurvePoints(model, n)),
    bounds = curves.map((p) => arcLengthBounds(p, ARC_BUDGET)),
    lengths = bounds.map(([lo, hi]) => (lo + hi) / 2),
    { seat_arc_length: s, contact_s: c, blend_arc_length: j } = bottom;
  const checks: ValidationReport["checks"] = [];
  const check = (name: string, actual: number, expected: number, error = 0) => {
    checks.push({
      name,
      actual,
      expected,
      tolerance: 0.01,
      uncertainty_mm: error,
      units: "mm",
      passed:
        Number.isFinite(actual) && Math.abs(actual - expected) + error <= 0.01,
    });
  };
  const error = (n: number) =>
    sum(bounds.slice(0, n).map(([lo, hi]) => (hi - lo) / 2));
  check("last_length", sum(lengths), total, error(4));
  check("seat_arc_length", lengths[0]!, s, (bounds[0]![1] - bounds[0]![0]) / 2);
  check(
    "waist_arc_length",
    lengths[1]!,
    c - s,
    (bounds[1]![1] - bounds[1]![0]) / 2,
  );
  check("contact_s", sum(lengths.slice(0, 2)), c, error(2));
  check(
    "blend_arc_length",
    lengths[2]!,
    j,
    (bounds[2]![1] - bounds[2]![0]) / 2,
  );
  check("blend_end_s", sum(lengths.slice(0, 3)), c + j, error(3));
  check(
    "ramp_arc_length",
    lengths[3]!,
    total - c - j,
    (bounds[3]![1] - bounds[3]![0]) / 2,
  );
  for (const name of STATIONS) {
    const station = top[`${name}_s`];
    check(name + "_unbent_station", state.models.top.points[name]!.y, station);
    check(
      name + "_station_roundtrip",
      arcToY(curves, lengths, mapStation(curves, lengths, station)),
      station,
      curves.length * ARC_BUDGET,
    );
  }
  return {
    passed: checks.every((c) => c.passed),
    checks,
    units: "mm",
    last_length_bounds: {
      lower: sum(bounds.map((v) => v[0])),
      upper: sum(bounds.map((v) => v[1])),
    },
    limits: [
      "Contour stations and regional arc preservation are our prototype assumptions, not vendor or anatomical rules.",
      "Actual cubic chord/control-polygon bounds, not formula targets, validate arc lengths.",
      "Top model y is unbent intrinsic s; bottom projections and bent display placement are separate, not a 3D last, fit or validated heel-posture claim.",
    ],
  };
}
export function buildContour(
  input: ContourInput,
): Omit<LegacyLastState, "display"> {
  // The top is a design in intrinsic (x,s), independent of every bottom control.
  // Only station_map and the sampled 3D copy use the solved bottom projection.
  const { last_length: total, top, bottom } = input.design,
    [bottomModel, length, projectedBottom] = solveBottom(total, bottom),
    curves = bottomModel.profile.map((n) => bottomCurvePoints(bottomModel, n)),
    lengths = curves.map((p) => arc(p)),
    cache = new Map<number, number>(),
    dimensions: Record<string, number> = { length: total };
  const entries = STATIONS.map((name) => {
    const s = top[`${name}_s`];
    if (!cache.has(s)) cache.set(s, mapStation(curves, lengths, s));
    const y = cache.get(s)!;
    dimensions[`${name}_y`] = s;
    dimensions[`${name}_width`] = top[`${name}_width`];
    return [name, { s, y }] as const;
  });
  // Every Station is supplied by the fixed STATIONS list, never unchecked input keys.
  const stationMap = Object.fromEntries(entries) as Record<
    Station,
    { s: number; y: number }
  >;
  const topModel = buildTop(dimensions),
    models = { top: topModel, bottom: bottomModel };
  // Context belongs to this runtime adapter, not the legacy buildTop primitive.
  topModel.source =
    "made-up unbent (x,s) design; y stores intrinsic s, not posed forward projection; not measured foot data";
  topModel.dimensions.length!.definition =
    "Unbent longitudinal span in intrinsic s, not bottom forward projection or outline perimeter";
  for (const dimension of Object.values(topModel.dimensions))
    if (dimension.kind === "side_extent")
      dimension.definition =
        "Positive distance from x=0 to this side at intrinsic s (stored as station_y), not posed bottom y";
  const topReport = validateTop(topModel, dimensions);
  topReport.limits.unshift(
    "Top coordinates and section y values are unbent intrinsic s; the separately bent display and bottom projection do not change this model or its widths.",
  );
  return {
    inputs: structuredClone(input),
    models,
    reports: {
      top: topReport,
      bottom: validateBottom(bottomModel, length, projectedBottom),
      contour: validateContour({ models }, input),
    },
    derived: {
      projected_length: length,
      station_map: stationMap,
      bottom_stations: {
        seat_s: bottom.seat_arc_length,
        contact_s: bottom.contact_s,
        blend_end_s: bottom.contact_s + bottom.blend_arc_length,
      },
    },
  };
}
