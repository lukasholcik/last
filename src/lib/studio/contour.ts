import {
  arcTable,
  normalize,
  pointAtArc,
  sampleCurve,
  type CurvePoint,
  type EditableCurve,
  type Vec2,
} from "~/lib/curves";
import { add, scale, sub, unit } from "~/lib/curves/vec";
import { referenceToPosed } from "./pose";
import {
  bottomDrives,
  reconcileCurve,
  seedBottom,
  type PosedContext,
} from "./side";

/**
 * THE SIDE CONTOUR
 *
 * The side view shows ONE closed outline and edits it in the ELEVATED pose, so
 * it can be traced over a side photo. Internally it is still two curves:
 *
 *   bottom  the sole, authored posed (unchanged);
 *   dorsal  heel counter + instep + toe roof, STORED IN THE FLAT REFERENCE
 *           FRAME as (station s, height h) and shown posed.
 *
 * Why store the upper flat when it is edited posed: the user wants the sole to
 * affect the upper only through the heel elevation (toes lift, the rest of the
 * foot stays put, the sole stretches). In the flat frame an upper point is
 * independent of everything except the pose; changing H just re-places it.
 * Rejected: storing posed points and re-solving them on every heel change (an
 * ambiguous, drifting re-solve) and editing both curves in separate spaces
 * (the awkward flat/posed switch this replaces).
 *
 * DECISION: the pose is applied through a REFERENCE sole (`seedBottom` of the
 * parameters), NOT through the sole the user has drawn. So reshaping the sole
 * does not drag the upper along; only H, S, the seat offset, the radius, T, the
 * top-view length and the ball station do. (An unedited sole equals the
 * reference.)
 *
 * DECISION (frame rule): a flat point (s, h) goes to Q = B(s) + h·[sin β, cos β]
 * with B the reference sole at arc g(s) (`referenceToPosed`), extended along
 * the end tangents outside the sole, and β the direction "up" is carried to
 * (`beta`, below). "Up" is where a section plane stands, so β is also how far
 * every section tilts: a section is measured on the FLAT foot, square to the
 * ground, and must keep its place ON THE FOOT when the foot rises. The foot is
 * taken as one rigid body that turns about the ball (the same hinge as the
 * allowance, pose.ts) with only the toes staying flat:
 *   s <= S        the rear sole angle α (rigid heel block, as before);
 *   S .. A        eases from α to the hinge angle θ (they differ only by the
 *                 seat offset), so the waist and the ball turn with the foot;
 *   A .. A + HINGE_ZONE  eases from θ to 0: the forefoot lies flat again.
 * Before (up to the previous version) β eased from α to 0 BETWEEN the seat and
 * the ball, so at 80 mm the waist section stood 11 degrees from vertical and
 * the ball section 0 degrees, while the sole under the waist leans 30: the
 * sections looked untilted and not square to the foot. The seat end S is a
 * parameter, not the `cut_front` point: tying the blend to that point moved
 * every other upper point when it was dragged. A convention, not strain or
 * anatomy; the rigid-foot picture follows the user's description (toes lift,
 * the rest of the foot stays put).
 *
 * LIMITS: anchors round-trip exactly (flat → posed → flat); Bezier handles are
 * carried as points through the nonlinear map, so the curve BETWEEN anchors is
 * a close approximation, not an exact image, at large heel changes.
 */
export interface UpperFrame {
  readonly ctx: PosedContext;
  /** The reference sole the pose is applied through. */
  readonly sole: EditableCurve;
  readonly table: ReturnType<typeof arcTable>;
  readonly total: number;
  readonly first: Vec2;
  readonly last: Vec2;
  readonly t0: Vec2;
  readonly t1: Vec2;
}

export function upperFrame(ctx: PosedContext): UpperFrame {
  const sole = reconcileCurve(seedBottom(ctx), bottomDrives(ctx), []),
    table = arcTable(sole),
    n = table.points.length,
    first = table.points[0]!,
    last = table.points[n - 1]!;
  return {
    ctx,
    sole,
    table,
    total: table.cum[n - 1]!,
    first,
    last,
    t0: unit(sub(table.points[1]!, first)) ?? [1, 0],
    t1: unit(sub(last, table.points[n - 2]!)) ?? [1, 0],
  };
}

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Length over which the turned foot flattens again after the ball (mm), the
 * forefoot's hinge zone. DESIGNED, not measured. Why this long: the top of the
 * foot is the INSIDE of that bend, so the offset surface folds over where
 * height x (angle change per mm) exceeds 1. The eased angle changes by at most
 * 1.5 θ / HINGE_ZONE per mm; at θ = 28.6 degrees (100 mm heel) and 60 mm that
 * is 0.0125 per mm, so the map stays one-to-one up to about 80 mm above the
 * sole, above any upper height near the ball (the default is 36 mm). Shorter
 * would tilt the toe section less but fold sooner. The default toe section
 * sits 46 mm past the ball and keeps 13 percent of θ (3.8 degrees at 100 mm).
 */
export const HINGE_ZONE = 60;

/** Direction angle β at flat station s (see the frame rule above). */
function beta(f: UpperFrame, s: number): number {
  const S = f.ctx.params.seatLength,
    A = f.ctx.ballStation,
    { seatAngle, theta } = f.ctx.pose,
    toBall = smoothstep(A > S ? (s - S) / (A - S) : s >= A ? 1 : 0),
    rigid = seatAngle + (theta - seatAngle) * toBall;
  return rigid * (1 - smoothstep((s - A) / HINGE_ZONE));
}

function base(f: UpperFrame, s: number): Vec2 {
  const g = referenceToPosed(
    s,
    f.ctx.params.seatLength,
    f.ctx.ballStation,
    f.ctx.pose.allowance,
  );
  if (g < 0) return add(f.first, scale(f.t0, g));
  if (g > f.total) return add(f.last, scale(f.t1, g - f.total));
  return pointAtArc(f.table, g);
}

/** Flat (station, height) → posed point. */
export function flatToPosed(f: UpperFrame, p: Vec2): Vec2 {
  const b = beta(f, p[0]),
    q = base(f, p[0]);
  return [q[0] + p[1] * Math.sin(b), q[1] + p[1] * Math.cos(b)];
}

const S_MIN = -80;
/**
 * Posed point → flat (station, height). Solves for the station whose
 * perpendicular-to-"up" offset vanishes; among several roots takes the one
 * nearest `hint` (the point's current station) so a drag cannot jump branches.
 */
export function posedToFlat(f: UpperFrame, p: Vec2, hint?: number): Vec2 {
  const sMax = f.ctx.length + 80,
    resid = (s: number) => {
      const b = beta(f, s),
        d = sub(p, base(f, s));
      return d[0] * Math.cos(b) - d[1] * Math.sin(b);
    },
    roots: number[] = [];
  let prevS = S_MIN,
    prev = resid(prevS);
  for (let s = S_MIN + 1; s <= sMax; s += 1) {
    const r = resid(s);
    if (prev === 0 || prev * r < 0) {
      let lo = prevS,
        hi = s,
        rl = prev;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2,
          rm = resid(mid);
        if (rl * rm <= 0) hi = mid;
        else {
          lo = mid;
          rl = rm;
        }
      }
      roots.push((lo + hi) / 2);
    }
    prevS = s;
    prev = r;
  }
  let s: number;
  if (roots.length === 0) {
    // No crossing (point far outside the sole): fall back to the closest station.
    s = S_MIN;
    let best = Infinity;
    for (let t = S_MIN; t <= sMax; t += 1) {
      const r = Math.abs(resid(t));
      if (r < best) {
        best = r;
        s = t;
      }
    }
  } else {
    const ref = hint ?? p[0];
    s = roots.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
  }
  const b = beta(f, s),
    d = sub(p, base(f, s));
  return [s, d[0] * Math.sin(b) + d[1] * Math.cos(b)];
}

/** The flat upper curve sampled and mapped (40 samples per segment). */
export function posedDorsal(ctx: PosedContext, dorsal: EditableCurve): Vec2[] {
  const f = upperFrame(ctx);
  return sampleCurve(dorsal, 40).map((p) => flatToPosed(f, p));
}

/* ------------------------------------------------------------------ */
/* Upper curve: flat ⇄ posed                                           */
/* ------------------------------------------------------------------ */

const near = (a: Vec2, b: Vec2, e = 1e-6) =>
  Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e;

/** The flat upper curve as a posed curve (anchors and handle tips mapped). */
export function upperToPosed(
  f: UpperFrame,
  flat: EditableCurve,
): EditableCurve {
  return {
    ...flat,
    points: flat.points.map((p) => {
      const pos = flatToPosed(f, p.pos),
        tip = (off: Vec2): Vec2 =>
          off[0] === 0 && off[1] === 0
            ? [0, 0]
            : sub(flatToPosed(f, add(p.pos, off)), pos);
      return {
        ...p,
        pos,
        handleIn: tip(p.handleIn),
        handleOut: tip(p.handleOut),
      };
    }),
  };
}

/**
 * Posed upper → flat, reusing `prev` for every point the user did not touch
 * (so unedited points never drift through repeated round trips). Auto points
 * take no handles: the flat curve re-derives them.
 */
export function upperFromPosed(
  f: UpperFrame,
  posed: EditableCurve,
  prev: EditableCurve,
): EditableCurve {
  const prevPosed = upperToPosed(f, prev),
    points = posed.points.map((p): CurvePoint => {
      // Match by role (new points have none): insertions/deletions shift indices.
      const k = p.role ? prev.points.findIndex((q) => q.role === p.role) : -1,
        old = k >= 0 ? prev.points[k] : undefined,
        oldPosed = k >= 0 ? prevPosed.points[k] : undefined;
      if (
        old &&
        oldPosed &&
        old.role === p.role &&
        old.mode === p.mode &&
        near(oldPosed.pos, p.pos) &&
        (p.mode === "auto" ||
          (near(oldPosed.handleIn, p.handleIn) &&
            near(oldPosed.handleOut, p.handleOut)))
      )
        return { ...old, lineToNext: p.lineToNext };
      const pos = posedToFlat(f, p.pos, old?.pos[0] ?? p.pos[0]),
        off = (h: Vec2): Vec2 =>
          h[0] === 0 && h[1] === 0
            ? [0, 0]
            : sub(posedToFlat(f, add(p.pos, h), pos[0]), pos);
      return {
        ...p,
        pos,
        handleIn: p.mode === "auto" ? [0, 0] : off(p.handleIn),
        handleOut: p.mode === "auto" ? [0, 0] : off(p.handleOut),
      };
    });
  return normalize({ ...posed, points });
}

/* ------------------------------------------------------------------ */
/* One closed contour                                                  */
/* ------------------------------------------------------------------ */

const flip = (p: CurvePoint): CurvePoint => ({
  ...p,
  handleIn: p.handleOut,
  handleOut: p.handleIn,
});

/**
 * Sole + posed upper as one closed loop, in this order:
 *   heel_rear … toe_end  (sole, as stored)
 *   toe_tip … heel_bulge (upper, reversed)  → closes to heel_rear.
 * The upper's first point (heel_back) IS heel_rear: station 0 and ground in the
 * flat frame map onto the sole's rear point, so the two merge into one corner
 * whose in-handle is the upper's heel-counter tangent. toe_end→toe_tip is a
 * straight "toe wall" (the toe thickness), flagged `lineToNext`.
 *
 * Roles are unique across both curves, which is how `splitContour` finds them.
 */
export function buildContour(
  f: UpperFrame,
  bottom: EditableCurve,
  dorsal: EditableCurve,
): EditableCurve {
  const up = upperToPosed(f, dorsal).points,
    heelBack = up[0],
    rest = up.slice(1),
    sole = bottom.points.map((p, i) =>
      i === 0 && heelBack
        ? { ...p, handleIn: heelBack.handleOut }
        : i === bottom.points.length - 1
          ? { ...p, lineToNext: true }
          : p,
    ),
    // Reversed upper: a forward segment's flag moves to the point it now leaves.
    rev = rest
      .map((p, k) => ({
        ...flip(p),
        lineToNext: k === 0 ? heelBack?.lineToNext : rest[k - 1]?.lineToNext,
      }))
      .reverse();
  return { closed: true, points: [...sole, ...rev] };
}

/** Inverse of `buildContour`; new points between sole and upper are dropped. */
export function splitContour(
  f: UpperFrame,
  contour: EditableCurve,
  prev: { bottom: EditableCurve; dorsal: EditableCurve },
): { bottom: EditableCurve; dorsal: EditableCurve } {
  const c = contour.points,
    iEnd = c.findIndex((p) => p.role === "toe_end"),
    iTip = c.findIndex((p) => p.role === "toe_tip");
  if (iEnd < 0 || iTip < 0 || iTip < iEnd) return prev;
  const soleRaw = c.slice(0, iEnd + 1),
    heel = soleRaw[0]!,
    bottom = normalize({
      closed: false,
      points: soleRaw.map((p, i) =>
        i === 0
          ? { ...p, handleIn: [0, 0] as Vec2 }
          : i === iEnd
            ? { ...p, lineToNext: prev.bottom.points.at(-1)?.lineToNext }
            : p,
      ),
    }),
    loopUp = c.slice(iTip), // toe_tip … heel_bulge
    // Forward flag of a point = the loop flag of the point before it (see build).
    fwd = loopUp
      .map((p, k) => ({
        ...flip(p),
        lineToNext: k === 0 ? undefined : loopUp[k - 1]?.lineToNext,
      }))
      .reverse(),
    oldBack = prev.dorsal.points[0]!,
    // heel_back keeps station 0 / ground (a drive); only its tangent can change.
    backPosed = upperToPosed(f, prev.dorsal).points[0]!,
    backHandle = heel.handleIn,
    backChanged = !near(backPosed.handleOut, backHandle),
    heelBack: CurvePoint = {
      ...oldBack,
      lineToNext: loopUp[loopUp.length - 1]?.lineToNext,
      ...(backChanged
        ? {
            mode: "corner",
            handleOut:
              backHandle[0] === 0 && backHandle[1] === 0
                ? ([0, 0] as Vec2)
                : sub(
                    posedToFlat(f, add(backPosed.pos, backHandle), 0),
                    oldBack.pos,
                  ),
          }
        : {}),
    },
    tail = upperFromPosed(
      f,
      { closed: false, points: fwd },
      { closed: false, points: prev.dorsal.points.slice(1) },
    ).points;
  return {
    bottom,
    dorsal: normalize({ closed: false, points: [heelBack, ...tail] }),
  };
}
