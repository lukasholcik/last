import {
  arcLengthToPoint,
  moveAnchor,
  sampleCurve,
  type CurvePoint,
  type EditableCurve,
  type PointMode,
  type Vec2,
} from "~/lib/curves";
import { len, sub, unit } from "~/lib/curves/vec";
import { solvePose, type PoseResult } from "./pose";
import { topMeasures } from "./top-outline";

/**
 * SIDE VIEW MODEL
 *
 * Axes: world x = station (mm from the heel back, shared with the top view's
 * y), world y = height z above flat ground. Toe points to +x.
 *
 * Two authored curves, SHOWN AS ONE closed contour edited in the elevated pose
 * (see `contour.ts`, which owns that decision):
 *  - `bottom` (centre-plane sole) is stored POSED, so heel height, seat and toe
 *    spring are read directly off it.
 *  - `dorsal` (heel counter + instep + toe roof) is STORED FLAT (reference
 *    station, height) and edited through the pose map, so a heel change is a
 *    pure re-placement of its points and the sole's shape never drags it.
 */

/** Entered (designed) values; none of these is a measurement. */
export interface SideParams {
  /** Last heel height H: rear underside to ground (ISO 19408 §3.2.6). mm. */
  readonly heelHeight: number;
  /** Toe spring T: toe underside to ground (ISO 19408 §3.2.13), a height not an angle. mm. */
  readonly toeSpring: number;
  /** Heel seat length S: straight seat chord from the heel back to the breast. mm. */
  readonly seatLength: number;
  /**
   * Length of the rounded transition after the ground contact, measured along
   * the ground. 10 mm is the earlier model's chosen development value, not a
   * standard.
   */
  readonly blendLength: number;
  /** Effective hinge radius as a fraction of last length. Allowance only. */
  readonly radiusRatio: number;
  /** Added to the hinge angle to give the actual rear sole angle, degrees. */
  readonly seatOffsetDeg: number;
}

/**
 * DECISION: seatOffsetDeg defaults to 0 here, unlike the foot-first example's
 * 2°. A positive offset makes H = 0 invalid (the seat dips below ground), which
 * would break a continuous flat → elevated sweep of the heel height.
 * radiusRatio .05 is the existing synthetic development choice, not anatomy.
 */
export const DEFAULT_SIDE_PARAMS: SideParams = {
  heelHeight: 8,
  toeSpring: 10,
  seatLength: 54,
  blendLength: 10,
  radiusRatio: 0.05,
  seatOffsetDeg: 0,
};

export interface SideContext {
  /** Last length L (overall length of the top outline). */
  readonly length: number;
  /** Ball station A: medial-ball landmark, mm from the heel back. */
  readonly ballStation: number;
  readonly params: SideParams;
  readonly pose: PoseResult;
}

/** A context whose pose solved: what everything that draws or drives needs. */
export type PosedContext = SideContext & {
  readonly pose: Extract<PoseResult, { ok: true }>;
};
export function validContext(
  ctx: SideContext | { error: string },
): PosedContext | null {
  return "error" in ctx || !ctx.pose.ok ? null : (ctx as PosedContext);
}

/**
 * DEPENDS ON the top outline: L is its overall length and A its medial_ball
 * landmark. Editing the top view therefore moves the side view's driven points.
 */
export function sideContext(
  top: EditableCurve,
  params: SideParams,
): SideContext | { error: string } {
  const m = topMeasures(top),
    ball = top.points.find((p) => p.role === "medial_ball");
  if (!ball) return { error: "The top outline needs a Medial ball landmark." };
  const length = m.length,
    ballStation = ball.pos[1] - m.yMin;
  return {
    length,
    ballStation,
    params,
    pose: solvePose({
      heelHeight: params.heelHeight,
      ballStation,
      radius: params.radiusRatio * length,
      seatOffsetDeg: params.seatOffsetDeg,
    }),
  };
}

/**
 * A driven coordinate. `value` drives set it directly; `arc` drives choose it
 * so the arc length from the curve start to the point equals `target`.
 *
 * DECISION: the contact and toe budgets (A + δ and L + δ) are ARC lengths along
 * the bottom, as in the foot-first model, not horizontal positions. Pinning
 * them as x-coordinates would silently break the allowance, so they are solved
 * against whatever curve is drawn. A driven axis is locked on the canvas; the
 * user can unlock it to override, after which it is an ordinary free value.
 */
export type Driver =
  | { kind: "value"; value: number }
  | { kind: "arc"; target: number }
  /** Follows another point's coordinate plus a fixed delta (applied after arcs). */
  | { kind: "offset"; from: string; delta: number }
  /**
   * The value cannot be computed right now (the pose is invalid). The axis stays
   * locked and the landmark protected, so a bad parameter never unlocks or
   * deletes required geometry; `reconcileCurve` simply leaves it alone.
   */
  | { kind: "pending" };
export interface Drive {
  readonly id: string;
  readonly role: string;
  readonly axis: 0 | 1;
  readonly label: string;
  /** Human-readable origin, shown next to the lock. */
  readonly source: string;
  readonly driver: Driver;
}
export const driveId = (role: string, axis: 0 | 1) => `${role}:${axis}`;
const drive = (
  role: string,
  axis: 0 | 1,
  label: string,
  source: string,
  driver: Driver,
): Drive => ({ id: driveId(role, axis), role, axis, label, source, driver });

export function bottomDrives(ctx: SideContext): Drive[] {
  const { heelHeight: H, toeSpring: T, seatLength: S } = ctx.params,
    pose = ctx.pose,
    // With an invalid pose every driver is "pending" but the drives still exist.
    a = pose.ok ? pose.seatAngle : 0,
    d = pose.ok ? pose.allowance : 0,
    live = (driver: Driver): Driver => (pose.ok ? driver : { kind: "pending" });
  return [
    drive("heel_rear", 0, "Station", "Heel back is station 0", {
      kind: "value",
      value: 0,
    }),
    drive(
      "heel_rear",
      1,
      "Height",
      "Heel height H",
      live({ kind: "value", value: H }),
    ),
    drive(
      "seat_front",
      0,
      "Station",
      "Seat length S at the rear sole angle",
      live({ kind: "value", value: S * Math.cos(a) }),
    ),
    drive(
      "seat_front",
      1,
      "Height",
      "Heel height H minus seat drop",
      live({ kind: "value", value: H - S * Math.sin(a) }),
    ),
    drive(
      "contact",
      0,
      "Station",
      "Arc to contact = ball station A + allowance δ",
      live({ kind: "arc", target: ctx.ballStation + d }),
    ),
    drive("contact", 1, "Height", "Ground", { kind: "value", value: 0 }),
    drive("blend_end", 0, "Station", "Contact station + blend length", {
      kind: "offset",
      from: "contact",
      delta: ctx.params.blendLength,
    }),
    drive(
      "toe_end",
      0,
      "Station",
      "Total arc = length L + allowance δ",
      live({ kind: "arc", target: ctx.length + d }),
    ),
    drive("toe_end", 1, "Height", "Toe spring T", { kind: "value", value: T }),
  ];
}

/**
 * Flat-space dorsal. Its first point is the sole's rear in flat space (station 0,
 * ground), so the heel counter, top cut and instep are ONE curve that starts at
 * the sole. The ball and toe tip stay on the top view's stations.
 */
export function dorsalDrives(ctx: SideContext): Drive[] {
  return [
    drive("heel_back", 0, "Station", "Heel back is station 0", {
      kind: "value",
      value: 0,
    }),
    drive("heel_back", 1, "Height", "Flat ground", { kind: "value", value: 0 }),
    drive("ball_top", 0, "Station", "Ball station A from the top view", {
      kind: "value",
      value: ctx.ballStation,
    }),
    drive("toe_tip", 0, "Station", "Overall length L from the top view", {
      kind: "value",
      value: ctx.length,
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* Reconciling a curve with its drives                                 */
/* ------------------------------------------------------------------ */

function withAxis(c: EditableCurve, i: number, axis: 0 | 1, v: number) {
  const p = c.points[i]!.pos;
  return moveAnchor(c, i, axis === 0 ? [v, p[1]] : [p[0], v]);
}

/** Bisect the point's station so the arc length from the start hits `target`. */
function solveArc(c: EditableCurve, i: number, target: number): EditableCurve {
  if (i < 1) return c;
  const f = (x: number) => arcLengthToPoint(withAxis(c, i, 0, x), i) - target;
  let lo = c.points[i - 1]!.pos[0],
    hi = lo + target * 1.5 + 10;
  // The arc grows with the station; if the target is unreachable keep the point.
  if (f(lo) > 0 || f(hi) < 0) return c;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return withAxis(c, i, 0, (lo + hi) / 2);
}

function sameCurve(a: EditableCurve, b: EditableCurve): boolean {
  if (a.points.length !== b.points.length) return false;
  const eq = (u: Vec2, v: Vec2) =>
    Math.abs(u[0] - v[0]) < 1e-9 && Math.abs(u[1] - v[1]) < 1e-9;
  return a.points.every((p, i) => {
    const q = b.points[i]!;
    return (
      eq(p.pos, q.pos) &&
      eq(p.handleIn, q.handleIn) &&
      eq(p.handleOut, q.handleOut)
    );
  });
}

/**
 * Make every locked drive true on the curve. Returns the SAME object when
 * nothing changed so history never records a no-op. Drives whose id is in
 * `unlocked`, or whose role no longer exists, are skipped.
 *
 * Order matters and is fixed: direct values, then offsets, then arc solves in
 * curve order with offsets re-applied after each (a later arc, such as the toe
 * end, measures along points that offsets have just moved). Straight segments
 * need no special handling here: `lineToNext` is enforced by `normalize`.
 */
export function reconcileCurve(
  curve: EditableCurve,
  drives: readonly Drive[],
  unlocked: readonly string[],
): EditableCurve {
  const active = drives.filter((d) => !unlocked.includes(d.id)),
    index = (c: EditableCurve, role: string) =>
      c.points.findIndex((p) => p.role === role);
  let c = curve;
  const apply = (kind: "value" | "offset") => {
    for (const d of active) {
      if (d.driver.kind !== kind) continue;
      const i = index(c, d.role);
      if (i < 0) continue;
      let target: number;
      if (d.driver.kind === "value") target = d.driver.value;
      else {
        const j = index(c, d.driver.from);
        if (j < 0) continue;
        target = c.points[j]!.pos[d.axis] + d.driver.delta;
      }
      if (Math.abs(c.points[i]!.pos[d.axis] - target) > 1e-9)
        c = withAxis(c, i, d.axis, target);
    }
  };
  apply("value");
  apply("offset");
  const arcs = active
    .flatMap((d) =>
      d.driver.kind === "arc" ? [{ d, i: index(c, d.role) }] : [],
    )
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  for (const { d, i } of arcs) {
    if (d.driver.kind === "arc") c = solveArc(c, i, d.driver.target);
    apply("offset");
  }
  return sameCurve(c, curve) ? curve : c;
}

/* ------------------------------------------------------------------ */
/* Starting shapes                                                     */
/* ------------------------------------------------------------------ */

const pt = (
  role: string,
  pos: Vec2,
  mode: PointMode,
  handleIn: Vec2,
  handleOut: Vec2,
): CurvePoint => ({ role, pos, mode, handleIn, handleOut });

/**
 * Synthetic starting sole: straight seat, free waist, horizontal ground contact,
 * short rounded blend, straight toe ramp. A starting point, not a measurement;
 * `reconcileCurve` then solves the arc budgets exactly.
 */
export function seedBottom(ctx: SideContext): EditableCurve {
  const {
      heelHeight: H,
      toeSpring: T,
      seatLength: S,
      blendLength: BLEND,
    } = ctx.params,
    pose = ctx.pose;
  if (!pose.ok) throw new Error(pose.error);
  const heel: Vec2 = [0, H],
    seat: Vec2 = [
      S * Math.cos(pose.seatAngle),
      H - S * Math.sin(pose.seatAngle),
    ],
    contactX = ctx.ballStation + pose.allowance - 2,
    contact: Vec2 = [contactX, 0],
    end: Vec2 = [ctx.length + pose.allowance, T],
    k = T / Math.max(1, end[0] - contactX - BLEND / 2),
    blend: Vec2 = [contactX + BLEND, (k * BLEND) / 2],
    seatChord = sub(seat, heel),
    seatDir = unit(seatChord) ?? [1, 0],
    ramp = sub(end, blend),
    rampDir = unit(ramp) ?? [1, 0],
    waist = contact[0] - seat[0];
  const third = (v: Vec2, k2: number): Vec2 => [v[0] * k2, v[1] * k2];
  return {
    closed: false,
    points: [
      {
        ...pt("heel_rear", heel, "corner", [0, 0], third(seatChord, 1 / 3)),
        lineToNext: true,
      },
      pt(
        "seat_front",
        seat,
        "smooth",
        third(seatChord, -1 / 3),
        third(seatDir, waist / 3),
      ),
      pt("contact", contact, "smooth", [-waist / 3, 0], [BLEND / 3, 0]),
      {
        ...pt(
          "blend_end",
          blend,
          "smooth",
          third(rampDir, -BLEND / 3),
          third(rampDir, len(ramp) / 3),
        ),
        lineToNext: true,
      },
      pt("toe_end", end, "corner", third(ramp, -1 / 3), [0, 0]),
    ],
  };
}

/** Auto-mode points with handles filled in by `moveAnchor`'s normalisation. */
const autoPoint = (role: string, x: number, h: number): CurvePoint => ({
  role,
  pos: [x, h],
  mode: "auto",
  handleIn: [0, 0],
  handleOut: [0, 0],
});

/**
 * Heel counter points for the flat curve: the sole's rear, then a bulge BEHIND
 * station 0 (negative station is intentional overhang, as in the earlier model's
 * `heel_bulge`). Synthetic: 3 mm overhang at .17 L, not an observed heel.
 */
export function seedHeelCounter(length: number): CurvePoint[] {
  return [
    autoPoint("heel_back", 0, 0),
    autoPoint("heel_bulge", -3, 0.17 * length),
  ];
}

/**
 * Role names of the upper's two points that mark the top of the heel counter
 * and the front of the flat top. They were `cut_rear` / `cut_front` while the
 * top cut was read off them; the cut is now its own curve (cut.ts), so they are
 * ordinary roof points and old saves are renamed on load (`renameRoofRoles`).
 */
export function renameRoofRoles(dorsal: EditableCurve): EditableCurve {
  if (
    !dorsal.points.some((p) => p.role === "cut_rear" || p.role === "cut_front")
  )
    return dorsal;
  const to: Record<string, string> = {
    cut_rear: "roof_rear",
    cut_front: "roof_front",
  };
  return {
    ...dorsal,
    points: dorsal.points.map((p) =>
      p.role && to[p.role] ? { ...p, role: to[p.role] } : p,
    ),
  };
}

/**
 * Synthetic flat profile (centre plane, flat reference space): heel counter,
 * roof over the top, instep, toe. Heights are fractions of L adapted from the earlier
 * centre-section defaults (.30/.22/.12/.06 of F); designed values, not
 * observed foot heights.
 */
export function seedDorsal(ctx: SideContext): EditableCurve {
  const L = ctx.length,
    raw: EditableCurve = {
      closed: false,
      points: [
        ...seedHeelCounter(L),
        autoPoint("roof_rear", 0.04 * L, 0.34 * L),
        autoPoint("roof_front", 0.28 * L, 0.3 * L),
        autoPoint("instep_waist", 0.4 * L, 0.22 * L),
        autoPoint("ball_top", ctx.ballStation, 0.12 * L),
        autoPoint("toe_roof", 0.92 * L, 0.06 * L),
        autoPoint("toe_tip", L, 0.02 * L),
      ],
    };
  // Auto handles are derived from positions; moveAnchor re-derives them all.
  return moveAnchor(raw, 0, raw.points[0]!.pos);
}

/* ------------------------------------------------------------------ */
/* Derived display geometry                                            */
/* ------------------------------------------------------------------ */

export interface Diagnostic {
  readonly level: "ok" | "warn" | "error";
  readonly text: string;
}

/**
 * Checks, not corrections: nothing here changes the geometry. A budget that is
 * off (e.g. after unlocking an arc drive) is reported with its signed delta.
 */
export function sideDiagnostics(
  ctx: SideContext | { error: string },
  bottom: EditableCurve,
): Diagnostic[] {
  if ("error" in ctx) return [{ level: "error", text: ctx.error }];
  if (!ctx.pose.ok) return [{ level: "error", text: ctx.pose.error }];
  const out: Diagnostic[] = [],
    deg = (r: number) => ((r * 180) / Math.PI).toFixed(1),
    { pose } = ctx;
  out.push({
    level: "ok",
    text: `Rear sole angle ${deg(pose.seatAngle)}° (hinge θ ${deg(pose.theta)}° + offset ${ctx.params.seatOffsetDeg}°); allowance δ ${pose.allowance.toFixed(2)} mm`,
  });
  const seat = bottom.points.find((p) => p.role === "seat_front");
  if (seat && seat.pos[1] < -0.01)
    out.push({
      level: "error",
      text: `Seat front is ${(-seat.pos[1]).toFixed(1)} mm below ground: shorten the seat, raise the heel, or lower the offset.`,
    });
  const lowest = Math.min(...sampleCurve(bottom, 32).map((p) => p[1]));
  if (lowest < -0.05)
    out.push({
      level: "warn",
      text: `Sole dips ${(-lowest).toFixed(2)} mm below ground.`,
    });
  const arcCheck = (role: string, label: string, target: number) => {
    const i = bottom.points.findIndex((p) => p.role === role);
    if (i < 0) return;
    const arc = arcLengthToPoint(bottom, i),
      delta = arc - target;
    out.push({
      level: Math.abs(delta) < 0.05 ? "ok" : "warn",
      text: `${label} ${arc.toFixed(1)} mm vs ${target.toFixed(1)} required (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`,
    });
  };
  arcCheck("contact", "Arc to contact", ctx.ballStation + pose.allowance);
  arcCheck("toe_end", "Total arc", ctx.length + pose.allowance);
  return out;
}
