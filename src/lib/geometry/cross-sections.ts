import {
  InputError,
  type Cubic,
  type FootFirstInput,
  type Last2DGeometry,
  type TopAnchorId,
  type Vec2,
  type Vec3,
} from "./types";
import {
  CROSS_SECTION_ANCHORS,
  type CrossSectionId,
  type CrossSectionDefinition,
  type ResolvedCrossSection,
} from "./section-types";
import { bezier } from "./math";
import { topCurvePoints } from "./top";
import { createSectionEvaluator } from "./section";
import { resolveSectionFrame } from "./section-frame";
export type {
  CrossSectionId,
  CrossSectionAnchorId,
  ResolvedCrossSection,
} from "./section-types";

const K = 0.5522847498307936;
const labels: Record<CrossSectionId, string> = {
  heel_width: "Heel width",
  midfoot: "Midfoot",
  ball: "Ball · landmark-oblique",
  fore_toe: "Fore toe",
  toe_end: "Toe endpoint",
  waist: "Waist",
  instep: "Instep",
};
const region = (id: CrossSectionId) =>
  id === "heel_width"
    ? "heel"
    : id === "ball"
      ? "ball"
      : id === "fore_toe"
        ? "toe"
        : "waist";
function definition(
  g: Last2DGeometry,
  id: CrossSectionId,
): CrossSectionDefinition {
  return g.inputs.cross_sections?.sections?.[id] ?? {};
}
function station(g: Last2DGeometry, id: CrossSectionId) {
  if (id === "toe_end")
    return { s: g.resolved.reference_last_length, slope: 0 };
  const r = region(id),
    m = g.models.top.points[`medial_${r}`]!,
    l = g.models.top.points[`lateral_${r}`]!;
  const slope = (l.y - m.y) / (l.x - m.x),
    d = definition(g, id);
  // Split starts coincident: shape-preserving until the author separates the frames.
  return {
    s: m.y - slope * m.x + (d.station_offset_ratio ?? 0) * g.inputs.foot.length,
    slope: slope + Math.tan(((d.tilt_deg ?? 0) * Math.PI) / 180),
  };
}
function norm(v: Vec3): Vec3 {
  const n = Math.hypot(...v);
  if (!(n > 1e-10)) throw new InputError("Degenerate section frame");
  return v.map((x) => x / n) as Vec3;
}
/** One envelope evaluator shared by section resolution and every intermediate surface row. */
export function createCrossSectionEnvelope(g: Last2DGeometry) {
  const evaluator = createSectionEvaluator(g, g.models.section),
    rear = resolveSectionFrame(g),
    F = g.inputs.foot.length;
  const a = g.inputs.centre_section.top_front_station_ratio * F,
    b = g.inputs.centre_section.toe_roof_station_ratio * F,
    L = g.resolved.reference_last_length;
  const height = (s: number) => {
    if (s <= a) return g.inputs.centre_section.top_front_height_ratio * F;
    if (s >= b)
      return (
        (g.inputs.centre_section.toe_roof_height_ratio * F * (L - s)) / (L - b)
      );
    for (const p of Object.values(g.models.section.height_curves))
      if (s >= p[0][0] && s <= p[3][0])
        return bezier(p, (s - p[0][0]) / (p[3][0] - p[0][0]))[1];
    throw new InputError("Section height outside profile");
  };
  const roof = (s: number): Vec2 => {
    if (s < a) {
      const c = g.inputs.centre_section.top_rear_station_ratio * F;
      return rear.point(
        c + (s * (a - c)) / a,
        g.inputs.centre_section.top_front_height_ratio * F,
      );
    }
    if (s <= b) return evaluator.roof(s);
    const piece = g.models.section.boundary.find((p) => p.name === "toe_cap");
    if (piece?.kind !== "cubic") throw new InputError("Missing toe cap");
    const y = evaluator.bottom(s)[0];
    // The existing cap is stored toe -> roof. Match the bottom's posed y.
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 38; i++) {
      const t = (lo + hi) / 2;
      if (bezier(piece.points, t)[0] > y) lo = t;
      else hi = t;
    }
    return bezier(piece.points, (lo + hi) / 2);
  };
  const pose = (s: number, x: number, depth: number, H: number): Vec3 => {
    if (s < -1e-7 || s > L + 1e-7)
      throw new InputError("Section leaves reference last span");
    const B = evaluator.bottom(Math.max(0, Math.min(L, s))),
      R = roof(Math.max(0, Math.min(L, s))),
      q = H > 1e-9 ? depth / H : 0;
    let y = B[0] + q * (R[0] - B[0]),
      z = B[1] + q * (R[1] - B[1]);
    if (s < a && q > 0 && q < 1) {
      const name = q <= 0.5 ? "rear_cap_lower" : "rear_cap_upper",
        piece = g.models.section.boundary.find((p) => p.name === name);
      if (piece?.kind !== "cubic")
        throw new InputError("Missing rear closure boundary");
      // Boundary traversal stores both rear caps upper -> lower. Invert their
      // actual local-depth direction, not an assumed bottom -> top ordering.
      const increasing =
        rear.local(piece.points[3])[1] > rear.local(piece.points[0])[1];
      let low = 0,
        high = 1;
      for (let i = 0; i < 36; i++) {
        const t = (low + high) / 2,
          v = rear.local(bezier(piece.points, t))[1] / H;
        if (v < q === increasing) low = t;
        else high = t;
      }
      const u = rear.local(bezier(piece.points, (low + high) / 2))[0],
        c = g.inputs.centre_section.top_rear_station_ratio * F;
      const shift = (u - c * q) * (1 - s / a);
      y += shift * rear.t[0];
      z += shift * rear.t[1];
    }
    return [x, y, z];
  };
  const extent = (s: number, slope: number): Vec2 => {
    const hits: number[] = [];
    for (const name of g.models.top.outline) {
      const p = topCurvePoints(g.models.top, name),
        f = (t: number) => {
          const q = bezier(p, t);
          return q[1] - slope * q[0] - s;
        };
      // Bounded root isolation also catches edited non-monotone oblique intersections.
      for (let i = 0; i < 16; i++) {
        let lo = i / 16,
          hi = (i + 1) / 16,
          fl = f(lo),
          fh = f(hi);
        if (Math.abs(fl) < 1e-9) hits.push(bezier(p, lo)[0]);
        if (fl * fh > 0) continue;
        for (let j = 0; j < 32; j++) {
          const t = (lo + hi) / 2,
            fm = f(t);
          if (fl * fm <= 0) {
            hi = t;
            fh = fm;
          } else {
            lo = t;
            fl = fm;
          }
        }
        hits.push(bezier(p, (lo + hi) / 2)[0]);
      }
    }
    const unique = [
      ...new Set(hits.map((x) => Math.round(x * 1e7) / 1e7)),
    ].sort((a, b) => a - b);
    if (unique.length < 2 || unique[0]! >= 0 || unique.at(-1)! <= 0)
      throw new InputError(
        "Section frame must cross both sides of the last exactly around its centre seam",
      );
    if (unique.length > 2)
      throw new InputError("Ambiguous section/envelope intersection");
    return [unique[0]!, unique[1]!];
  };
  return { height, roof, pose, extent };
}
function localCurves(
  g: Last2DGeometry,
  id: CrossSectionId,
  lo: number,
  hi: number,
  h: number,
): Cubic[] {
  const d = definition(g, id),
    side = d.side_depth_ratios ?? [0.5, 0.5],
    m = side[0] * h,
    l = side[1] * h;
  const points: Vec2[] = [
    [lo, m],
    [0, h],
    [hi, l],
    [0, 0],
  ];
  const incoming: Vec2[] = [
    [lo, m * (1 - K)],
    [lo * K, h],
    [hi, l + K * (h - l)],
    [hi * K, 0],
  ];
  const outgoing: Vec2[] = [
    [lo, m + K * (h - m)],
    [hi * K, h],
    [hi, l * (1 - K)],
    [lo * K, 0],
  ];
  for (let i = 0; i < 4; i++)
    for (const kind of ["incoming", "outgoing"] as const) {
      const v = d.handles?.[CROSS_SECTION_ANCHORS[i]!]?.[kind];
      if (v)
        (kind === "incoming" ? incoming : outgoing)[i] = [
          points[i]![0] + v[0] * g.inputs.foot.width,
          points[i]![1] + v[1] * g.inputs.foot.length,
        ];
    }
  return points.map((p, i): Cubic => [
    p,
    outgoing[i]!,
    incoming[(i + 1) % 4]!,
    points[(i + 1) % 4]!,
  ]);
}
function validateCurves(curves: Cubic[], lo: number, hi: number, h: number) {
  for (const p of curves) {
    const minX = Math.min(p[0][0], p[3][0]),
      maxX = Math.max(p[0][0], p[3][0]),
      minH = Math.min(p[0][1], p[3][1]),
      maxH = Math.max(p[0][1], p[3][1]);
    for (const q of p)
      if (
        !q.every(Number.isFinite) ||
        q[0] < Math.max(lo, minX) - 1e-7 ||
        q[0] > Math.min(hi, maxX) + 1e-7 ||
        q[1] < Math.max(0, minH) - 1e-7 ||
        q[1] > Math.min(h, maxH) + 1e-7
      )
        throw new InputError(
          "Section handles must stay in their semantic quadrant without folds or envelope overshoot",
        );
  }
}
export function resolveCrossSections(
  g: Last2DGeometry,
): ResolvedCrossSection[] {
  const env = createCrossSectionEnvelope(g),
    split = g.inputs.cross_sections?.split_midfoot;
  const ids: CrossSectionId[] = [
    "heel_width",
    ...(split ? (["waist", "instep"] as const) : (["midfoot"] as const)),
    "ball",
    "fore_toe",
    "toe_end",
  ];
  const resolved = ids.map((id): ResolvedCrossSection => {
    const { s, slope } = station(g, id),
      H = env.height(s);
    if (id === "toe_end") {
      const p = env.pose(s, g.models.top.points.toe_tip!.x, 0, 0);
      return {
        id,
        label: labels[id],
        referenceStation: s,
        anchors: [],
        cubics: [],
        samples: [[p[0], 0]],
        posedSamples: [p],
        frame: {
          origin: p,
          transverse: [1, 0, 0],
          up: [0, 0, 1],
          label: "Transported reference frame · endpoint",
        },
        width: 0,
        height: 0,
        perimeter: 0,
      };
    }
    const [lo, hi] = env.extent(s, slope),
      cubics = localCurves(g, id, lo, hi, H);
    if (!(H > 0)) throw new InputError("Section needs positive profile depth");
    validateCurves(cubics, lo, hi, H);
    const samples = cubics.flatMap((p) =>
      Array.from({ length: 16 }, (_, i) => bezier(p, i / 16)),
    );
    const posedSamples = samples.map((p) =>
      env.pose(s + slope * p[0], p[0], p[1], H),
    );
    const origin = env.pose(s, 0, 0, H),
      t = env.pose(s + slope, 1, 0, H),
      u = env.pose(s, 0, H, H);
    const anchors = CROSS_SECTION_ANCHORS.map((anchor, i) => ({
      id: anchor,
      label: anchor,
      point: cubics[i]![0],
      incoming: cubics[(i + 3) % 4]![2],
      outgoing: cubics[i]![1],
    }));
    const perimeter = samples.reduce(
      (sum, p, i) =>
        sum +
        Math.hypot(
          p[0] - samples[(i + 1) % samples.length]![0],
          p[1] - samples[(i + 1) % samples.length]![1],
        ),
      0,
    );
    return {
      id,
      label: labels[id],
      referenceStation: s,
      anchors,
      cubics,
      samples,
      posedSamples,
      frame: {
        origin,
        transverse: norm(t.map((v, i) => v - origin[i]!) as Vec3),
        up: norm(u.map((v, i) => v - origin[i]!) as Vec3),
        label: "Transported reference frame · local up / landmark across-span",
      },
      width: hi - lo,
      height: H,
      perimeter,
    };
  });
  for (let i = 1; i < resolved.length; i++) {
    const previous = resolved[i - 1]!,
      current = resolved[i]!,
      delta = current.referenceStation - previous.referenceStation;
    if (delta < 1e-7) {
      if (
        previous.id !== "waist" ||
        current.id !== "instep" ||
        Math.abs(delta) > 1e-7 ||
        JSON.stringify(previous.cubics) !== JSON.stringify(current.cubics)
      )
        throw new InputError(
          "Section frames must retain semantic order; separate coincident waist/instep frames before independently shaping them",
        );
    } else {
      const ps = station(g, previous.id).slope,
        cs = station(g, current.id).slope;
      for (const side of [0, 2]) {
        const px = previous.anchors[side]?.point[0] ?? 0,
          cx = current.anchors[side]?.point[0] ?? 0;
        if (
          current.referenceStation + cs * cx <=
          previous.referenceStation + ps * px + 1e-7
        )
          throw new InputError(
            "Section frames cross at the shared outline; reduce the offset or tilt",
          );
      }
    }
  }
  return resolved;
}
function entry(input: FootFirstInput, id: CrossSectionId) {
  const branch = input.cross_sections ?? (input.cross_sections = {}),
    sections = branch.sections ?? (branch.sections = {});
  return sections[id] ?? (sections[id] = {});
}
export function editCrossSection(
  g: Last2DGeometry,
  id: CrossSectionId,
  control: {
    anchor: (typeof CROSS_SECTION_ANCHORS)[number];
    kind: "point" | "incoming" | "outgoing";
  },
  target: Vec2,
): FootFirstInput {
  if (!target.every(Number.isFinite))
    throw new InputError("Section target must be finite");
  const resolved = resolveCrossSections(g).find((s) => s.id === id),
    anchor = resolved?.anchors.find((a) => a.id === control.anchor);
  if (!resolved || !anchor || id === "toe_end")
    throw new InputError("Unavailable editable section anchor");
  const next = structuredClone(g.inputs),
    d = entry(next, id),
    F = next.foot.length,
    W = next.foot.width;
  if (control.kind !== "point") {
    const handles = d.handles ?? (d.handles = {}),
      h = handles[control.anchor] ?? (handles[control.anchor] = {});
    h[control.kind] = [
      (target[0] - anchor.point[0]) / W,
      (target[1] - anchor.point[1]) / F,
    ];
  } else if (control.anchor === "medial" || control.anchor === "lateral") {
    if (
      (definition(g, id).station_offset_ratio ?? 0) !== 0 ||
      (definition(g, id).tilt_deg ?? 0) !== 0
    )
      throw new InputError(
        "Move the landmark frame back before editing its shared width; independent handles remain editable",
      );
    if (
      (control.anchor === "medial" ? target[0] >= 0 : target[0] <= 0) ||
      target[1] <= 0 ||
      target[1] >= resolved.height
    )
      throw new InputError(
        "Side anchor must retain its side and interior depth",
      );
    const aid = `${control.anchor}_${region(id)}` as TopAnchorId,
      old = next.last_outline?.anchors[aid];
    const outline =
      next.last_outline ?? (next.last_outline = { anchors: {}, handles: {} });
    outline.anchors[aid] = {
      station_offset_ratio: old?.station_offset_ratio ?? 0,
      side_offset_ratio:
        (target[0] -
          (control.anchor === "medial" ? -1 : 1) *
            next.template[aid as keyof typeof next.template].side_extent_ratio *
            W) /
        W,
    };
    const ratios: Vec2 = [...(d.side_depth_ratios ?? [0.5, 0.5])];
    ratios[control.anchor === "medial" ? 0 : 1] = target[1] / resolved.height;
    d.side_depth_ratios = ratios;
  } else if (control.anchor === "dorsal") {
    if (Math.abs(target[0]) > 1e-7 || target[1] <= 0)
      throw new InputError(
        "Dorsal anchor stays on the shared centre seam at positive depth",
      );
    const field =
      id === "heel_width"
        ? "top_front_height_ratio"
        : id === "ball"
          ? "ball_height_ratio"
          : id === "fore_toe"
            ? "toe_roof_height_ratio"
            : "waist_height_ratio";
    next.centre_section[field] *= target[1] / resolved.height;
  } else
    throw new InputError(
      "Plantar centre is the shared bottom constraint; edit the bottom profile instead",
    );
  return next;
}
export function editCrossSectionFrame(
  g: Last2DGeometry,
  id: CrossSectionId,
  edit: { stationOffsetRatio?: number; tiltDeg?: number },
): FootFirstInput {
  if (id === "toe_end" || !resolveCrossSections(g).some((s) => s.id === id))
    throw new InputError("Unavailable section frame");
  const next = structuredClone(g.inputs),
    d = entry(next, id);
  if (edit.stationOffsetRatio !== undefined) {
    if (
      !Number.isFinite(edit.stationOffsetRatio) ||
      Math.abs(edit.stationOffsetRatio) > 0.2
    )
      throw new InputError("Station offset outside ±0.2 F");
    d.station_offset_ratio = edit.stationOffsetRatio;
  }
  if (edit.tiltDeg !== undefined) {
    if (!Number.isFinite(edit.tiltDeg) || Math.abs(edit.tiltDeg) > 30)
      throw new InputError("Frame tilt outside ±30 degrees");
    d.tilt_deg = edit.tiltDeg;
  }
  return next;
}
export function splitMidfoot(g: Last2DGeometry): FootFirstInput {
  const next = structuredClone(g.inputs),
    branch = next.cross_sections ?? (next.cross_sections = {});
  if (branch.split_midfoot) return next;
  branch.sections ??= {};
  branch.sections.waist = structuredClone(branch.sections.midfoot ?? {});
  branch.sections.instep = structuredClone(branch.sections.midfoot ?? {});
  branch.split_midfoot = true;
  return next;
}
