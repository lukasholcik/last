import type { Cubic, EditableCurve, Vec2 } from "./types";
import { EPS, dist, lerp, len } from "./vec";

export function segmentCount(c: EditableCurve): number {
  const n = c.points.length;
  return n < 2 ? 0 : c.closed ? n : n - 1;
}

/** Segment i runs from point i to point i+1 (wrapping when closed). */
export function segmentCubic(c: EditableCurve, i: number): Cubic {
  const n = c.points.length,
    a = c.points[i]!,
    b = c.points[(i + 1) % n]!;
  return [
    a.pos,
    [a.pos[0] + a.handleOut[0], a.pos[1] + a.handleOut[1]],
    [b.pos[0] + b.handleIn[0], b.pos[1] + b.handleIn[1]],
    b.pos,
  ];
}

export function evalCubic(q: Cubic, t: number): Vec2 {
  const u = 1 - t,
    w0 = u * u * u,
    w1 = 3 * u * u * t,
    w2 = 3 * u * t * t,
    w3 = t * t * t;
  return [
    w0 * q[0][0] + w1 * q[1][0] + w2 * q[2][0] + w3 * q[3][0],
    w0 * q[0][1] + w1 * q[1][1] + w2 * q[2][1] + w3 * q[3][1],
  ];
}

export function derivative(q: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const f = (k: 0 | 1) =>
    3 *
    (u * u * (q[1][k] - q[0][k]) +
      2 * u * t * (q[2][k] - q[1][k]) +
      t * t * (q[3][k] - q[2][k]));
  return [f(0), f(1)];
}

function secondDerivative(q: Cubic, t: number): Vec2 {
  const f = (k: 0 | 1) =>
    6 *
    ((1 - t) * (q[2][k] - 2 * q[1][k] + q[0][k]) +
      t * (q[3][k] - 2 * q[2][k] + q[1][k]));
  return [f(0), f(1)];
}

/** Signed curvature, positive when turning left (counter-clockwise, y up). */
export function curvature(q: Cubic, t: number): number {
  const d1 = derivative(q, t),
    d2 = secondDerivative(q, t),
    speed = len(d1);
  if (speed < EPS) return 0;
  return (d1[0] * d2[1] - d1[1] * d2[0]) / speed ** 3;
}

/** De Casteljau split; the two halves trace exactly the original curve. */
export function splitCubic(q: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(q[0], q[1], t),
    p12 = lerp(q[1], q[2], t),
    p23 = lerp(q[2], q[3], t),
    p012 = lerp(p01, p12, t),
    p123 = lerp(p12, p23, t),
    mid = lerp(p012, p123, t);
  return [
    [q[0], p01, p012, mid],
    [mid, p123, p23, q[3]],
  ];
}

export function sampleCurve(c: EditableCurve, perSegment = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let s = 0; s < segmentCount(c); s++) {
    const q = segmentCubic(c, s);
    for (let k = 0; k < perSegment; k++) out.push(evalCubic(q, k / perSegment));
  }
  if (!c.closed && segmentCount(c))
    out.push(c.points[c.points.length - 1]!.pos);
  return out;
}

export function curveLength(c: EditableCurve, perSegment = 64): number {
  let total = 0;
  for (let s = 0; s < segmentCount(c); s++) {
    const q = segmentCubic(c, s);
    let prev = q[0];
    for (let k = 1; k <= perSegment; k++) {
      const p = evalCubic(q, k / perSegment);
      total += dist(prev, p);
      prev = p;
    }
  }
  return total;
}

export interface CurveHit {
  readonly segment: number;
  readonly t: number;
  readonly point: Vec2;
  readonly distance: number;
}

/** Closest point on the curve to `p`: coarse sampling, then local refinement. */
export function nearestOnCurve(
  c: EditableCurve,
  p: Vec2,
  perSegment = 48,
): CurveHit | null {
  let best: { segment: number; t: number; d: number } | null = null;
  for (let s = 0; s < segmentCount(c); s++) {
    const q = segmentCubic(c, s);
    for (let k = 0; k <= perSegment; k++) {
      const d = dist(evalCubic(q, k / perSegment), p);
      if (!best || d < best.d) best = { segment: s, t: k / perSegment, d };
    }
  }
  if (!best) return null;
  const q = segmentCubic(c, best.segment);
  let lo = Math.max(0, best.t - 1 / perSegment),
    hi = Math.min(1, best.t + 1 / perSegment);
  for (let i = 0; i < 30; i++) {
    const a = lo + (hi - lo) / 3,
      b = hi - (hi - lo) / 3;
    if (dist(evalCubic(q, a), p) < dist(evalCubic(q, b), p)) hi = b;
    else lo = a;
  }
  const t = (lo + hi) / 2,
    point = evalCubic(q, t);
  return { segment: best.segment, t, point, distance: dist(point, p) };
}

export interface ArcTable {
  readonly points: readonly Vec2[];
  /** Cumulative polyline length at each sample, starting at 0. */
  readonly cum: readonly number[];
}

/** Arc-length lookup for an open curve (polyline sampling, not closed-form). */
export function arcTable(c: EditableCurve, perSegment = 48): ArcTable {
  const points = sampleCurve({ ...c, closed: false }, perSegment),
    cum: number[] = [0];
  for (let i = 1; i < points.length; i++)
    cum.push(cum[i - 1]! + dist(points[i - 1]!, points[i]!));
  return { points, cum };
}

/** Point at arc distance d from the start; clamped to the curve's ends. */
export function pointAtArc(t: ArcTable, d: number): Vec2 {
  const n = t.points.length;
  if (n === 0) return [0, 0];
  if (d <= 0) return t.points[0]!;
  const total = t.cum[n - 1]!;
  if (d >= total) return t.points[n - 1]!;
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const span = t.cum[hi]! - t.cum[lo]!;
  return lerp(
    t.points[lo]!,
    t.points[hi]!,
    span > 0 ? (d - t.cum[lo]!) / span : 0,
  );
}

/** Arc length of an open curve from its start to point `i`. */
export function arcLengthToPoint(
  c: EditableCurve,
  i: number,
  perSegment = 64,
): number {
  let total = 0;
  for (let s = 0; s < i; s++) {
    const q = segmentCubic({ ...c, closed: false }, s);
    let prev = q[0];
    for (let k = 1; k <= perSegment; k++) {
      const p = evalCubic(q, k / perSegment);
      total += dist(prev, p);
      prev = p;
    }
  }
  return total;
}
