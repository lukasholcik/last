export type Vec2 = readonly [number, number];
export type Cubic = readonly [Vec2, Vec2, Vec2, Vec2];

/**
 * How a point's two handles are constrained.
 * - auto: handles are derived from the neighbouring points (never a kink)
 * - smooth: handles stay collinear, lengths are independent
 * - symmetric: handles stay collinear and equal in length
 * - corner: handles are fully independent (the only mode that can kink)
 */
export type PointMode = "auto" | "smooth" | "symmetric" | "corner";
export const POINT_MODES: readonly PointMode[] = [
  "auto",
  "smooth",
  "symmetric",
  "corner",
];
export type HandleSide = "in" | "out";

export interface CurvePoint {
  readonly pos: Vec2;
  readonly mode: PointMode;
  /** Offset from `pos` towards the previous point. Unused at an open start. */
  readonly handleIn: Vec2;
  /** Offset from `pos` towards the next point. Unused at an open end. */
  readonly handleOut: Vec2;
  /** Optional landmark name (e.g. "medial_ball"); survives edits and JSON. */
  readonly role?: string;
  /**
   * The segment leaving this point is a straight line: its handles are forced
   * onto the chord and follow the end points. Stated explicitly, never inferred
   * from handle geometry (a flat curve looks straight but must stay a curve).
   */
  readonly lineToNext?: boolean;
}

export interface EditableCurve {
  readonly points: readonly CurvePoint[];
  readonly closed: boolean;
}
