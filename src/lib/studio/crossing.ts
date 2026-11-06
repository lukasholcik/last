import {
  insertPoint,
  moveAnchor,
  nearestOnCurve,
  type EditableCurve,
  type Vec2,
} from "~/lib/curves";
import type { StudioDoc } from "./document";
import {
  PLAN_ROLES,
  railValues,
  type ElevRole,
  type PlanRole,
  type RailSet,
} from "./rails";
import { sectionGeometry, type SectionId } from "./section";
import { dorsalDrives, sideContext } from "./side";

/**
 * CROSSINGS: where a section meets a rail or the side contour.
 *
 * Problem (user report): a section's point at such a crossing and the rail
 * (or contour) through it describe the SAME 3D point. The rails own it: the
 * section point is a locked drive that follows them, and the loft builds its
 * anchors from the rails. The only way to move the section's copy was to
 * unlock it, which detached it: the section line moved, the surface did not,
 * and the two silently disagreed (28 mm at the ball in the user's model).
 *
 * DECISION (user, "combine shared point and owner/derived", edit stays local):
 * the rail/contour stays the owner, but dragging the section's point is
 * written back to it. `writeBackSection` is called by `withSection` before the
 * drives are re-applied, so the section point ends up exactly where it was
 * dragged, because the owner now passes through it, and nothing disagrees.
 *
 * The write is LOCAL (user decision): the owner curve is pulled through the
 * new point at the crossing only. If it has an anchor within `ANCHOR_TOL` of
 * the crossing that anchor moves; otherwise a point is inserted at the
 * crossing by de Casteljau subdivision (shape unchanged) and then moved. Only
 * the segments next to that anchor change (plus the handles of `auto`
 * neighbours, which re-derive); the rest of the rail is untouched. Rejected:
 * moving the whole rail, or re-fitting it by least squares: it changes what
 * the user did not touch.
 *
 * What is written (see `writesBack`):
 *  - bottoms and shoulders (plan roles): u moves the PLAN rail's crossing with
 *    the cut, z moves the ELEVATION rail at the crossing's station. The cut is
 *    tilted, so a new u also moves the crossing's station y; the elevation
 *    anchor moves with it.
 *  - medial / lateral: z moves the elevation rail at the outline landmark's
 *    station. Their u is the outline landmark (a different owner, the top
 *    outline) and stays locked: the outline is edited in the Top view.
 *  - crown: z moves the side contour's upper (`dorsal`) at the station where
 *    the cut meets the centre plane. u stays locked (it IS the centre plane).
 *
 * An UNLOCKED drive is not written back: unlocking means "detach, this section
 * point is mine". That stays available, but the section is then ignored by
 * the surface at that point; `sectionGaps` reports how far.
 *
 * Limits: only positions are written; a section's handles are not carried to
 * the rail's tangent. The crossing must exist (a rail that misses the cut
 * writes nothing). A rail that doubles back along y is not supported (see
 * rails.ts). Anchors with a drive on the contour (heel back, toe tip, ...) and
 * a rail's end points are never moved; a point is inserted next to them.
 */
export function writesBack(role: string | undefined, axis: 0 | 1): boolean {
  if (!role) return false;
  if (role === "crown" || role === "medial" || role === "lateral")
    return axis === 1;
  return (PLAN_ROLES as readonly string[]).includes(role);
}

/** An anchor this close to the crossing is moved; farther, one is inserted. */
const ANCHOR_TOL = 1.5;
/** The curve must pass this close to where the crossing is believed to be. */
const ON_CURVE_TOL = 0.75;
const EPS = 1e-6;

/** Move the curve so that what passed through `from` passes through `to`. */
export function pullThrough(
  c: EditableCurve,
  from: Vec2,
  to: Vec2,
  avoid: ReadonlySet<string> = new Set(),
): EditableCurve {
  const d: Vec2 = [to[0] - from[0], to[1] - from[1]];
  if (Math.hypot(d[0], d[1]) < EPS) return c;
  let best = -1,
    bestD = ANCHOR_TOL;
  c.points.forEach((p, i) => {
    if (i === 0 || i === c.points.length - 1) return;
    if (p.role && avoid.has(p.role)) return;
    const dist = Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1]);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  });
  if (best >= 0) {
    const p = c.points[best]!.pos;
    return moveAnchor(c, best, [p[0] + d[0], p[1] + d[1]]);
  }
  const hit = nearestOnCurve(c, from);
  if (!hit || hit.distance > ON_CURVE_TOL) return c;
  const { curve, index } = insertPoint(c, hit.segment, hit.t),
    p = curve.points[index]!.pos;
  return moveAnchor(curve, index, [p[0] + d[0], p[1] + d[1]]);
}

const driveId = (id: SectionId, role: string, axis: 0 | 1) =>
  `${id}/${role}:${axis}`;

/**
 * Write the edited section's crossing points back to the rails and the
 * contour. `doc.sections[id]` is the edited curve; the rails are compared with
 * it, not with the section as it was, so a drag that also moved the rails (a
 * merged node dragged in 3D) is not applied twice. Three passes: inserting a
 * point or an `auto` neighbour re-deriving shifts the crossing a little, and
 * each pass corrects the remainder.
 */
export function writeBackSection(doc: StudioDoc, id: SectionId): StudioDoc {
  const sec = doc.sections[id],
    ctx = sideContext(doc.top, doc.params),
    avoid = new Set("error" in ctx ? [] : dorsalDrives(ctx).map((d) => d.role));
  let next = doc;
  for (let pass = 0; pass < 3; pass++) {
    const g = sectionGeometry(next.top, next.dorsal, id);
    if (!g) return doc;
    const rv = railValues(g, next.rails),
      at = (u: number): Vec2 => [
        g.medial[0] + (u / g.width) * (g.lateral[0] - g.medial[0]),
        g.medial[1] + (u / g.width) * (g.lateral[1] - g.medial[1]),
      ];
    let plan: Record<PlanRole, EditableCurve> = next.rails.plan,
      elev: Record<ElevRole, EditableCurve> = next.rails.elev,
      dorsal = next.dorsal,
      moved = false;
    const free = (role: string, axis: 0 | 1) =>
      !next.unlocked.includes(driveId(id, role, axis));
    for (const p of sec.points) {
      const role = p.role;
      if (!role) continue;
      if (role === "crown") {
        const h = g.crownHeight,
          s = g.centreStation;
        if (h === null || s === null || !free(role, 1)) continue;
        if (Math.abs(p.pos[1] - h) < EPS) continue;
        dorsal = pullThrough(dorsal, [s, h], [s, p.pos[1]], avoid);
        moved = true;
        continue;
      }
      const v = rv[role];
      if (v?.z == null) continue;
      if (role === "medial" || role === "lateral") {
        if (!free(role, 1) || Math.abs(p.pos[1] - v.z) < EPS) continue;
        const y = role === "medial" ? g.medial[1] : g.lateral[1];
        elev = {
          ...elev,
          [role]: pullThrough(elev[role], [y, v.z], [y, p.pos[1]]),
        };
        moved = true;
        continue;
      }
      if (!(PLAN_ROLES as readonly string[]).includes(role)) continue;
      if (v.u === null || v.u === undefined) continue;
      const r = role as PlanRole,
        u1 = free(role, 0) ? p.pos[0] : v.u,
        z1 = free(role, 1) ? p.pos[1] : v.z;
      if (Math.abs(u1 - v.u) < EPS && Math.abs(z1 - v.z) < EPS) continue;
      const c0 = at(v.u),
        c1 = at(u1);
      plan = { ...plan, [r]: pullThrough(plan[r], c0, c1) };
      elev = { ...elev, [r]: pullThrough(elev[r], [c0[1], v.z], [c1[1], z1]) };
      moved = true;
    }
    if (!moved) break;
    const rails: RailSet = { plan, elev };
    next = { ...next, rails, dorsal };
  }
  return next;
}

/**
 * How far each UNLOCKED crossing point of a section is from what the rails and
 * the contour say, mm (u and z combined). Read-only: a check, it never moves
 * geometry. Where this is large the surface ignores the section's edit.
 */
export function sectionGaps(
  doc: StudioDoc,
  id: SectionId,
): { role: string; axis: 0 | 1; gap: number }[] {
  const g = sectionGeometry(doc.top, doc.dorsal, id);
  if (!g) return [];
  const rv = railValues(g, doc.rails),
    out: { role: string; axis: 0 | 1; gap: number }[] = [];
  for (const p of doc.sections[id].points) {
    const role = p.role;
    if (!role) continue;
    const want: [number | null | undefined, number | null | undefined] =
      role === "crown"
        ? [undefined, g.crownHeight]
        : [rv[role]?.u, rv[role]?.z];
    for (const axis of [0, 1] as const) {
      const w = want[axis];
      if (w === null || w === undefined || !writesBack(role, axis)) continue;
      if (!doc.unlocked.includes(driveId(id, role, axis))) continue;
      const gap = Math.abs(p.pos[axis] - w);
      if (gap > 0.5) out.push({ role, axis, gap });
    }
  }
  return out;
}
