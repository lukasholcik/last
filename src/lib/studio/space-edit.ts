import {
  moveAnchor,
  moveHandle,
  sampleCurve,
  type EditableCurve,
  type PointMode,
  type Vec2,
} from "~/lib/curves";
import { flatToPosed, posedToFlat, type UpperFrame } from "./contour";
import { crossings, type Vec3 } from "./loft";
import { withCurve, withRail, withSection, type StudioDoc } from "./document";
import {
  PLAN_ROLES,
  ELEV_ROLES,
  RAIL_LABEL,
  type ElevRole,
  type PlanRole,
} from "./rails";
import {
  SECTION_IDS,
  SECTION_LABEL,
  heightAtStation,
  sectionGeometry,
  type SectionId,
} from "./section";

/**
 * EDITING IN 3D. The 3D view shows the control points of the curves that are
 * already edited in the 2D views, as markers, and dragging one edits the same
 * curve (no new model data):
 *  - PLAN points: points of the top outline and of the four plan rails. They have x and y; the height shown is only where the rail's
 *    elevation puts them. Dragging moves them in the horizontal plane through
 *    the marker.
 *  - ELEVATION points: points of the six elevation rails. They have
 *    y and z; the across position shown is where the plan puts them. Dragging
 *    moves them in the vertical plane (constant x) through the marker.
 * Each marker therefore edits exactly the two coordinates its curve owns, the
 * third is ignored: this is the CAD working-plane idea, and it keeps the
 * plan and elevation of a rail independent as in the 2D views.
 *
 * SECTIONS in 3D. The two lines that cross at a rail point are the rail
 * (plan + elevation curves) and the SECTION through it, so the section's eight
 * points are members too. A section point is edited in its own cut plane
 * (the vertical plane through the medial/lateral landmark pair; coordinates u
 * along the cut, z up), exactly the section editor's frame. Its anchors are
 * still driven by the rails (see rails.ts), so dragging a driven anchor snaps
 * back; its handles are free. Limit: with a raised heel the cut plane is kept
 * vertical in the flat frame, so the drag is an approximation, as for plan
 * points.
 *
 * ONE NODE PER PLACE. A plan point and an elevation point of the same rail
 * usually sit at the same spot in space (they are two views of one rail point),
 * and drawing both made a ball and a cube overlap. Anchors closer than
 * `MERGE_TOL` are merged into one NODE that carries all its members. Selecting
 * a node shows the handles of every member at once, grouped into pairs (see
 * `pairHandles`: one pair per rail, one for the top outline, one per section).
 * Dragging a node moves all its members: a node that mixes plan and elevation
 * members has no single working plane, so it is dragged in the plane facing
 * the camera and each member keeps only the two coordinates it owns (all are
 * fed by the same hit, so y agrees). `MERGE_TOL` is a designed tolerance (1 mm,
 * far below any visible gap at the model's scale), not a measured value.
 *
 * With the heel height applied the 3D positions are posed; the drag point is
 * mapped back to the flat frame with `posedToFlat` (same frame rule as the Side
 * view). For a PLAN marker only the station (flat y) and x are used; since the
 * plan point's flat height is not editable here, this is an approximation when
 * the heel is raised. Bezier handles are shown for the selected marker only.
 *
 * Not supported in 3D (use the 2D views): adding or deleting points, mode
 * changes, the centre contour (sole + crown), sections.
 */
export type CurveKey =
  "top" | `plan:${PlanRole}` | `elev:${ElevRole}` | `section:${SectionId}`;
export type Kind = "plan" | "elev" | "section";
export type MarkerPart = "anchor" | "in" | "out";
export const MERGE_TOL = 1;
export interface Member {
  readonly curve: CurveKey;
  readonly index: number;
  readonly kind: Kind;
  /** Handle markers only: which handle of this point the marker drives. */
  readonly side?: "in" | "out";
}
export interface Marker {
  readonly id: string;
  readonly curve: CurveKey;
  readonly index: number;
  readonly part: MarkerPart;
  /** "both" = a node mixing plan and elevation members (camera-plane drag). */
  readonly kind: Kind | "both";
  /** Unit normal of the drag plane (ignored for "both": camera plane). */
  readonly normal: Vec3;
  /** World position (heel height applied when a frame is given). */
  readonly pos: Vec3;
  readonly label: string;
  /** Point mode (auto / smooth / symmetric / corner) of the point, for the look. */
  readonly mode: PointMode;
  /** Anchors: every curve point at this place (the first is this marker). */
  readonly members: readonly Member[];
  /** Handles: the selected anchor they belong to, and where it is. */
  readonly owner?: string;
  readonly from?: Vec3;
}

export const markerId = (
  c: CurveKey,
  i: number,
  part: MarkerPart = "anchor",
) => (part === "anchor" ? `${c}#${i}` : `${c}#${i}:${part}`);

const curveOf = (doc: StudioDoc, k: CurveKey): EditableCurve =>
  k === "top"
    ? doc.top
    : k.startsWith("section:")
      ? doc.sections[k.slice(8) as SectionId]
      : k.startsWith("plan:")
        ? doc.rails.plan[k.slice(5) as PlanRole]
        : doc.rails.elev[k.slice(5) as ElevRole];

function curveLabel(k: CurveKey) {
  if (k === "top") return "Top outline";
  if (k.startsWith("section:"))
    return `${SECTION_LABEL[k.slice(8) as SectionId]} section`;
  const role = k.slice(5) as ElevRole;
  return `${RAIL_LABEL[role]} rail (${k.startsWith("plan:") ? "plan" : "elevation"})`;
}

/** Across position (x) of a rail at height-profile station y. */
function railX(doc: StudioDoc, role: ElevRole) {
  const outline = sampleCurve(doc.top, 32),
    plan =
      role === "medial" || role === "lateral"
        ? null
        : sampleCurve(doc.rails.plan[role], 24);
  return (y: number): number => {
    const o = crossings(outline, y),
      lo = o.length ? Math.min(...o) : 0,
      hi = o.length ? Math.max(...o) : 0;
    if (role === "medial") return lo;
    if (role === "lateral") return hi;
    const c = crossings(plan!, y);
    if (!c.length) return role.startsWith("medial") ? lo : hi;
    const want = role.startsWith("medial") ? lo : hi;
    return c.reduce((a, b) =>
      Math.abs(b - want) < Math.abs(a - want) ? b : a,
    );
  };
}

export function editMarkers(
  doc: StudioDoc,
  frame: UpperFrame | null,
  selected: string | null,
): Marker[] {
  const pose = (p: Vec3): Vec3 => {
    if (!frame) return p;
    const q = flatToPosed(frame, [p[1], p[2]]);
    return [p[0], q[0], q[1]];
  };
  const zAt = (role: ElevRole, y: number) =>
    heightAtStation(doc.rails.elev[role], y) ?? 0;
  const nodes: {
    id: string;
    normal: Vec3;
    pos: Vec3;
    labels: string[];
    members: Member[];
    mode: PointMode;
  }[] = [];
  const handles: (Omit<Marker, "members"> & { rail: string | null })[] = [];
  const add = (k: CurveKey) => {
    const c = curveOf(doc, k),
      sec = k.startsWith("section:")
        ? sectionGeometry(doc.top, doc.dorsal, k.slice(8) as SectionId)
        : null;
    if (k.startsWith("section:") && !sec) return;
    const plan = k === "top" || k.startsWith("plan:"),
      kind: Kind = sec ? "section" : plan ? "plan" : "elev",
      role = k === "top" || sec ? null : (k.slice(5) as ElevRole),
      x = role && !plan ? railX(doc, role) : null,
      normal: Vec3 = sec
        ? [
            -(sec.lateral[1] - sec.medial[1]) / sec.width,
            (sec.lateral[0] - sec.medial[0]) / sec.width,
            0,
          ]
        : plan
          ? [0, 0, 1]
          : [1, 0, 0],
      to3 = (p: Vec2): Vec3 =>
        sec
          ? pose([
              sec.medial[0] +
                (p[0] / sec.width) * (sec.lateral[0] - sec.medial[0]),
              sec.medial[1] +
                (p[0] / sec.width) * (sec.lateral[1] - sec.medial[1]),
              p[1],
            ])
          : plan
            ? pose([
                p[0],
                p[1],
                zAt(role ?? (p[0] < 0 ? "medial" : "lateral"), p[1]),
              ])
            : pose([x!(p[0]), p[0], p[1]]);
    c.points.forEach((p, i) => {
      const name = p.role ? p.role.replace(/_/g, " ") : `point ${i + 1}`,
        pos = to3(p.pos),
        label = `${curveLabel(k)} · ${name}`,
        member: Member = { curve: k, index: i, kind },
        node = nodes.find((n) => dist3(n.pos, pos) < MERGE_TOL);
      if (node) {
        node.members.push(member);
        node.labels.push(label);
      } else
        nodes.push({
          id: markerId(k, i),
          normal,
          pos,
          labels: [label],
          members: [member],
          mode: p.mode,
        });
      if (selected === (node?.id ?? markerId(k, i)))
        for (const part of ["in", "out"] as const) {
          const h = part === "in" ? p.handleIn : p.handleOut;
          if (h[0] === 0 && h[1] === 0) continue;
          handles.push({
            id: markerId(k, i, part),
            curve: k,
            index: i,
            part,
            kind,
            normal,
            pos: to3([p.pos[0] + h[0], p.pos[1] + h[1]]),
            label: `${label} · handle ${part}`,
            owner: node?.id ?? markerId(k, i),
            from: pos,
            mode: p.mode,
            // Only the plan and elevation halves of the SAME rail pair up; the
            // top outline and the sections never do (see "ONE HANDLE PAIR").
            rail: role && !sec ? role : null,
          });
        }
    });
  };
  add("top");
  for (const r of PLAN_ROLES) add(`plan:${r}`);
  for (const r of ELEV_ROLES) add(`elev:${r}`);
  for (const id of SECTION_IDS) add(`section:${id}`);
  const first = (m: Member) => ({ curve: m.curve, index: m.index });
  return [
    ...nodes.map((n): Marker => {
      const kinds = new Set(n.members.map((m) => m.kind)),
        f = first(n.members[0]!);
      return {
        id: n.id,
        ...f,
        part: "anchor",
        kind: kinds.size > 1 ? "both" : n.members[0]!.kind,
        normal: n.normal,
        pos: n.pos,
        label: n.labels.join(" + "),
        mode: n.mode,
        members: n.members,
      };
    }),
    ...pairHandles(handles),
  ];
}

/**
 * ONE HANDLE PAIR per rail point. A rail is stored as two curves (plan and
 * elevation) that share the station y, so their handles at a point are the two
 * projections of one 3D tangent handle, as in any 3D Bezier tool: one marker at
 * (x from the plan handle, y shared, z from the elevation handle). Dragging it
 * feeds the same hit to both curves, so the plan and elevation handles get the
 * same extent along y. That is the restriction of a true 3D Bezier; the 2D
 * views still allow different extents when needed.
 * Handles pair by direction along y (toward the toe / toward the heel), not by
 * in/out, because the two curves need not run the same way. Only the same rail
 * pairs: the top outline is a flattened curve with no height of its own and the
 * sections lie in their own plane, so both keep their own handles (a node where
 * an outline point, a rail and a section meet shows up to three pairs).
 * A merged marker has no single working plane, so it is dragged in the plane
 * facing the camera (kind "both").
 */
function pairHandles(
  hs: readonly (Omit<Marker, "members"> & { rail: string | null })[],
): Marker[] {
  const out: Marker[] = [],
    buckets = new Map<string, typeof hs>();
  const single = (h: (typeof hs)[number]): Marker => ({
    ...h,
    members: [
      {
        curve: h.curve,
        index: h.index,
        kind: h.kind as Kind,
        side: h.part as "in" | "out",
      },
    ],
  });
  for (const h of hs) {
    if (!h.rail || !h.from) {
      out.push(single(h));
      continue;
    }
    const dy = h.pos[1] - h.from[1],
      toToe = Math.abs(dy) > 1e-6 ? dy > 0 : h.part === "out",
      key = `${h.owner}|${h.rail}|${toToe}`;
    buckets.set(key, [...(buckets.get(key) ?? []), h]);
  }
  for (const group of buckets.values()) {
    const plan = group.find((h) => h.kind === "plan"),
      elev = group.find((h) => h.kind === "elev");
    if (!plan || !elev || group.length !== 2) {
      out.push(...group.map(single));
      continue;
    }
    out.push({
      ...plan,
      kind: "both",
      pos: [plan.pos[0], plan.pos[1], elev.pos[2]],
      label: `${RAIL_LABEL[plan.rail as ElevRole]} rail · handle`,
      members: group.map((h) => ({
        curve: h.curve,
        index: h.index,
        kind: h.kind as Kind,
        side: h.part as "in" | "out",
      })),
    });
  }
  return out;
}

const dist3 = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Move a marker to a world point on its drag plane. `constrain` keeps only the
 * larger of the two coordinate changes (Shift while dragging).
 */
export function dragMarker(
  doc: StudioDoc,
  frame: UpperFrame | null,
  m: Pick<Marker, "curve" | "index" | "part" | "kind"> &
    Partial<Pick<Marker, "members">>,
  hit: Vec3,
  constrain = false,
): StudioDoc {
  if (m.part === "anchor" && m.members && m.members.length > 1) {
    let next = doc;
    for (const k of m.members)
      next = dragOne(next, frame, { ...k, part: "anchor" }, hit, constrain);
    return next;
  }
  if (m.part !== "anchor" && m.members && m.members.length > 1) {
    let next = doc;
    for (const k of m.members)
      next = dragOne(
        next,
        frame,
        { ...k, part: k.side ?? m.part },
        hit,
        constrain,
      );
    return next;
  }
  const k = m.kind === "both" ? "plan" : m.kind;
  return dragOne(doc, frame, { ...m, kind: k }, hit, constrain);
}

function dragOne(
  doc: StudioDoc,
  frame: UpperFrame | null,
  m: {
    curve: CurveKey;
    index: number;
    part: MarkerPart;
    kind: Kind;
  },
  hit: Vec3,
  constrain: boolean,
): StudioDoc {
  const c = curveOf(doc, m.curve),
    p = c.points[m.index];
  if (!p) return doc;
  const base: Vec2 =
    m.part === "anchor"
      ? p.pos
      : [
          p.pos[0] + (m.part === "in" ? p.handleIn : p.handleOut)[0],
          p.pos[1] + (m.part === "in" ? p.handleIn : p.handleOut)[1],
        ];
  let target: Vec2;
  if (m.kind === "section") {
    const g = sectionGeometry(
      doc.top,
      doc.dorsal,
      m.curve.slice(8) as SectionId,
    );
    if (!g) return doc;
    const dx = g.lateral[0] - g.medial[0],
      dy = g.lateral[1] - g.medial[1],
      y0 = g.medial[1] + (base[0] / g.width) * dy,
      [y, z] = frame
        ? posedToFlat(frame, [hit[1], hit[2]], y0)
        : [hit[1], hit[2]];
    target = [
      ((hit[0] - g.medial[0]) * dx + (y - g.medial[1]) * dy) / g.width,
      z,
    ];
  } else if (m.kind === "plan") {
    const y = frame ? posedToFlat(frame, [hit[1], hit[2]], base[1])[0] : hit[1];
    target = [hit[0], y];
  } else
    target = frame
      ? posedToFlat(frame, [hit[1], hit[2]], base[0])
      : [hit[1], hit[2]];
  if (constrain) {
    const d0 = Math.abs(target[0] - base[0]),
      d1 = Math.abs(target[1] - base[1]);
    target = d0 >= d1 ? [target[0], base[1]] : [base[0], target[1]];
  }
  const next =
    m.part === "anchor"
      ? moveAnchor(c, m.index, target)
      : moveHandle(c, m.index, m.part, [
          target[0] - p.pos[0],
          target[1] - p.pos[1],
        ]);
  if (m.curve === "top") return withCurve(doc, "top", next);
  if (m.curve.startsWith("section:"))
    return withSection(doc, m.curve.slice(8) as SectionId, next);
  return withRail(
    doc,
    m.curve.startsWith("plan:") ? "plan" : "elev",
    m.curve.slice(5) as ElevRole,
    next,
  );
}
