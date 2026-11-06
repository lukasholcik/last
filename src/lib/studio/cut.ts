import { flatToPosed, type UpperFrame } from "./contour";
import type { EditableCurve } from "~/lib/curves";

/**
 * THE TOP CUT: the flat face on top of a last.
 *
 * A last is cut off flat at the top (the "cone island" of last-making
 * vocabulary; patent US 5,661,864 names it and says only that the last is
 * "terminated" at the cone height, giving no height, angle or shape). No source
 * found gives a standard, so the defaults here are DESIGNED. The user's
 * description is the spec: a plain planar cut through the shape, whatever is
 * above it removed; the cut is not something to model with curves (it matters
 * little for the structure of the last). The mounting hole of the last is not
 * built.
 *
 * DECISION (what is stored): two numbers, entered. `height` is the height of the
 * plane above the sole at the heel back (station 0), measured in the FLAT foot,
 * and `tiltDeg` its slope against the foot's sole (+ = rising towards the toe).
 * Stored on the flat foot like the upper and the sections, so the cut keeps its
 * place ON THE FOOT when the heel rises. Rejected: a drawn curve or two points
 * in the Side pane (an earlier version of this change; more to model than the
 * cut is worth, and the roof was forced through it), a height in the posed
 * frame (heel changes would move the cut relative to the foot and chop it).
 *
 * DECISION (the plane in the pose): the plane is carried by the rigid heel
 * block (rotation by the seat angle about the heel rear, exactly what the frame
 * rule does up to the seat end S), and then simply continued as a plane. A
 * plane pushed through the whole pose map would bend where the map bends, so
 * the top would not be flat. It is applied to the WHOLE last, front to back,
 * with no stop and no ramp (an earlier version released it over 40 mm in front
 * of a point, which left a ridge in front of the flat face). Where the plane
 * lies above the last nothing is cut; where it passes through the last, the
 * part above it is removed. With a high heel the plane descends towards the toe
 * at about the seat angle, so it can reach a low forefoot: lower the cut's
 * tilt or raise its height, or switch the cut off, if so.
 *
 * Limits: the face is whatever the plane leaves of the rounded top (its outline
 * follows from the shape and cannot be drawn); the plane is not tilted across
 * the foot; the edge is softened by a fixed blend (loft.ts), not a drawn
 * radius.
 */
export interface TopCut {
  /** Height above the sole at the heel back, mm, flat foot. */
  readonly height: number;
  /** Slope against the sole, degrees; + rises towards the toe. */
  readonly tiltDeg: number;
}

/**
 * Designed starting cut: 0.30 L high at the heel back (the default roof peaks at
 * 0.34 L), falling 5 degrees to the toe, so a fresh model shows a visible face
 * over the heel and the start of the instep and keeps its forefoot.
 */
export const defaultCut = (length: number): TopCut => ({
  height: Math.round(0.3 * length * 10) / 10,
  tiltDeg: -5,
});

export const MAX_TILT = 60;

/**
 * Take over a cut from older saves. An earlier version stored the cut as a
 * 2-point straight curve (`cut_rear`, `cut_front`), and before that as the two
 * named points of the upper; both are lines through two points (station,
 * height) on the flat foot, converted to a height at station 0 and a slope.
 * With the front point missing (it could be deleted) the cut is level at the
 * rear point's height. Null when there is nothing to take over.
 */
export function cutFromPoints(
  rear: readonly number[] | undefined,
  front: readonly number[] | undefined,
): TopCut | null {
  if (!rear) return null;
  const k =
    front && Math.abs(front[0]! - rear[0]!) > 1e-6
      ? (front[1]! - rear[1]!) / (front[0]! - rear[0]!)
      : 0;
  return {
    height: rear[1]! - k * rear[0]!,
    tiltDeg: (Math.atan(k) * 180) / Math.PI,
  };
}

export const cutFromCurve = (c: EditableCurve): TopCut | null =>
  cutFromPoints(
    c.points.find((p) => p.role === "cut_rear")?.pos,
    c.points.find((p) => p.role === "cut_front")?.pos,
  );

/**
 * Height of the cutting plane over a (posed) station y, or null when the plane
 * is vertical (never, with the tilt limited to MAX_TILT). Unposed: the flat
 * line. Posed: the line through the images of two of its points on the rigid
 * heel block (stations 0 and S).
 */
export function cutZ(
  cut: TopCut,
  frame: UpperFrame | null,
): (y: number) => number {
  const k = Math.tan(
    (Math.min(MAX_TILT, Math.max(-MAX_TILT, cut.tiltDeg)) * Math.PI) / 180,
  );
  if (!frame) return (y) => cut.height + k * y;
  const S = Math.max(10, frame.ctx.params.seatLength),
    a = flatToPosed(frame, [0, cut.height]),
    b = flatToPosed(frame, [S, cut.height + k * S]),
    m = (b[1] - a[1]) / (b[0] - a[0]);
  return (y) => a[1] + (y - a[0]) * m;
}
