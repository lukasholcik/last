import {
  InputError,
  type Cubic,
  type Last2DGeometry,
  type Vec2,
  type Vec3,
} from "./types";
import type {
  HeelWrapDiagnostic,
  LastSurface,
  ResolvedCrossSection,
} from "./section-types";
import {
  createCrossSectionEnvelope,
  resolveCrossSections,
} from "./cross-sections";
import { bezier } from "./math";

/** Fixed semantic correspondence; normalized shape, never a competing width table. */
export function createLastSurfaceEvaluator(
  g: Last2DGeometry,
  resolved = resolveCrossSections(g),
) {
  const envelope = createCrossSectionEnvelope(g),
    L = g.resolved.reference_last_length;
  const sections = resolved
    .filter((s) => s.cubics.length)
    .sort((a, b) => a.referenceStation - b.referenceStation);
  const normalized = (s: ResolvedCrossSection): Cubic[] =>
    s.cubics.map(
      (p) =>
        p.map(
          (q) =>
            [
              q[0] /
                Math.abs(
                  q[0] < 0 ? s.anchors[0]!.point[0] : s.anchors[2]!.point[0],
                ),
              q[1] / s.height,
            ] as Vec2,
        ) as Cubic,
    );
  const curves = sections.map(normalized);
  const at = (u: number, v: number): Vec3 => {
    if (
      !Number.isFinite(u) ||
      !Number.isFinite(v) ||
      u < 0 ||
      u > 1 ||
      v < 0 ||
      v > 1
    )
      throw new InputError("Surface references must be normalized [0,1] pairs");
    const s = u * L;
    if (u === 1) return envelope.pose(s, g.models.top.points.toe_tip!.x, 0, 0);
    // Rear seam traverses the actual lower/upper rear cap, then retraces it.
    if (u === 0) {
      const H = envelope.height(0);
      return envelope.pose(
        0,
        g.models.top.points.heel_tip!.x,
        (H * (1 + Math.sin(2 * Math.PI * v))) / 2,
        H,
      );
    }
    let a = 0;
    while (a + 1 < sections.length && sections[a + 1]!.referenceStation <= s)
      a++;
    const b = Math.min(a + 1, sections.length - 1);
    const sa = sections[a]!,
      sb = sections[b]!;
    const raw =
      a === b
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              (s - sa.referenceStation) /
                (sb.referenceStation - sa.referenceStation),
            ),
          );
    const w = raw * raw * (3 - 2 * raw),
      part = Math.min(3, Math.floor(v * 4)),
      t = v === 1 ? 1 : v * 4 - part;
    const pa = bezier(curves[a]![part]!, t),
      pb = bezier(curves[b]![part]!, t);
    const q: Vec2 = [pa[0] * (1 - w) + pb[0] * w, pa[1] * (1 - w) + pb[1] * w];
    const slopeOf = (section: ResolvedCrossSection) => {
      const r =
        section.id === "heel_width"
          ? "heel"
          : section.id === "ball"
            ? "ball"
            : section.id === "fore_toe"
              ? "toe"
              : "waist";
      const mp = g.models.top.points[`medial_${r}`]!,
        lp = g.models.top.points[`lateral_${r}`]!;
      return (
        (lp.y - mp.y) / (lp.x - mp.x) +
        Math.tan(
          ((g.inputs.cross_sections?.sections?.[section.id]?.tilt_deg ?? 0) *
            Math.PI) /
            180,
        )
      );
    };
    // Taper obliqueness to zero at the closed tips, retaining actual authored rows.
    let slope = slopeOf(sa) * (1 - w) + slopeOf(sb) * w;
    if (s < sections[0]!.referenceStation)
      slope *= s / sections[0]!.referenceStation;
    if (s > sections.at(-1)!.referenceStation)
      slope *= (L - s) / (L - sections.at(-1)!.referenceStation);
    const [lo, hi] = envelope.extent(s, slope),
      x = q[0] * Math.abs(q[0] < 0 ? lo : hi),
      H = envelope.height(s);
    return envelope.pose(s + slope * x, x, q[1] * H, H);
  };
  return at;
}
/** Rebuild-only tessellation. Closed indexed topology, explicit endpoint fans. */
export function buildLastSurface(
  g: Last2DGeometry,
  sections = resolveCrossSections(g),
): LastSurface {
  const at = createLastSurfaceEvaluator(g, sections),
    radial = 64;
  const rows = [
    ...new Set([
      ...Array.from({ length: 65 }, (_, i) => i / 64),
      ...sections.map(
        (s) => s.referenceStation / g.resolved.reference_last_length,
      ),
      ...Object.values(g.models.section.height_curves).flatMap((p) => [
        p[0][0] / g.resolved.reference_last_length,
        p[3][0] / g.resolved.reference_last_length,
      ]),
    ]),
  ].sort((a, b) => a - b);
  const longitudinal = rows.length - 1;
  const positions: number[] = [],
    indices: number[] = [];
  const push = (p: Vec3) => {
    if (!p.every(Number.isFinite))
      throw new InputError("Nonfinite last surface sample");
    positions.push(...p);
  };
  const rear: number[] = [],
    rearVertices = new Map<number, number>();
  for (let j = 0; j < radial; j++) {
    const mirror = (radial / 2 - j + radial) % radial,
      key = Math.min(j, mirror);
    if (!rearVertices.has(key)) {
      rearVertices.set(key, positions.length / 3);
      push(at(0, j / radial));
    }
    rear.push(rearVertices.get(key)!);
  }
  const first = positions.length / 3;
  for (let i = 1; i < longitudinal; i++)
    for (let j = 0; j < radial; j++) push(at(rows[i]!, j / radial));
  const toe = positions.length / 3;
  push(at(1, 0));
  for (let j = 0; j < radial; j++) {
    const k = (j + 1) % radial;
    indices.push(rear[j]!, rear[k]!, first + j, rear[k]!, first + k, first + j);
  }
  for (let i = 0; i < longitudinal - 2; i++)
    for (let j = 0; j < radial; j++) {
      const a = first + i * radial + j,
        b = first + i * radial + ((j + 1) % radial),
        c = a + radial,
        d = b + radial;
      indices.push(a, b, c, b, d, c);
    }
  const start = first + (longitudinal - 2) * radial;
  for (let j = 0; j < radial; j++)
    indices.push(start + j, start + ((j + 1) % radial), toe);
  return { positions, indices };
}
/** Declared piecewise-linear parameter routes, sampled on the very same surface. */
export function evaluateHeelWraps(
  g: Last2DGeometry,
  sections = resolveCrossSections(g),
): HeelWrapDiagnostic[] {
  const at = createLastSurfaceEvaluator(g, sections);
  return (["short_heel", "long_heel"] as const).map((id) => {
    const path = g.inputs.cross_sections?.heel_wraps?.[id];
    if (!path) return { id, status: "unconfigured", points: [] };
    const points: Vec3[] = [];
    for (let i = 0; i < path.route.length - 1; i++) {
      const a = path.route[i]!,
        b = path.route[i + 1]!;
      for (let j = 0; j < 32; j++) {
        const t = j / 32;
        points.push(at(a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t));
      }
    }
    points.push(at(...path.route.at(-1)!));
    const computed = points
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(...p.map((v, k) => v - points[i]![k]!)),
        0,
      );
    return {
      id,
      status: "configured",
      protocol: path.protocol,
      points,
      computed_mm: computed,
      ...(path.target_mm === undefined
        ? {}
        : {
            target_mm: path.target_mm,
            target_delta_mm: computed - path.target_mm,
          }),
      ...(path.foot
        ? { foot: path.foot, foot_delta_mm: computed - path.foot.value_mm }
        : {}),
    };
  });
}
