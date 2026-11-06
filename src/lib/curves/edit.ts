import { segmentCubic, splitCubic } from "./bezier";
import { fillMissingHandles, normalize, autoHandles } from "./constrain";
import type { CurvePoint, EditableCurve, PointMode, Vec2 } from "./types";
import { sub } from "./vec";

export const MIN_POINTS_OPEN = 2;
export const MIN_POINTS_CLOSED = 3;

/** Build a curve from positions; handles start out as auto handles. */
export function createCurve(
  points: readonly { pos: Vec2; mode?: PointMode }[],
  closed: boolean,
): EditableCurve {
  const base: EditableCurve = {
    closed,
    points: points.map((p) => ({
      pos: p.pos,
      mode: p.mode ?? "auto",
      handleIn: [0, 0],
      handleOut: [0, 0],
    })),
  };
  return {
    ...base,
    points: base.points.map((p, i) => ({ ...p, ...autoHandles(base, i) })),
  };
}

/**
 * Insert a point on segment `segment` at parameter `t` by de Casteljau
 * subdivision, so the shape is unchanged (unless a neighbour is auto and
 * re-derives its handle).
 */
export function insertPoint(
  c: EditableCurve,
  segment: number,
  t: number,
): { curve: EditableCurve; index: number } {
  const n = c.points.length,
    a = c.points[segment]!,
    b = c.points[(segment + 1) % n]!,
    [l, r] = splitCubic(segmentCubic(c, segment), t),
    mode: PointMode =
      a.mode === "auto" && b.mode === "auto" ? "auto" : "smooth",
    fresh: CurvePoint = {
      pos: l[3],
      mode,
      // Splitting a straight line leaves two straight lines.
      ...(a.lineToNext ? { lineToNext: true } : {}),
      handleIn: sub(l[2], l[3]),
      handleOut: sub(r[1], r[0]),
    },
    points = c.points.map((p, k) =>
      k === segment
        ? { ...p, handleOut: sub(l[1], l[0]) }
        : k === (segment + 1) % n
          ? { ...p, handleIn: sub(r[2], r[3]) }
          : p,
    );
  points.splice(segment + 1, 0, fresh);
  return { curve: normalize({ ...c, points }), index: segment + 1 };
}

/** Add a new auto point after the last one. */
export function appendPoint(
  c: EditableCurve,
  pos: Vec2,
): { curve: EditableCurve; index: number } {
  const n = c.points.length;
  let next: EditableCurve = {
    ...c,
    points: [
      ...c.points,
      { pos, mode: "auto", handleIn: [0, 0], handleOut: [0, 0] },
    ],
  };
  if (n > 0) next = fillMissingHandles(next, n - 1);
  if (c.closed && n > 0) next = fillMissingHandles(next, 0);
  return { curve: normalize(next), index: n };
}

export function canRemove(c: EditableCurve) {
  return c.points.length > (c.closed ? MIN_POINTS_CLOSED : MIN_POINTS_OPEN);
}

export function removePoint(c: EditableCurve, i: number): EditableCurve {
  if (!canRemove(c)) return c;
  const n = c.points.length,
    prev = (i - 1 + n) % n,
    points = c.points
      .map((p, k) =>
        // Merging two straight segments stays straight; anything else is a curve.
        k === prev && (c.closed || i > 0) && p.lineToNext
          ? { ...p, lineToNext: !!c.points[i]!.lineToNext }
          : p,
      )
      .filter((_, k) => k !== i);
  return normalize({ ...c, points });
}

export function setClosed(c: EditableCurve, closed: boolean): EditableCurve {
  if (closed === c.closed) return c;
  if (closed && c.points.length < MIN_POINTS_CLOSED) return c;
  let next: EditableCurve = { ...c, closed };
  if (closed) {
    next = fillMissingHandles(next, 0);
    next = fillMissingHandles(next, next.points.length - 1);
  }
  return normalize(next);
}
