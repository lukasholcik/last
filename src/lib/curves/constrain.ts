import type {
  CurvePoint,
  EditableCurve,
  HandleSide,
  PointMode,
  Vec2,
} from "./types";
import { EPS, ZERO, add, dist, len, neg, scale, sub, unit } from "./vec";

const THIRD = 1 / 3;

/** Does point i have a handle on this side (open curves have none at the ends)? */
export function hasHandle(c: EditableCurve, i: number, side: HandleSide) {
  return c.closed || (side === "in" ? i > 0 : i < c.points.length - 1);
}

/**
 * Auto handles: tangent along the bisector of the two chords, so the curve
 * never kinks and never overshoots as a plain Catmull-Rom can; each handle is
 * a third of the chord on its own side.
 */
export function autoHandles(
  c: EditableCurve,
  i: number,
): { handleIn: Vec2; handleOut: Vec2 } {
  const n = c.points.length,
    p = c.points[i]!.pos,
    prev = hasHandle(c, i, "in") ? c.points[(i - 1 + n) % n]!.pos : null,
    next = hasHandle(c, i, "out") ? c.points[(i + 1) % n]!.pos : null;
  if (prev && next) {
    const dIn = unit(sub(p, prev)),
      dOut = unit(sub(next, p));
    if (!dIn || !dOut) return { handleIn: ZERO, handleOut: ZERO };
    const sum = add(dIn, dOut);
    // A full reversal has no bisector; fall back to the normal.
    const t = unit(sum) ?? ([-dOut[1], dOut[0]] as Vec2);
    return {
      handleIn: scale(t, -dist(p, prev) * THIRD),
      handleOut: scale(t, dist(next, p) * THIRD),
    };
  }
  return {
    handleIn: prev ? scale(sub(prev, p), THIRD) : ZERO,
    handleOut: next ? scale(sub(next, p), THIRD) : ZERO,
  };
}

/** Re-couple the handle opposite to the one just fixed, per the point's mode. */
function couple(p: CurvePoint, fixed: HandleSide): CurvePoint {
  const f = fixed === "in" ? p.handleIn : p.handleOut,
    o = fixed === "in" ? p.handleOut : p.handleIn,
    dir = unit(neg(f));
  let opposite = o;
  if (p.mode === "symmetric") opposite = neg(f);
  else if (p.mode === "smooth" && dir)
    opposite = scale(dir, len(o) < EPS ? len(f) : len(o));
  return fixed === "in"
    ? { ...p, handleOut: opposite }
    : { ...p, handleIn: opposite };
}

/**
 * Recompute everything derived from positions: auto handles first, then the
 * handles of straight-line segments (which win), with smooth/symmetric
 * neighbours re-coupled so a tilted line never leaves a kink behind it.
 * Run after any position change.
 */
export function normalize(c: EditableCurve): EditableCurve {
  const hasLine = c.points.some((p) => p.lineToNext);
  if (!hasLine && !c.points.some((p) => p.mode === "auto")) return c;
  const n = c.points.length,
    pts = c.points.map((p, i) =>
      p.mode === "auto" ? { ...p, ...autoHandles(c, i) } : p,
    );
  const segments = c.closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    if (!pts[i]!.lineToNext) continue;
    const j = (i + 1) % n,
      chord = sub(pts[j]!.pos, pts[i]!.pos),
      before = (i - 1 + n) % n,
      lineBefore = (c.closed || i > 0) && pts[before]!.lineToNext,
      lineAfter = (c.closed || j < n - 1) && pts[j]!.lineToNext;
    pts[i] = { ...pts[i]!, handleOut: scale(chord, 1 / 3) };
    pts[j] = { ...pts[j]!, handleIn: scale(chord, -1 / 3) };
    if (!lineBefore && (c.closed || i > 0)) pts[i] = couple(pts[i]!, "out");
    if (!lineAfter && (c.closed || j < n - 1)) pts[j] = couple(pts[j], "in");
  }
  return { ...c, points: pts };
}

function withPoint(
  c: EditableCurve,
  i: number,
  patch: Partial<CurvePoint>,
): EditableCurve {
  return {
    ...c,
    points: c.points.map((p, k) => (k === i ? { ...p, ...patch } : p)),
  };
}

export function moveAnchor(c: EditableCurve, i: number, pos: Vec2) {
  return normalize(withPoint(c, i, { pos }));
}

/**
 * Move one handle to `offset` (relative to its anchor) and let the point's
 * mode decide what happens to the opposite handle. Dragging an auto handle
 * takes manual control of the point (it becomes smooth).
 */
export function moveHandle(
  c: EditableCurve,
  i: number,
  side: HandleSide,
  offset: Vec2,
): EditableCurve {
  const p = c.points[i]!,
    mode: PointMode = p.mode === "auto" ? "smooth" : p.mode,
    otherSide: HandleSide = side === "in" ? "out" : "in",
    other = otherSide === "in" ? p.handleIn : p.handleOut;
  let opposite = other;
  if (hasHandle(c, i, otherSide)) {
    if (mode === "symmetric") opposite = neg(offset);
    else if (mode === "smooth") {
      const dir = unit(neg(offset));
      // A zero-length opposite handle is healed to mirror the moved one.
      if (dir)
        opposite = scale(dir, len(other) < EPS ? len(offset) : len(other));
    }
  }
  const patch =
    side === "in"
      ? { handleIn: offset, handleOut: opposite }
      : { handleOut: offset, handleIn: opposite };
  // Pulling a handle of a straight segment turns it into a curve.
  const n = c.points.length,
    prev = (i - 1 + n) % n,
    breaksLine =
      side === "out"
        ? p.lineToNext
        : (c.closed || i > 0) && c.points[prev]!.lineToNext;
  let next = withPoint(c, i, { ...patch, mode });
  if (breaksLine)
    next =
      side === "out"
        ? withPoint(next, i, { lineToNext: false })
        : withPoint(next, prev, { lineToNext: false });
  return normalize(next);
}

/** Make the segment after point i a straight line (or a curve again). */
export function setLine(
  c: EditableCurve,
  i: number,
  on: boolean,
): EditableCurve {
  if (!hasHandle(c, i, "out")) return c;
  const j = (i + 1) % c.points.length;
  let next = withPoint(c, i, { lineToNext: on });
  if (on)
    // Auto handles would be overwritten on one side only and leave a kink.
    for (const k of [i, j])
      if (next.points[k]!.mode === "auto")
        next = withPoint(next, k, { mode: "smooth" });
  return normalize(next);
}

/** Switch a point's mode, adjusting its handles to satisfy the new rule. */
export function setMode(
  c: EditableCurve,
  i: number,
  mode: PointMode,
): EditableCurve {
  const p = c.points[i]!;
  if (mode === "corner") return withPoint(c, i, { mode });
  if (mode === "auto") return normalize(withPoint(c, i, { mode }));
  if (!hasHandle(c, i, "in") || !hasHandle(c, i, "out"))
    return withPoint(c, i, { mode });
  const lIn = len(p.handleIn),
    lOut = len(p.handleOut),
    fwdOut = unit(p.handleOut),
    fwdIn = unit(neg(p.handleIn)),
    both = fwdOut && fwdIn ? unit(add(fwdOut, fwdIn)) : null,
    dir = both ?? fwdOut ?? fwdIn;
  if (!dir) return withPoint(c, i, { mode });
  const outLen = lOut < EPS ? lIn : lOut,
    inLen = lIn < EPS ? lOut : lIn,
    sym = (outLen + inLen) / 2;
  return withPoint(c, i, {
    mode,
    handleOut: scale(dir, mode === "symmetric" ? sym : outLen),
    handleIn: scale(dir, -(mode === "symmetric" ? sym : inLen)),
  });
}

/** Zero-length handles that now exist (e.g. an end became interior) get an auto length. */
export function fillMissingHandles(c: EditableCurve, i: number): EditableCurve {
  const p = c.points[i]!;
  if (p.mode === "auto") return c;
  const auto = autoHandles(c, i);
  let next = withPoint(c, i, {
    handleIn:
      hasHandle(c, i, "in") && len(p.handleIn) < EPS
        ? auto.handleIn
        : p.handleIn,
    handleOut:
      hasHandle(c, i, "out") && len(p.handleOut) < EPS
        ? auto.handleOut
        : p.handleOut,
  });
  if (p.mode !== "corner") next = setMode(next, i, p.mode);
  return next;
}

/**
 * Angle in degrees between the incoming and outgoing tangent at an interior
 * point: 0 means smooth (G1), anything larger is a visible kink.
 */
export function kinkAngle(c: EditableCurve, i: number): number {
  if (!hasHandle(c, i, "in") || !hasHandle(c, i, "out")) return 0;
  const p = c.points[i]!,
    a = unit(neg(p.handleIn)),
    b = unit(p.handleOut);
  if (!a || !b) return 0;
  const cos = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1]));
  return (Math.acos(cos) * 180) / Math.PI;
}
