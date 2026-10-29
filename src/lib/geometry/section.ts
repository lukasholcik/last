import {
  InputError,
  type BaseLastState,
  type Cubic,
  type HeightCurveName,
  type SampledCurve,
  type SectionModel,
  type SectionPiece,
  type SectionPoint,
  type SectionPointName,
  type ValidationReport,
  type Vec2,
  type Vec3,
} from "./types";
import { bezier, number, ulp, parameterAtY } from "./math";
import { bottomCurvePoints, PROFILE } from "./bottom";
import { createStationEvaluator } from "./contour";
import { referenceToPosed } from "./foot-first";
import { resolveSectionFrame as rearFrame } from "./section-frame";
import { applySectionHandles, hasSectionControl } from "./section-handles";

type Base = Pick<BaseLastState, "inputs" | "models" | "resolved" | "derived">;
const HEIGHT_NAMES: HeightCurveName[] = [
  "front_to_waist",
  "waist_to_ball",
  "ball_to_toe",
];
const POINT_NAMES: SectionPointName[] = [
  "heel_bottom",
  "heel_middle",
  "toe_bottom",
  "cut_rear",
  "cut_front",
  "waist_roof",
  "ball_roof",
  "toe_roof",
];
const BOUNDARY_NAMES = [
  ...PROFILE,
  "toe_cap",
  "roof_ball_to_toe",
  "roof_waist_to_ball",
  "roof_front_to_waist",
  "top_cut",
  "rear_cap_upper",
  "rear_cap_lower",
];
const LIMITS = [
  "Designed x=0 centre section, not a side envelope, anatomical trace, surface, solid or printable last.",
  "Rear sole, heel back and cut share theta plus seat offset; a smooth prototype frame blend returns the roof to the ball. Height inputs are local design depths, not anatomical heights.",
  "Native instep pieces share a C1 waist tangent in their cubic parameters; the ball/forefoot and toe joins are G1. Bottom heel, bottom toe and roof/top-cut front remain intentional corners.",
  "Native rear controls and sampled clearance/nofold checks support this prototype; no extreme-coordinate or anatomical guarantee.",
];

function parameters(base: Base) {
  const F = base.inputs.foot.length,
    input = base.inputs.centre_section;
  return {
    c: input.top_rear_station_ratio * F,
    knots: [
      input.top_front_station_ratio * F,
      base.inputs.template.medial_waist.station_ratio * F,
      base.inputs.template.medial_ball.station_ratio * F,
      input.toe_roof_station_ratio * F,
    ],
    heights: [
      input.top_front_height_ratio * F,
      input.waist_height_ratio * F,
      input.ball_height_ratio * F,
      input.toe_roof_height_ratio * F,
    ],
  };
}

function heightProfile(
  knots: number[],
  heights: number[],
): Record<HeightCurveName, Cubic> {
  const spans = [0, 1, 2].map((i) => knots[i + 1]! - knots[i]!);
  const secants = spans.map(
    (span, i) => (heights[i + 1]! - heights[i]!) / span,
  );
  const slopes = [secants[0]!];
  for (let i = 1; i < 3; i++) {
    const previous = secants[i - 1]!,
      next = secants[i]!;
    if (previous * next <= 0) slopes.push(0);
    else {
      const w1 = 2 * spans[i]! + spans[i - 1]!,
        w2 = spans[i]! + 2 * spans[i - 1]!;
      slopes.push((w1 + w2) / (w1 / previous + w2 / next));
    }
  }
  slopes.push(secants[2]!);
  return Object.fromEntries(
    HEIGHT_NAMES.map((name, i) => [
      name,
      [
        [knots[i]!, heights[i]!],
        [knots[i]! + spans[i]! / 3, heights[i]! + (slopes[i]! * spans[i]!) / 3],
        [
          knots[i + 1]! - spans[i]! / 3,
          heights[i + 1]! - (slopes[i + 1]! * spans[i]!) / 3,
        ],
        [knots[i + 1]!, heights[i + 1]!],
      ],
    ]),
  ) as Record<HeightCurveName, Cubic>;
}
function derivative(p: Cubic, t: number): Vec2 {
  return [0, 1].map(
    (axis) =>
      3 *
      ((1 - t) ** 2 * (p[1][axis]! - p[0][axis]!) +
        2 * (1 - t) * t * (p[2][axis]! - p[1][axis]!) +
        t * t * (p[3][axis]! - p[2][axis]!)),
  ) as Vec2;
}
function unit(v: Vec2): Vec2 {
  const length = Math.hypot(...v);
  if (!(length > 0) || !Number.isFinite(length))
    throw new InputError("centre section requires finite nonzero tangents");
  return [v[0] / length, v[1] / length];
}
function arithmetic(...values: number[]) {
  return 32 * Math.max(...values.map((value) => ulp(value)));
}
function roofEvaluator(
  base: Base,
  heightCurves: SectionModel["height_curves"],
) {
  const bottomCurves = base.models.bottom.profile.map((name) =>
    bottomCurvePoints(base.models.bottom, name),
  );
  const atArc = createStationEvaluator(
    bottomCurves,
    base.resolved.posed_last_length,
  );
  const cache = new Map<number, Vec2>();
  const bottom = (s: number): Vec2 => {
    if (!cache.has(s)) cache.set(s, atArc(referenceToPosed(s, base.resolved)));
    return [...cache.get(s)!];
  };
  const height = (s: number) => {
    for (const name of HEIGHT_NAMES) {
      const p = heightCurves[name];
      if (s >= p[0][0] && s <= p[3][0]) {
        const t = (s - p[0][0]) / (p[3][0] - p[0][0]);
        return {
          h: bezier(p, t)[1],
          slope: derivative(p, t)[1] / (p[3][0] - p[0][0]),
        };
      }
    }
    throw new InputError(
      "centre section roof station is outside its height profile",
    );
  };
  const bottomTangent = (s: number): Vec2 => {
    const p = bottom(s);
    const curve =
      bottomCurves.find((curve) => p[0] <= curve[3][0]) ?? bottomCurves.at(-1)!;
    const t = parameterAtY(curve, p[0]);
    const u = unit(derivative(curve, t));
    const {
      seat_arc_length: S,
      bend_station: A,
      posture_allowance: delta,
    } = base.resolved;
    const fraction = (s - S) / (A - S);
    const speed =
      s > S && s < A
        ? 1 + (6 * delta * fraction * (1 - fraction)) / (A - S)
        : 1;
    return [u[0] * speed, u[1] * speed];
  };
  const frame = rearFrame(base),
    a = heightCurves.front_to_waist[0][0],
    A = base.resolved.bend_station;
  const blend = (s: number) => {
    if (s >= A) return { w: 0, dw: 0 };
    const q = (s - a) / (A - a);
    return { w: 1 - q * q * (3 - 2 * q), dw: (-6 * q * (1 - q)) / (A - a) };
  };
  const roof = (s: number): Vec2 => {
    const B = bottom(s),
      { h } = height(s),
      { w } = blend(s),
      beta = frame.angle * w;
    const C = frame.point(s, 0);
    return [
      B[0] + w * (C[0] - B[0]) + h * Math.sin(beta),
      B[1] + w * (C[1] - B[1]) + h * Math.cos(beta),
    ];
  };
  const tangent = (s: number): Vec2 => {
    const B = bottom(s),
      dB = bottomTangent(s),
      { h, slope } = height(s),
      { w, dw } = blend(s);
    const C = frame.point(s, 0),
      beta = frame.angle * w;
    const n: Vec2 = [Math.sin(beta), Math.cos(beta)],
      t: Vec2 = [Math.cos(beta), -Math.sin(beta)];
    return [0, 1].map(
      (axis) =>
        dB[axis]! +
        dw * (C[axis]! - B[axis]!) +
        w * (frame.t[axis]! - dB[axis]!) +
        slope * n[axis]! +
        h * frame.angle * dw * t[axis]!,
    ) as Vec2;
  };
  return { bottom, roof, height, tangent };
}

function instepCurves(base: Base, evaluator: ReturnType<typeof roofEvaluator>) {
  const { knots } = parameters(base),
    [a, M, A] = knots as [number, number, number, number];
  const C = evaluator.roof(a),
    W = evaluator.roof(M),
    B = evaluator.roof(A),
    frame = rearFrame(base),
    p = base.inputs.centre_section,
    F = base.inputs.foot.length;
  const direction = (offset: number): Vec2 => {
    const angle = frame.angle + (offset * Math.PI) / 180;
    if (!(angle > -Math.PI / 2 && angle < Math.PI / 2))
      throw new InputError(
        "instep tangent must point forward (actual down angle between -90 and 90 degrees)",
      );
    return [Math.cos(angle), -Math.sin(angle)];
  };
  const df = direction(p.instep_front_down_offset_deg),
    dw = direction(p.instep_waist_down_offset_deg),
    db = unit(evaluator.tangent(A));
  const lf = p.instep_front_handle_ratio * F,
    lw = p.instep_waist_handle_ratio * F,
    lb = Math.hypot(B[0] - W[0], B[1] - W[1]) / 3;
  const advance = (p: Vec2, d: Vec2, length: number): Vec2 => [
    p[0] + length * d[0],
    p[1] + length * d[1],
  ];
  return {
    front_to_waist: [C, advance(C, df, lf), advance(W, dw, -lw), W] as Cubic,
    waist_to_ball: [W, advance(W, dw, lw), advance(B, db, -lb), B] as Cubic,
  };
}

/** Authoritative serializable recipe evaluator; roofs are composed, never posed cubics. */
export function createSectionEvaluator(base: Base, model: SectionModel) {
  const evaluator = roofEvaluator(base, model.height_curves);
  const native = (s: number) => {
    const first = model.height_curves.front_to_waist,
      second = model.height_curves.waist_to_ball;
    if (s < first[0][0] || s >= second[3][0]) return null;
    const name =
      s <= first[3][0] ? "roof_front_to_waist" : "roof_waist_to_ball";
    const source = name === "roof_front_to_waist" ? first : second;
    const piece = model.boundary.find((p) => p.name === name);
    if (piece?.kind !== "cubic")
      throw new InputError("native instep cubic is unavailable");
    return {
      p: piece.points,
      t: 1 - (s - source[0][0]) / (source[3][0] - source[0][0]),
      span: source[3][0] - source[0][0],
    };
  };
  return {
    bottom: evaluator.bottom,
    roof: (s: number): Vec2 => {
      const n = native(s);
      return n ? bezier(n.p, n.t) : evaluator.roof(s);
    },
    roofTangent: (s: number): Vec2 => {
      const n = native(s);
      if (!n) return evaluator.tangent(s);
      const d = derivative(n.p, n.t);
      return [-d[0] / n.span, -d[1] / n.span];
    },
    piece(piece: SectionPiece, t: number): Vec2 {
      if (!Number.isFinite(t) || t < 0 || t > 1)
        throw new InputError("section piece parameter must be within [0,1]");
      if (piece.kind === "bottom")
        return bezier(
          bottomCurvePoints(base.models.bottom, piece.source_curve),
          t,
        );
      if (piece.kind === "cubic") return bezier(piece.points, t);
      if (piece.kind === "line")
        return [
          (1 - t) * piece.points[0][0] + t * piece.points[1][0],
          (1 - t) * piece.points[0][1] + t * piece.points[1][1],
        ];
      const heightCurve =
        model.height_curves[piece.height_curve as HeightCurveName];
      const [s] = bezier(heightCurve, 1 - t);
      return evaluator.roof(s);
    },
  };
}

export function buildSection(base: Base): SectionModel {
  const { c, knots, heights } = parameters(base);
  const [a, M, A, b] = knots as [number, number, number, number];
  const height_curves = heightProfile(knots, heights);
  const evaluator = roofEvaluator(base, height_curves);
  const front = evaluator.roof(a),
    U = evaluator.roof(b);
  const B0 = evaluator.bottom(0),
    T = evaluator.bottom(base.resolved.reference_last_length);
  const frame = rearFrame(base),
    h = heights[0]!,
    bulge =
      base.inputs.centre_section.heel_bulge_ratio * base.inputs.foot.length;
  const R = frame.point(c, h),
    middle = frame.point(-bulge, 0.5 * h);
  const w = T[0] - U[0],
    v = evaluator.tangent(b),
    slope = evaluator.height(b).slope;
  if (!(w > 0 && v[0] > 0))
    throw new InputError(
      "centre_section toe roof must precede the actual last toe on its straight ramp",
    );
  const tau = Math.min(
    w / (3 * v[0]),
    slope === 0 ? Infinity : heights[3]! / (3 * Math.abs(slope)),
  );
  const toeCap: Cubic = [
    T,
    [T[0], T[1] + heights[3]! / 3],
    [U[0] + tau * v[0], U[1] + tau * v[1]],
    U,
  ];
  const lowerRear: Cubic = [
    [0, 0],
    [
      -0.2 *
        h *
        Math.sin(
          (base.inputs.centre_section.heel_leave_outward_deg * Math.PI) / 180,
        ),
      0.2 *
        h *
        Math.cos(
          (base.inputs.centre_section.heel_leave_outward_deg * Math.PI) / 180,
        ),
    ],
    [-bulge, 0.35 * h],
    [-bulge, 0.5 * h],
  ].map((p) => frame.point(p[0]!, p[1]!)) as Cubic;
  const upperRear: Cubic = [
    [-bulge, 0.5 * h],
    [-bulge, 0.65 * h],
    [c / 2, h],
    [c, h],
  ].map((p) => frame.point(p[0]!, p[1]!)) as Cubic;
  for (const p of [front, U, R, ...toeCap, ...lowerRear, ...upperRear]) {
    number("centre_section absolute y", p[0], -10000);
    number("centre_section absolute z", p[1]);
  }
  const point = (s: number, p: Vec2): SectionPoint => ({
    y: p[0],
    z: p[1],
    reference_s: s,
    height: p[1] - evaluator.bottom(s)[1],
    kind: "landmark",
  });
  const instep = instepCurves(base, evaluator);
  const model: SectionModel = {
    schema_version: 1,
    axes: ["y", "z"],
    plane_x: 0,
    closed: true,
    points: {
      heel_bottom: point(0, B0),
      heel_middle: point(0, middle),
      toe_bottom: point(base.resolved.reference_last_length, T),
      cut_rear: point(c, R),
      cut_front: point(a, front),
      waist_roof: point(M, evaluator.roof(M)),
      ball_roof: point(A, evaluator.roof(A)),
      toe_roof: point(b, U),
    },
    height_curves,
    boundary: [
      ...base.models.bottom.profile.map((name) => ({
        name,
        kind: "bottom" as const,
        source_curve: name,
      })),
      { name: "toe_cap", kind: "cubic", points: toeCap },
      {
        name: "roof_ball_to_toe",
        kind: "roof",
        height_curve: "ball_to_toe",
        reverse: true,
      },
      {
        name: "roof_waist_to_ball",
        kind: "cubic",
        points: [...instep.waist_to_ball].reverse() as Cubic,
      },
      {
        name: "roof_front_to_waist",
        kind: "cubic",
        points: [...instep.front_to_waist].reverse() as Cubic,
      },
      { name: "top_cut", kind: "line", points: [front, R] },
      {
        name: "rear_cap_upper",
        kind: "cubic",
        points: [...upperRear].reverse() as Cubic,
      },
      {
        name: "rear_cap_lower",
        kind: "cubic",
        points: [...lowerRear].reverse() as Cubic,
      },
    ],
  };
  applySectionHandles(base, model);
  return model;
}

/** Final-descriptor certificates, not acceptance based on tessellation. */
export function validateSection(
  base: Base,
  model: SectionModel,
): ValidationReport {
  const checks: ValidationReport["checks"] = [];
  const flag = (name: string, passed: boolean) =>
    checks.push({
      name,
      actual: Number(passed),
      expected: 1,
      tolerance: 0,
      units: "boolean",
      passed,
    });
  const result = (): ValidationReport => ({
    passed: checks.every((c) => c.passed),
    checks,
    units: "mm",
    limits: Object.values(base.inputs.section_handles ?? {}).some(
      (h) => h?.control1 ?? h?.control2,
    )
      ? [
          ...LIMITS.filter((line) => !line.startsWith("Native instep")),
          "Authored independent side handles intentionally permit split/corner joins; only unmodified automatic joins claim C1/G1.",
        ]
      : [...LIMITS],
  });
  const pointOK = (p: Vec2) =>
    p.length === 2 &&
    p.every(Number.isFinite) &&
    Math.abs(p[0]) <= 10000 &&
    p[1] >= 0 &&
    p[1] <= 10000;
  flag(
    "closed_section_recipe",
    model.schema_version === 1 &&
      model.closed &&
      model.plane_x === 0 &&
      model.boundary.map((p) => p.name).join() === BOUNDARY_NAMES.join() &&
      POINT_NAMES.every((name) => !!model.points[name]),
  );
  if (checks.some((c) => !c.passed)) return result();
  try {
    const wanted = buildSection(base),
      frame = rearFrame(base);
    const same = (a: Vec2, b: Vec2) =>
      Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-8;
    for (const name of HEIGHT_NAMES) {
      const p = model.height_curves[name],
        expected = wanted.height_curves[name];
      flag(
        `${name}_height_recipe`,
        p.every((q, i) => same(q, expected[i]!)),
      );
      const low = Math.min(p[0][1], p[3][1]),
        high = Math.max(p[0][1], p[3][1]),
        error = arithmetic(...p.map((q) => q[1]));
      const direction = Math.sign(p[3][1] - p[0][1]);
      const d = [0, 1, 2].map((i) => 3 * direction * (p[i + 1]![1] - p[i]![1]));
      const A = d[0]! - 2 * d[1]! + d[2]!,
        B = 2 * (d[1]! - d[0]!);
      const vertex = A > 0 ? -B / (2 * A) : -1;
      const minimum = Math.min(
        d[0]!,
        d[2]!,
        vertex > 0 && vertex < 1 ? (A * vertex + B) * vertex + d[0]! : Infinity,
      );
      flag(
        `${name}_positive_actual_monotonicity`,
        p.every(
          (q) => q[1] > 0 && q[1] >= low - error && q[1] <= high + error,
        ) &&
          (direction === 0
            ? p.every((q) => Math.abs(q[1] - p[0][1]) <= error)
            : minimum >= -8 * error),
      );
    }
    if (checks.some((c) => !c.passed)) return result();
    const evaluator = createSectionEvaluator(base, model);
    const lower = base.models.bottom.profile.map((name) =>
      bottomCurvePoints(base.models.bottom, name),
    );
    const lowerZ = (y: number) => {
      if (y < lower[0]![0][0]) return lower[0]![0][1];
      const p = lower.find((p) => y <= p[3][0]);
      if (!p) throw new InputError("section extends past actual lower toe");
      return bezier(p, parameterAtY(p, y))[1];
    };
    const sole = unit([
      lower[0]![3][0] - lower[0]![0][0],
      lower[0]![3][1] - lower[0]![0][1],
    ]);
    flag(
      "actual_rear_sole_pose",
      Math.hypot(sole[0] - frame.t[0], sole[1] - frame.t[1]) < 1e-9,
    );
    for (const name of POINT_NAMES) {
      const p = model.points[name],
        q = wanted.points[name];
      flag(
        `${name}_actual_landmark`,
        pointOK([p.y, p.z]) &&
          same([p.y, p.z], [q.y, q.z]) &&
          Math.abs(p.height - (p.z - evaluator.bottom(p.reference_s)[1])) <
            1e-8,
      );
    }
    for (let i = 0; i < model.boundary.length; i++) {
      const p = model.boundary[i]!,
        expected = wanted.boundary[i]!;
      flag(`${p.name}_piece_kind`, p.kind === expected.kind);
      if (p.kind === "cubic" && expected.kind === "cubic")
        flag(
          `${p.name}_native_controls`,
          p.points.every((q, j) => pointOK(q) && same(q, expected.points[j]!)),
        );
      if (p.kind === "cubic" && p.name.startsWith("roof_")) {
        const d = [0, 1, 2].map(
          (j) => -3 * (p.points[j + 1]![0] - p.points[j]![0]),
        );
        const A = d[0]! - 2 * d[1]! + d[2]!,
          B = 2 * (d[1]! - d[0]!),
          t = A > 0 ? -B / (2 * A) : -1;
        const minimum = Math.min(
          d[0]!,
          d[2]!,
          t > 0 && t < 1 ? (A * t + B) * t + d[0]! : Infinity,
        );
        flag(
          `${p.name}_native_forward_derivative`,
          minimum >= -arithmetic(...p.points.map((q) => q[0])),
        );
      }
      if (p.kind === "line" && expected.kind === "line")
        flag(
          `${p.name}_rigid_cut`,
          p.points.every((q, j) => same(q, expected.points[j]!)),
        );
      if (p.kind === "bottom")
        flag(
          `${p.name}_lower_source`,
          expected.kind === "bottom" &&
            p.source_curve === expected.source_curve,
        );
      if (p.kind === "roof")
        flag(
          `${p.name}_roof_source`,
          expected.kind === "roof" &&
            p.height_curve === expected.height_curve &&
            p.reverse === true,
        );
      const end = evaluator.piece(p, 1),
        start = evaluator.piece(
          model.boundary[(i + 1) % model.boundary.length]!,
          0,
        );
      flag(`${p.name}_closure`, same(end, start));
      let previous = Infinity,
        clear = true,
        forward = true,
        bounded = true;
      for (let j = 0; j <= 96; j++) {
        const q = evaluator.piece(p, j / 96);
        bounded &&= pointOK(q);
        if (p.name.startsWith("roof_")) {
          forward &&= q[0] <= previous + 1e-8;
          previous = q[0];
        }
        if (p.kind !== "bottom" && j > 0 && j < 96)
          clear &&= q[1] - lowerZ(q[0]) > 0;
      }
      flag(`${p.name}_prototype_bounds`, bounded);
      if (p.kind !== "bottom") flag(`${p.name}_prototype_clearance`, clear);
      if (p.name.startsWith("roof_"))
        flag(`${p.name}_prototype_nofold`, forward);
    }
    const rearUpper = model.boundary.find((p) => p.name === "rear_cap_upper"),
      rearLower = model.boundary.find((p) => p.name === "rear_cap_lower"),
      cut = model.boundary.find((p) => p.name === "top_cut");
    if (
      rearUpper?.kind === "cubic" &&
      rearLower?.kind === "cubic" &&
      cut?.kind === "line"
    ) {
      const departureVector: Vec2 = [
        rearLower.points[2][0] - rearLower.points[3][0],
        rearLower.points[2][1] - rearLower.points[3][1],
      ];
      const cutDirection = unit([
        cut.points[0][0] - cut.points[1][0],
        cut.points[0][1] - cut.points[1][1],
      ]);
      const manual = base.inputs.section_handles?.rear_cap_lower?.control2;
      if (Math.hypot(...departureVector) > 0) {
        const normal = unit(departureVector);
        const departure =
          (Math.atan2(
            normal[0] * frame.n[0] + normal[1] * frame.n[1],
            normal[0] * sole[0] + normal[1] * sole[1],
          ) *
            180) /
          Math.PI;
        const expectedDeparture = manual
          ? (Math.atan2(manual.normal_ratio, manual.tangent_ratio) * 180) /
            Math.PI
          : 90 + base.inputs.centre_section.heel_leave_outward_deg;
        checks.push({
          name: "heel_departure_angle_deg",
          actual: departure,
          expected: expectedDeparture,
          tolerance: 1e-8,
          units: "deg",
          passed: Math.abs(departure - expectedDeparture) < 1e-8,
        });
      } else flag("authored_zero_heel_tangent_corner", !!manual);
      flag(
        "cut_parallel_to_actual_sole",
        Math.hypot(cutDirection[0] - sole[0], cutDirection[1] - sole[1]) < 1e-8,
      );
      if (
        !hasSectionControl(base.inputs, "rear_cap_upper", 2) &&
        !hasSectionControl(base.inputs, "rear_cap_lower", 1)
      )
        flag(
          "rear_middle_C1",
          same(
            [
              rearUpper.points[3][0] - rearUpper.points[2][0],
              rearUpper.points[3][1] - rearUpper.points[2][1],
            ],
            [
              rearLower.points[1][0] - rearLower.points[0][0],
              rearLower.points[1][1] - rearLower.points[0][1],
            ],
          ),
        );
    } else flag("rear_native_pieces", false);
    const first = model.boundary.find((p) => p.name === "roof_front_to_waist"),
      second = model.boundary.find((p) => p.name === "roof_waist_to_ball");
    if (first?.kind === "cubic" && second?.kind === "cubic") {
      if (
        !hasSectionControl(base.inputs, "roof_front_to_waist", 1) &&
        !hasSectionControl(base.inputs, "roof_waist_to_ball", 2)
      )
        flag(
          "instep_shared_waist_C1",
          same(
            [
              second.points[3][0] - second.points[2][0],
              second.points[3][1] - second.points[2][1],
            ],
            [
              first.points[1][0] - first.points[0][0],
              first.points[1][1] - first.points[0][1],
            ],
          ),
        );
      if (!hasSectionControl(base.inputs, "roof_waist_to_ball", 1)) {
        const native = unit([
            second.points[1][0] - second.points[0][0],
            second.points[1][1] - second.points[0][1],
          ]),
          forefoot = unit(evaluator.roofTangent(base.resolved.bend_station));
        flag(
          "instep_forefoot_ball_G1",
          Math.hypot(native[0] + forefoot[0], native[1] + forefoot[1]) < 1e-8,
        );
      }
    } else flag("native_instep_pieces", false);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    flag("section_prototype_domain", false);
  }
  return result();
}

export function sampleSection(
  base: Base,
  model: SectionModel,
  bottom: SampledCurve[],
): SampledCurve[] {
  const evaluator = createSectionEvaluator(base, model);
  return model.boundary.map((piece) => {
    if (piece.kind === "bottom") {
      const existing = bottom.find(
        (curve) => curve.name === piece.source_curve,
      );
      if (!existing)
        throw new InputError("section bottom display source is unavailable");
      return existing;
    }
    const count = piece.kind === "line" ? 2 : 65;
    return {
      name: piece.name,
      points: Array.from({ length: count }, (_, i): Vec3 => {
        const [y, z] = evaluator.piece(piece, i / (count - 1));
        return [0, y, z];
      }),
    };
  });
}

export function sectionNotEvaluated(): ValidationReport {
  return {
    passed: false,
    units: "mm",
    checks: [
      {
        name: "section_not_evaluated_base_failed",
        actual: 0,
        expected: 1,
        tolerance: 0,
        passed: false,
        units: "boolean",
      },
    ],
    limits: [...LIMITS],
  };
}
