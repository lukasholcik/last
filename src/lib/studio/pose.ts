import { solvePosture } from "~/lib/geometry/foot-first";

/**
 * Flat-to-elevated pose of the last.
 *
 * DECISION: the hinge solve is the existing production solver
 * (`solvePosture`, H = A·sin(θ) + r(1 − cos θ), allowance δ = r·θ), not a
 * reimplementation, so the studio and the foot-first model cannot drift apart.
 * The equation is a user-approved synthetic allowance heuristic (see
 * docs/foot-first-model.md), not a physiological law. A is the medial-ball
 * station measured from the heel back; r is the adjustable effective radius.
 *
 * DECISION: the actual rear sole angle is θ plus an entered seat offset, and
 * must stay in [0°, 90°). The solver never adapts the offset: with H = 0 an
 * offset above 0 puts the seat below ground and is reported, not repaired.
 */
export interface PoseInput {
  heelHeight: number;
  /** Medial-ball reference station A, mm from the heel back. */
  ballStation: number;
  /** Effective hinge radius r in mm (allowance only; not a rendered curvature). */
  radius: number;
  seatOffsetDeg: number;
}
export type PoseResult =
  | {
      ok: true;
      /** Hinge angle θ, radians. */
      theta: number;
      /** Added plantar arc δ = r·θ, mm. */
      allowance: number;
      /** Actual rear sole angle θ + offset, radians. */
      seatAngle: number;
    }
  | { ok: false; error: string };

export function solvePose(i: PoseInput): PoseResult {
  let posture: { angle: number; allowance: number };
  try {
    posture = solvePosture(i.ballStation, i.radius, i.heelHeight);
  } catch {
    return {
      ok: false,
      error: `Heel height must be between 0 and ${(i.ballStation + i.radius).toFixed(1)} mm (ball station + hinge radius).`,
    };
  }
  const seatAngle = posture.angle + (i.seatOffsetDeg * Math.PI) / 180;
  if (!(seatAngle >= 0) || !(seatAngle < Math.PI / 2))
    return {
      ok: false,
      error: `Rear sole angle ${((seatAngle * 180) / Math.PI).toFixed(1)}° must be between 0° and 90°.`,
    };
  return {
    ok: true,
    theta: posture.angle,
    allowance: posture.allowance,
    seatAngle,
  };
}

/**
 * Reference (flat) station → posed arc distance along the bottom.
 * Same C1 smoothstep as `referenceToPosed` in the foot-first model: identity up
 * to the seat end S, adds the full allowance from the ball A onward.
 */
export function referenceToPosed(
  station: number,
  seat: number,
  anchor: number,
  allowance: number,
): number {
  if (station <= seat) return station;
  if (station >= anchor) return station + allowance;
  const t = (station - seat) / (anchor - seat);
  return station + allowance * t * t * (3 - 2 * t);
}
