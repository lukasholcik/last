import {
  curveLength,
  moveAnchor,
  sampleCurve,
  type CurvePoint,
  type EditableCurve,
  type Vec2,
} from "~/lib/curves";
import type { RailValues } from "./rails";
import { reconcileCurve, type Drive } from "./side";

/**
 * CROSS SECTIONS
 *
 * A section is a closed Bezier in (u, z): u runs along its cutting line from
 * the MEDIAL to the LATERAL edge, z is height above the flat sole.
 *
 * DECISION (cutting line): the plane is vertical (perpendicular to the flat
 * foot) but NOT perpendicular to the long axis. It passes through the top
 * outline's medial and lateral landmark of the same pair (heel, waist, ball,
 * toe), so it is tilted whenever the pair differs in y, as the ball line is on
 * a real foot. This matches sections taken with a contour gauge laid across
 * the foot, and means sections are not mirror-symmetric by default. Rejected:
 * planes perpendicular to the axis (cannot represent the oblique ball line);
 * free-form cutting lines (a later step; only the four pairs exist now).
 *
 * DEPENDS ON: the top outline (the two landmarks give the cut line, the width W
 * and the station) and the side contour's flat upper (crown height). Same
 * "build sections where section planes meet profile curves" idea as the Rhino
 * CSec command and section-built last patents; the landmark choice is ours.
 *
 * Drives (all unlockable, ids prefixed by the section id so the shared
 * `unlocked` list cannot collide across sections):
 *  - medial   u = 0         the outline's medial landmark
 *  - lateral  u = W         the outline's lateral landmark
 *  - crown    u = u_c, z = h  where the cut meets the CENTRE PLANE (x = 0, the
 *             plane the side view shows) and h is the flat upper's height there
 *  - sole     z = 0         the flat reference sole
 * The crown drives are `pending` when the cut does not cross x = 0 or the upper
 * has no height there: they stay locked and nothing is applied.
 *
 * Not driven: everything else, including u of the sole point and all shoulder
 * and bottom points. Heights do not depend on the heel pose: sections live in
 * the flat reference frame, like the upper.
 */
export const SECTION_IDS = ["heel", "waist", "ball", "toe"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_LABEL: Record<SectionId, string> = {
  heel: "Heel",
  waist: "Waist",
  ball: "Ball",
  toe: "Toe",
};

export interface SectionGeometry {
  readonly id: SectionId;
  /** Landmark positions in the top view. */
  readonly medial: Vec2;
  readonly lateral: Vec2;
  /** Length of the cut = section width, mm. */
  readonly width: number;
  /** Cut direction vs the x axis, degrees; + when the lateral end is further toward the toe. */
  readonly tiltDeg: number;
  /** Mean y of the two landmarks, mm from the heel back (the top view's station convention). */
  readonly station: number;
  /** u where the cut crosses the centre plane x = 0, or null. */
  readonly centreU: number | null;
  /** Station (y) of that crossing, or null. */
  readonly centreStation: number | null;
  /** Flat upper height at that station, or null. */
  readonly crownHeight: number | null;
}

/** Height of the flat upper at `station`: the highest crossing of x = station. */
export function heightAtStation(
  dorsal: EditableCurve,
  station: number,
): number | null {
  const pts = sampleCurve(dorsal, 60);
  let best: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!;
    if ((a[0] - station) * (b[0] - station) > 0) continue;
    const dx = b[0] - a[0],
      y =
        dx === 0
          ? Math.max(a[1], b[1])
          : a[1] + ((station - a[0]) / dx) * (b[1] - a[1]);
    if (best === null || y > best) best = y;
  }
  return best;
}

export function sectionGeometry(
  top: EditableCurve,
  dorsal: EditableCurve,
  id: SectionId,
): SectionGeometry | null {
  const medial = top.points.find((p) => p.role === `medial_${id}`)?.pos,
    lateral = top.points.find((p) => p.role === `lateral_${id}`)?.pos;
  if (!medial || !lateral) return null;
  const dx = lateral[0] - medial[0],
    dy = lateral[1] - medial[1],
    width = Math.hypot(dx, dy);
  if (width < 1e-6) return null;
  const t = dx === 0 ? NaN : (0 - medial[0]) / dx,
    onCut = Number.isFinite(t) && t > 0 && t < 1,
    centreStation = onCut ? medial[1] + t * dy : null;
  return {
    id,
    medial,
    lateral,
    width,
    tiltDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    station: (medial[1] + lateral[1]) / 2,
    centreU: onCut ? t * width : null,
    centreStation,
    crownHeight:
      centreStation === null ? null : heightAtStation(dorsal, centreStation),
  };
}

const sid = (id: SectionId, role: string, axis: 0 | 1) =>
  `${id}/${role}:${axis}`;
const drive = (
  id: SectionId,
  role: string,
  axis: 0 | 1,
  label: string,
  source: string,
  value: number | null,
): Drive => ({
  id: sid(id, role, axis),
  role,
  axis,
  label,
  source,
  driver: value === null ? { kind: "pending" } : { kind: "value", value },
});

/**
 * Drives of one section. `rv` carries what the rails say (see rails.ts): u and
 * z of the rail roles. Without it (only before rails exist) the bottom corners
 * fall back to the flat sole, z = 0.
 */
export function sectionDrives(g: SectionGeometry, rv?: RailValues): Drive[] {
  const id = g.id,
    out: Drive[] = [
      drive(id, "medial", 0, "u", "Medial landmark on the top outline", 0),
      drive(
        id,
        "lateral",
        0,
        "u",
        "Lateral landmark on the top outline",
        g.width,
      ),
      drive(
        id,
        "crown",
        0,
        "u",
        "Where the cut meets the centre plane",
        g.centreU,
      ),
      drive(
        id,
        "crown",
        1,
        "z",
        "Upper height at that station (side view)",
        g.crownHeight,
      ),
      drive(id, "sole", 1, "z", "Flat sole", 0),
    ];
  if (!rv) {
    out.push(
      drive(id, "lateral_bottom", 1, "z", "Flat sole", 0),
      drive(id, "medial_bottom", 1, "z", "Flat sole", 0),
    );
    return out;
  }
  for (const [role, v] of Object.entries(rv)) {
    if (!v) continue;
    const nice = role.replace(/_/g, " ");
    if (v.u !== undefined)
      out.push(
        drive(id, role, 0, "u", `Cut meets the ${nice} rail (plan)`, v.u),
      );
    out.push(
      drive(
        id,
        role,
        1,
        "z",
        `${nice} rail height at the cut (elevation)`,
        v.z,
      ),
    );
  }
  return out;
}

/** Closed starting section: a rounded, slightly asymmetric last-like oval. */
const P = (role: string, pos: Vec2): CurvePoint => ({
  role,
  pos,
  mode: "auto",
  handleIn: [0, 0],
  handleOut: [0, 0],
});

/**
 * Designed starting values for a section's bottom (conventions, not measured):
 * - The bottom is FLAT: `medial_bottom` and `lateral_bottom` are corners and
 *   the two segments around `sole` are straight lines, so the sole can be
 *   nailed to a plane (user requirement).
 * - The corners are tucked in by BOTTOM_INSET mm from the medial/lateral edge:
 *   a last is widest at or very near its bottom and widens only slightly above
 *   it (user observation), so the widest point (`medial`/`lateral`, driven by
 *   the top outline) sits just above the corner, WALL_RISE mm high. Both are
 *   free to edit; only the corner height (z = 0) is a locked drive.
 */
export const BOTTOM_INSET = 3;
export const WALL_RISE = 12;

/**
 * Synthetic starting shape from the section's own width and crown height; a
 * designed oval with a flat bottom, not a measurement. Fallbacks (W 60, height
 * 50, crown at W/2) apply when the cut or upper height is unknown.
 */
export function seedSection(g: SectionGeometry | null): EditableCurve {
  const W = g?.width ?? 60,
    h = g?.crownHeight ?? 50,
    uc = g?.centreU ?? W / 2,
    rise = Math.min(WALL_RISE, 0.3 * h),
    inset = Math.min(BOTTOM_INSET, W / 6),
    // Corners leave along the wall (handle towards the widest point), not
    // along the flat bottom.
    corner = (role: string, pos: Vec2): CurvePoint => ({
      ...P(role, pos),
      mode: "corner",
    }),
    raw: EditableCurve = {
      closed: true,
      points: [
        { ...P("sole", [W / 2, 0]), lineToNext: true },
        {
          ...corner("lateral_bottom", [W - inset, 0]),
          handleOut: [inset / 3, rise / 3],
        },
        P("lateral", [W, rise]),
        P("lateral_shoulder", [0.9 * W, 0.7 * h]),
        P("crown", [uc, h]),
        P("medial_shoulder", [0.1 * W, 0.7 * h]),
        P("medial", [0, rise]),
        {
          ...corner("medial_bottom", [inset, 0]),
          handleIn: [-inset / 3, rise / 3],
          lineToNext: true,
        },
      ],
    };
  return moveAnchor(raw, 0, raw.points[0]!.pos);
}

export function seedSections(
  top: EditableCurve,
  dorsal: EditableCurve,
): Record<SectionId, EditableCurve> {
  const out = {} as Record<SectionId, EditableCurve>;
  for (const id of SECTION_IDS)
    out[id] = reconcileSection(
      seedSection(sectionGeometry(top, dorsal, id)),
      sectionGeometry(top, dorsal, id),
      [],
    );
  return out;
}

export function reconcileSection(
  curve: EditableCurve,
  g: SectionGeometry | null,
  unlocked: readonly string[],
  rv?: RailValues,
): EditableCurve {
  return g ? reconcileCurve(curve, sectionDrives(g, rv), unlocked) : curve;
}

/** Perimeter of the closed section as drawn (sole included), mm. */
export const sectionGirth = (c: EditableCurve): number => curveLength(c);
