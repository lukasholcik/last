import {
  createCurve,
  sampleCurve,
  type CurvePoint,
  type EditableCurve,
  type Vec2,
} from "~/lib/curves";
import {
  SECTION_IDS,
  heightAtStation,
  sectionGeometry,
  type SectionGeometry,
  type SectionId,
} from "./section";
import { reconcileCurve, type Drive } from "./side";

/**
 * RAILS: the longitudinal curves obtained by following one role (sole, crown,
 * lateral, …) from the heel through the heel/waist/ball/toe sections to the
 * toe. Every section has the same eight roles in the same order, which is what
 * makes them connectable (the same idea as the topologically identical,
 * evenly spaced sections of section-built last surfaces).
 *
 * Where each rail is authored (decision):
 *  - sole   : elevation = side-view sole; plan = centre plane (not editable).
 *  - crown  : elevation = flat upper in the side view; plan = centre plane.
 *  - medial, lateral : plan = the top outline; elevation = `rails.elev`.
 *  - the four DERIVED rails (lateral/medial bottom and shoulder): plan =
 *    `rails.plan`, elevation = `rails.elev`, edited in the Rails view.
 * A rail is therefore two independent projections, plan (x over y) and
 * elevation (z over y), both ordinary editable Bezier curves, as in a CAD
 * last: the curve is fine-tuned in space by editing its two views separately.
 *
 * Rails are the AUTHORITY for the section points of their role: a section
 * point's u is where the section's cutting line crosses the rail's plan curve,
 * and its z is the elevation curve at the crossing's y (`railValues`). Both are
 * ordinary drives (locked, unlockable), so a locked section point cannot be
 * dragged. This replaces the earlier flat-bottom drive (z = 0): the rails are
 * SEEDED flat, and raising the waist's medial-bottom elevation models the arch.
 * Unlocking a drive lets the section override the rail at that station.
 *
 * Ends (designed): each rail starts at the top outline's heel back and ends at
 * its toe tip (drives, so they follow the outline). At the HEEL each rail
 * starts at its own height (`END_FRACTION` of the flat upper's height there),
 * so the pairs meet on the back seam one above the other. At the TOE all eight
 * end in ONE point (`TOE_FRACTION`).
 *
 * Seeding (designed): a smooth curve through the four section points and the
 * two ends, taken from the sections as they are when the rails are created.
 *
 * Limitations: derived plan rails do not follow the top outline, so a large
 * outline edit can leave a bottom rail outside it (the checks do not catch it);
 * a rail is treated as a single-valued function of y (it should not double
 * back along the length); where several crossings exist the one nearest the
 * expected side is used.
 */
export const RAIL_ROLES = [
  "sole",
  "lateral_bottom",
  "lateral",
  "lateral_shoulder",
  "crown",
  "medial_shoulder",
  "medial",
  "medial_bottom",
] as const;
export type RailRole = (typeof RAIL_ROLES)[number];

export const PLAN_ROLES = [
  "lateral_bottom",
  "lateral_shoulder",
  "medial_shoulder",
  "medial_bottom",
] as const;
export type PlanRole = (typeof PLAN_ROLES)[number];
export const ELEV_ROLES = [
  "lateral_bottom",
  "lateral",
  "lateral_shoulder",
  "medial_shoulder",
  "medial",
  "medial_bottom",
] as const;
export type ElevRole = (typeof ELEV_ROLES)[number];
export type RailProjection = "plan" | "elev";

export const RAIL_LABEL: Record<ElevRole, string> = {
  lateral_bottom: "Lateral bottom",
  lateral: "Lateral",
  lateral_shoulder: "Lateral shoulder",
  medial_shoulder: "Medial shoulder",
  medial: "Medial",
  medial_bottom: "Medial bottom",
};

export interface RailSet {
  readonly plan: Record<PlanRole, EditableCurve>;
  readonly elev: Record<ElevRole, EditableCurve>;
}

/** Rails whose plan curve is the top outline, not an entry of `rails.plan`. */
export const hasPlan = (role: ElevRole): role is PlanRole =>
  (PLAN_ROLES as readonly string[]).includes(role);

/**
 * END HEIGHT (designed): where each rail meets the back seam (and toe tip), as
 * a fraction of the flat upper's height there. Every rail pair converges on the
 * seam at its OWN height, like the rings drawn around a heel on paper: bottoms
 * at the ground, medial/lateral (the widest rail) 40 %, shoulders 75 %, crown
 * 100 %. The fractions are conventions, not measurements; the end z is a drive
 * and can be unlocked per rail.
 */
export const END_FRACTION: Record<string, number> = {
  sole: 0,
  medial_bottom: 0,
  lateral_bottom: 0,
  medial: 0.4,
  lateral: 0.4,
  medial_shoulder: 0.75,
  lateral_shoulder: 0.75,
  crown: 1,
};

type Input = {
  readonly top: EditableCurve;
  readonly dorsal: EditableCurve;
};
const ends = (top: EditableCurve) => ({
  heel: top.points.find((p) => p.role === "heel_back")?.pos,
  toe: top.points.find((p) => p.role === "toe_tip")?.pos,
});
/**
 * TOE TIP (designed): every rail ends at ONE point. x and y are the outline's
 * toe tip; z is half the flat upper's height there, the middle of the toe wall,
 * which is where the loft closes its rounded nose (loft.ts, ROUNDED NOSE).
 * Before, the toe ends sat at the per-role END_FRACTION heights (a vertical
 * column of eight markers that were not where the surface closes). The heel
 * back keeps END_FRACTION: the heel closes on a seam, a vertical line.
 */
export const TOE_FRACTION = 0.5;
const endFraction = (role: string, end: "start" | "end") =>
  end === "end" ? TOE_FRACTION : (END_FRACTION[role] ?? 0);
const endZ = (
  role: string,
  dorsal: EditableCurve,
  y: number,
  end: "start" | "end",
) => {
  const f = endFraction(role, end),
    h = f === 0 ? 0 : heightAtStation(dorsal, y);
  return h === null ? null : f * h;
};

const NAMES = ["start", "heel", "waist", "ball", "toe", "end"] as const;
const named = (pts: readonly Vec2[]): EditableCurve => {
  const base = createCurve(
    pts.map((pos) => ({ pos })),
    false,
  );
  return {
    ...base,
    points: base.points.map((p, i): CurvePoint => ({
      ...p,
      role: NAMES[i] ?? `p${i}`,
    })),
  };
};

/** Points of one role: ends plus its anchor on every section, heel to toe. */
function anchors(
  input: Input & { sections: Record<SectionId, EditableCurve> },
  role: string,
): [number, number, number][] {
  const { top, dorsal, sections } = input,
    e = ends(top),
    pts: [number, number, number][] = [];
  for (const id of SECTION_IDS) {
    const g = sectionGeometry(top, dorsal, id),
      a = sections[id].points.find((p) => p.role === role);
    if (!g || !a) continue;
    const t = a.pos[0] / g.width;
    pts.push([
      g.medial[0] + t * (g.lateral[0] - g.medial[0]),
      g.medial[1] + t * (g.lateral[1] - g.medial[1]),
      a.pos[1],
    ]);
  }
  const end = (
    p: Vec2 | undefined,
    which: "start" | "end",
  ): [number, number, number][] =>
    p ? [[p[0], p[1], endZ(role, dorsal, p[1], which) ?? 0]] : [];
  return [...end(e.heel, "start"), ...pts, ...end(e.toe, "end")].sort(
    (a, b) => a[1] - b[1],
  );
}

export function seedRails(
  input: Input & { sections: Record<SectionId, EditableCurve> },
): RailSet {
  const plan = {} as Record<PlanRole, EditableCurve>,
    elev = {} as Record<ElevRole, EditableCurve>;
  for (const r of PLAN_ROLES)
    plan[r] = named(anchors(input, r).map((p) => [p[0], p[1]] as Vec2));
  for (const r of ELEV_ROLES)
    elev[r] = named(anchors(input, r).map((p) => [p[1], p[2]] as Vec2));
  return { plan, elev };
}

/**
 * Plan drive ids are shared by the two rails of a pair (kind = bottom or
 * shoulder), because the pair is edited as one closed outline (rail-loop.ts):
 * unlocking an end unlocks it on both. Elevation ids are per rail.
 */
const rid = (
  proj: RailProjection,
  role: string,
  anchor: string,
  axis: 0 | 1,
) =>
  proj === "plan"
    ? `rail-plan-${role.endsWith("bottom") ? "bottom" : "shoulder"}/${anchor}:${axis}`
    : `rail-elev-${role}/${anchor}:${axis}`;

/** Drives of one rail curve: its two ends follow the outline and the upper. */
export function railDrives(
  proj: RailProjection,
  role: ElevRole,
  input: Input,
): Drive[] {
  const e = ends(input.top),
    out: Drive[] = [],
    val = (v: number | null | undefined) =>
      v === null || v === undefined
        ? ({ kind: "pending" } as const)
        : ({ kind: "value", value: v } as const);
  for (const [anchor, p] of [
    ["start", e.heel],
    ["end", e.toe],
  ] as const) {
    const label = anchor === "start" ? "Heel back" : "Toe tip",
      source = `${label} of the top outline`;
    if (proj === "plan") {
      out.push(
        {
          id: rid(proj, role, anchor, 0),
          role: anchor,
          axis: 0,
          label,
          source,
          driver: val(p?.[0]),
        },
        {
          id: rid(proj, role, anchor, 1),
          role: anchor,
          axis: 1,
          label,
          source,
          driver: val(p?.[1]),
        },
      );
    } else {
      out.push(
        {
          id: rid(proj, role, anchor, 0),
          role: anchor,
          axis: 0,
          label,
          source,
          driver: val(p?.[1]),
        },
        {
          id: rid(proj, role, anchor, 1),
          role: anchor,
          axis: 1,
          label: "End height",
          source:
            anchor === "end"
              ? "Middle of the toe wall: all rails meet in one point"
              : (END_FRACTION[role] ?? 0) === 0
                ? "Ground (bottom rails end at z = 0)"
                : `${Math.round((END_FRACTION[role] ?? 0) * 100)} % of the flat upper height at that station`,
          driver: val(p ? endZ(role, input.dorsal, p[1], anchor) : null),
        },
      );
    }
  }
  return out;
}

export function reconcileRails(
  rails: RailSet,
  input: Input,
  unlocked: readonly string[],
): RailSet {
  let changed = false;
  const plan = { ...rails.plan },
    elev = { ...rails.elev };
  for (const r of PLAN_ROLES) {
    const c = reconcileCurve(plan[r], railDrives("plan", r, input), unlocked);
    if (c !== plan[r]) {
      plan[r] = c;
      changed = true;
    }
  }
  for (const r of ELEV_ROLES) {
    const c = reconcileCurve(elev[r], railDrives("elev", r, input), unlocked);
    if (c !== elev[r]) {
      elev[r] = c;
      changed = true;
    }
  }
  return changed ? { plan, elev } : rails;
}

/**
 * Where a section's cutting line crosses a rail's plan curve: u along the cut
 * (medial = 0) and the crossing's y. Of several crossings, the one nearest the
 * rail's own side of the cut. A small overshoot past the landmarks is allowed.
 */
export function cutCrossing(
  g: SectionGeometry,
  plan: EditableCurve,
  side: "medial" | "lateral",
): { u: number; y: number } | null {
  const d: Vec2 = [g.lateral[0] - g.medial[0], g.lateral[1] - g.medial[1]],
    W = g.width,
    signed = (p: Vec2) =>
      (d[0] * (p[1] - g.medial[1]) - d[1] * (p[0] - g.medial[0])) / W,
    hint = side === "medial" ? 0 : W,
    pts = sampleCurve(plan, 32);
  let best: { u: number; y: number } | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!,
      sa = signed(a),
      sb = signed(b);
    if (sa * sb > 0 || sa === sb) continue;
    const t = sa / (sa - sb),
      p: Vec2 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      u = ((p[0] - g.medial[0]) * d[0] + (p[1] - g.medial[1]) * d[1]) / W;
    if (u < -0.1 * W || u > 1.1 * W) continue;
    if (!best || Math.abs(u - hint) < Math.abs(best.u - hint))
      best = { u, y: p[1] };
  }
  return best;
}

/** What the rails say about one section's points (null = not computable). */
export type RailValues = Partial<
  Record<string, { u?: number | null; z: number | null }>
>;

export function railValues(g: SectionGeometry, rails: RailSet): RailValues {
  const out: RailValues = {
    medial: { z: heightAtStation(rails.elev.medial, g.medial[1]) },
    lateral: { z: heightAtStation(rails.elev.lateral, g.lateral[1]) },
  };
  for (const r of PLAN_ROLES) {
    const c = cutCrossing(
      g,
      rails.plan[r],
      r.startsWith("medial") ? "medial" : "lateral",
    );
    out[r] = {
      u: c ? c.u : null,
      z: c ? heightAtStation(rails.elev[r], c.y) : null,
    };
  }
  return out;
}
