import type { Vec2 } from "~/lib/curves";

/** World coordinates are y-up; `scale` is pixels per world unit. */
export interface View {
  cx: number;
  cy: number;
  scale: number;
}
export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 80;

export const toScreen = (v: View, s: Size, p: Vec2): Vec2 => [
  s.width / 2 + (p[0] - v.cx) * v.scale,
  s.height / 2 - (p[1] - v.cy) * v.scale,
];
export const toWorld = (v: View, s: Size, p: Vec2): Vec2 => [
  v.cx + (p[0] - s.width / 2) / v.scale,
  v.cy - (p[1] - s.height / 2) / v.scale,
];

export function zoomAt(v: View, s: Size, at: Vec2, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor)),
    before = toWorld(v, s, at),
    next = { ...v, scale },
    after = toWorld(next, s, at);
  return {
    ...next,
    cx: v.cx + before[0] - after[0],
    cy: v.cy + before[1] - after[1],
  };
}

/**
 * Margin (decision): 90 px on a full-size canvas, but at most 14 % of the
 * smaller side, so a small workspace pane is not mostly margin (a fixed 90 px
 * left a 260 px pane a 80 px curve).
 */
export function fitView(
  points: readonly Vec2[],
  s: Size,
  margin = Math.min(90, 0.14 * Math.min(s.width, s.height)),
): View {
  if (!points.length || s.width <= 0 || s.height <= 0)
    return { cx: 0, cy: 0, scale: 3 };
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    [x0, x1] = [Math.min(...xs), Math.max(...xs)],
    [y0, y1] = [Math.min(...ys), Math.max(...ys)],
    w = Math.max(x1 - x0, 20),
    h = Math.max(y1 - y0, 20),
    scale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min((s.width - margin * 2) / w, (s.height - margin * 2) / h),
      ),
    );
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale };
}

/** Smallest 1-2-5 grid step that stays at least `minPx` wide on screen. */
export function gridStep(scale: number, minPx = 18): number {
  const raw = minPx / scale,
    pow = 10 ** Math.floor(Math.log10(raw)),
    m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}
