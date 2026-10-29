import {
  InputError,
  REGIONS,
  type FootFirstInput,
  type LastOutlineInput,
  type LastOutlineVector,
  type TopAnchorId,
  type TopModel,
  type ValidationReport,
  type Vec2,
} from "./types";
import { record, keys } from "./contour";
import { number, gap, curveBounds, bezier, ulp } from "./math";
import {
  buildTop,
  topCurvePoints,
  segmentsIntersect,
  sectionExtent,
} from "./top";

export const TOP_ANCHORS: readonly TopAnchorId[] = [
  "heel_tip",
  ...REGIONS.map((r) => `lateral_${r}` as const),
  "toe_tip",
  ...[...REGIONS].reverse().map((r) => `medial_${r}` as const),
];
function partial(value: unknown, allowed: readonly string[], name: string) {
  if (!record(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    throw new InputError(`${name} has unknown or malformed fields`);
  return value;
}
function vector(value: unknown): LastOutlineVector {
  if (!record(value) || !keys(value, ["forward_ratio", "side_ratio"]))
    throw new InputError(
      "last outline handle requires forward_ratio and side_ratio",
    );
  return {
    forward_ratio: number(
      "last handle forward ratio",
      value.forward_ratio,
      -Number.MAX_VALUE,
      Number.MAX_VALUE,
    ),
    side_ratio: number(
      "last handle side ratio",
      value.side_ratio,
      -Number.MAX_VALUE,
      Number.MAX_VALUE,
    ),
  };
}
export function parseLastOutline(value: unknown): LastOutlineInput {
  if (!record(value) || !keys(value, ["anchors", "handles"]))
    throw new InputError("last_outline requires exactly anchors and handles");
  const anchors = partial(value.anchors, TOP_ANCHORS, "last anchors"),
    handles = partial(value.handles, TOP_ANCHORS, "last handles"),
    result: LastOutlineInput = { anchors: {}, handles: {} };
  for (const id of TOP_ANCHORS) {
    if (Object.hasOwn(anchors, id)) {
      const a = anchors[id];
      if (!record(a) || !keys(a, ["station_offset_ratio", "side_offset_ratio"]))
        throw new InputError(
          "last anchor requires station_offset_ratio and side_offset_ratio",
        );
      const station = number(
        "last station offset",
        a.station_offset_ratio,
        -Number.MAX_VALUE,
        Number.MAX_VALUE,
      );
      if ((id === "heel_tip" || id === "toe_tip") && station !== 0)
        throw new InputError(
          "last tip stations stay at 0 and reference last length",
        );
      result.anchors[id] = {
        station_offset_ratio: station,
        side_offset_ratio: number(
          "last side offset",
          a.side_offset_ratio,
          -Number.MAX_VALUE,
          Number.MAX_VALUE,
        ),
      };
    }
    if (Object.hasOwn(handles, id)) {
      const h = partial(
          handles[id],
          ["incoming", "outgoing"],
          "last anchor handles",
        ),
        entry: NonNullable<LastOutlineInput["handles"][TopAnchorId]> = {};
      if (Object.hasOwn(h, "incoming")) entry.incoming = vector(h.incoming);
      if (Object.hasOwn(h, "outgoing")) entry.outgoing = vector(h.outgoing);
      result.handles[id] = entry;
    }
  }
  return result;
}
export function hasLastOutlineEdits(input: FootFirstInput) {
  const p = input.last_outline;
  return (
    !!p &&
    (Object.keys(p.anchors).length > 0 ||
      Object.values(p.handles).some((h) => h?.incoming ?? h?.outgoing))
  );
}
export function lastAnchorTarget(input: FootFirstInput, id: TopAnchorId): Vec2 {
  const F = input.foot.length,
    W = input.foot.width;
  const base: Vec2 =
    id === "heel_tip"
      ? [0, 0]
      : id === "toe_tip"
        ? [0, F + input.design.toe_extension_ratio * W]
        : [
            (id.startsWith("medial") ? -1 : 1) *
              (input.template[id].side_extent_ratio * W),
            input.template[id].station_ratio * F,
          ];
  const offset = input.last_outline?.anchors[id];
  return offset
    ? [
        base[0] + offset.side_offset_ratio * W,
        base[1] + offset.station_offset_ratio * F,
      ]
    : base;
}
export function getLastAnchor(model: TopModel, id: TopAnchorId) {
  const p = model.points[id];
  if (!p) throw new InputError(`Missing last anchor ${id}`);
  return p;
}
export function getLastHandle(
  model: TopModel,
  id: TopAnchorId,
  direction: "incoming" | "outgoing",
) {
  const name = model.outline.find((name) => {
    const c = model.curves[name];
    return c && (direction === "incoming" ? c.end === id : c.start === id);
  });
  const c = name ? model.curves[name] : undefined,
    p = c
      ? model.points[direction === "incoming" ? c.control2 : c.control1]
      : undefined;
  if (!p) throw new InputError(`Missing last ${direction} handle at ${id}`);
  return p;
}
export function buildLastOutline(
  input: FootFirstInput,
  generated: TopModel,
): TopModel {
  if (!hasLastOutlineEdits(input)) return generated;
  const dimensions = { ...generated.design };
  for (const id of TOP_ANCHORS) {
    const [x, s] = lastAnchorTarget(input, id);
    number("last anchor x", x, -10000);
    number("last anchor reference station", s, 0);
    if (id !== "heel_tip" && id !== "toe_tip") {
      dimensions[`${id}_y`] = s;
      // Positive widths seed the unchanged automatic constructor. Actual LAST
      // x positions (including crossing the foot axis) are applied below.
      dimensions[`${id}_width`] = Math.max(0.01, Math.abs(x));
    }
  }
  const model = buildTop(dimensions);
  for (const id of TOP_ANCHORS) {
    const [x] = lastAnchorTarget(input, id),
      p = getLastAnchor(model, id),
      shift = x - p.x;
    getLastHandle(model, id, "incoming").x += shift;
    getLastHandle(model, id, "outgoing").x += shift;
    p.x = x;
    if (id !== "heel_tip" && id !== "toe_tip") {
      model.design[`${id}_width`] = Math.abs(x);
      const dimension = model.dimensions[`${id}_half_width`];
      if (dimension) {
        dimension.expected = Math.abs(x);
        dimension.definition =
          "Transverse |x| of this LAST anchor, not a FOOT measurement";
      }
    }
  }
  for (const id of TOP_ANCHORS)
    for (const direction of ["incoming", "outgoing"] as const) {
      const v = input.last_outline?.handles[id]?.[direction];
      if (!v) continue;
      const anchor = getLastAnchor(model, id),
        handle = getLastHandle(model, id, direction);
      handle.x = number(
        "last handle x",
        anchor.x + v.side_ratio * input.foot.width,
        -10000,
      );
      handle.y = number(
        "last handle station",
        anchor.y + v.forward_ratio * input.foot.length,
        0,
      );
      if (handle.y > dimensions.length!)
        throw new InputError(
          "last handles must stay within the fixed reference span",
        );
    }
  model.source =
    "Independently edited reference LAST over the stable FOOT definition; authored split handles may create corners.";
  return model;
}
export function validateLastOutline(
  model: TopModel,
  input: FootFirstInput,
): ValidationReport {
  const checks: ValidationReport["checks"] = [],
    flag = (name: string, passed: boolean) =>
      checks.push({
        name,
        actual: Number(passed),
        expected: 1,
        tolerance: 0,
        units: "boolean",
        passed,
      });
  const L =
    input.foot.length + input.design.toe_extension_ratio * input.foot.width;
  const curves = model.outline.map((name) => topCurvePoints(model, name));
  for (const id of TOP_ANCHORS) {
    const [x, s] = lastAnchorTarget(input, id),
      p = getLastAnchor(model, id);
    flag(
      `${id}_last_target`,
      Math.abs(p.x - x) <= 1e-9 && Math.abs(p.y - s) <= 1e-9,
    );
  }
  curves.forEach((p, i) => {
    const next = curves[(i + 1) % curves.length]!,
      direction = Math.sign(p[3][1] - p[0][1]),
      d = [0, 1, 2].map((j) => 3 * direction * (p[j + 1]![1] - p[j]![1]));
    const a = d[0]! - 2 * d[1]! + d[2]!,
      b = 2 * (d[1]! - d[0]!),
      t = a > 0 ? -b / (2 * a) : -1,
      min = Math.min(
        d[0]!,
        d[2]!,
        t > 0 && t < 1 ? (a * t + b) * t + d[0]! : Infinity,
      ),
      error = 64 * Math.max(...p.map((q) => ulp(q[1])));
    const bounds = curveBounds(p, 1);
    flag(
      `last_${i}_finite_span`,
      p.every((q) => q.every(Number.isFinite) && Math.abs(q[0]) <= 10000) &&
        bounds[0] >= -error &&
        bounds[1] <= L + error,
    );
    flag(
      `last_${i}_ordered_no_fold`,
      direction !== 0 && gap(Math.abs(p[3][1] - p[0][1])) && min >= -error,
    );
    flag(
      `last_${i}_closed`,
      Math.hypot(p[3][0] - next[0][0], p[3][1] - next[0][1]) <= 1e-9,
    );
  });
  const points = curves.flatMap((p) =>
    Array.from({ length: 32 }, (_, i) => bezier(p, i / 32)),
  );
  let intersections = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 2; j < points.length; j++)
      if (
        !(i === 0 && j === points.length - 1) &&
        segmentsIntersect(
          points[i]!,
          points[(i + 1) % points.length]!,
          points[j]!,
          points[(j + 1) % points.length]!,
        )
      )
        intersections++;
  flag("last_sampled_nonadjacent_intersections", intersections === 0);
  const sections: NonNullable<ValidationReport["sections"]> = [];
  if (checks.every((c) => c.passed))
    for (const id of TOP_ANCHORS) {
      if (id === "heel_tip" || id === "toe_tip") continue;
      const p = getLastAnchor(model, id),
        [lo, hi] = sectionExtent(model, p.y);
      sections.push({
        name: id,
        y: p.y,
        medial_x: lo,
        lateral_x: hi,
        width: hi - lo,
      });
    }
  return {
    passed: checks.every((c) => c.passed),
    units: "mm",
    checks,
    sections,
    limits: [
      "Reference LAST edits do not alter FOOT measurements, template or bend anchor.",
      "Authored independent handles permit corners/cusps and zero endpoint tangents; C1 is not required at edited last joins.",
      "Ordered actual cubics and sampled nonadjacent intersections are prototype checks, not a general continuous intersection certificate.",
    ],
  };
}
