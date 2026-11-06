import { ELEV_ROLES, RAIL_LABEL, hasPlan, type ElevRole } from "./rails";
import { pairOf, type PairKind } from "./rail-loop";
import type { CurveKey, Member } from "./space-edit";
import { SECTION_LABEL, type SectionId } from "./section";

/**
 * LINES AND FOCUS: how a selection in the 3D view is shown in the 2D views.
 *
 * A LINE is one editable curve as the user thinks of it: a rail, the top
 * outline, or a section. A control point in space sits on several lines (the
 * rail it belongs to, the section through it, the outline when it is the
 * widest rail), so selecting a point offers its lines and the 2D panes show
 * the chosen one (the user picks when there are several).
 *
 * A line's FOCUS says what each 2D pane must show to display it, in the terms
 * the panes already use:
 *  - the TOP pane edits an `outline`: the top outline, or the plan loop of a
 *    rail pair (bottoms, shoulders). The widest rails (lateral, medial) have no
 *    plan curve of their own: their plan IS the top outline.
 *  - the SIDE pane edits a `sideCurve`: the centre contour (sole + crown) or
 *    one elevation rail.
 *  - the SECTION pane edits one section.
 * A focus names only the panes the line is drawn in; the others stay as they
 * were. `topIndex`/`sideIndex` are the selected point's index in the curve the
 * pane then edits (undefined = the line is selected as a whole).
 *
 * The sole and the crown are two halves of the centre contour: they are shown
 * in the Side pane (`sideCurve: "centre"`) and have no plan curve.
 * The workspace has one Section pane, which shows the section picked.
 */
export type LineId =
  `rail:${ElevRole | "sole" | "crown"}` | "top" | `section:${SectionId}`;

export interface Focus {
  readonly outline?: "top" | PairKind;
  readonly sideCurve?: "centre" | ElevRole;
  readonly section?: SectionId;
  readonly sectionIndex?: number;
  readonly topIndex?: number;
  readonly sideIndex?: number;
}
export interface Line {
  readonly id: LineId;
  readonly label: string;
  readonly focus: Focus;
}

const RAIL_NAME = (r: ElevRole | "sole" | "crown") =>
  r === "sole" ? "Sole" : r === "crown" ? "Crown" : RAIL_LABEL[r];

/** The line of one rail role, shown as a whole (no point selected). */
export function railLine(role: ElevRole | "sole" | "crown"): Line {
  const centre = role === "sole" || role === "crown";
  return {
    id: `rail:${role}`,
    label: `${RAIL_NAME(role)} rail`,
    focus: centre
      ? { sideCurve: "centre" }
      : {
          outline: hasPlan(role) ? pairOf(role) : "top",
          sideCurve: role,
        },
  };
}

export function sectionLine(id: SectionId): Line {
  return {
    id: `section:${id}`,
    label: `Section · ${SECTION_LABEL[id]}`,
    focus: { section: id },
  };
}

export const TOP_LINE: Line = {
  id: "top",
  label: "Top outline",
  focus: { outline: "top" },
};

/** Index of a plan-rail point in its pair's closed loop (see rail-loop.ts). */
export function loopIndex(
  side: "medial" | "lateral",
  i: number,
  nMedial: number,
  nLateral: number,
): number {
  if (i === 0) return 0;
  if (side === "medial") return i;
  if (i === nLateral - 1) return nMedial - 1;
  return nMedial - 1 + (nLateral - 1 - i);
}

/**
 * The lines through a node, from its members. The first is the default: a rail
 * (the member's elevation or plan curve), then the top outline, then the
 * section. `planCounts` gives the point counts of the two plan rails of a pair
 * so a plan member can be mapped to its loop index.
 */
export function linesOf(
  members: readonly Pick<Member, "curve" | "index">[],
  planCounts: (kind: PairKind) => readonly [number, number],
): Line[] {
  const rails = new Map<ElevRole, Line>(),
    out: Line[] = [];
  const rail = (r: ElevRole) => {
    let l = rails.get(r);
    if (!l) {
      l = railLine(r);
      rails.set(r, l);
    }
    return l;
  };
  const patch = (l: Line, f: Partial<Focus>) => {
    const next = { ...l, focus: { ...l.focus, ...f } };
    rails.set(l.id.slice("rail:".length) as ElevRole, next);
  };
  let top: Line | null = null,
    section: Line | null = null;
  for (const m of members) {
    const c: CurveKey = m.curve;
    if (c === "top") {
      top = { ...TOP_LINE, focus: { outline: "top", topIndex: m.index } };
    } else if (c.startsWith("section:")) {
      {
        const id = c.slice("section:".length) as SectionId;
        section ??= {
          ...sectionLine(id),
          focus: { section: id, sectionIndex: m.index },
        };
      }
    } else if (c.startsWith("elev:")) {
      const r = c.slice("elev:".length) as ElevRole;
      patch(rail(r), { sideIndex: m.index });
    } else if (c.startsWith("plan:")) {
      const r = c.slice("plan:".length) as ElevRole,
        kind = pairOf(r),
        [nm, nl] = planCounts(kind);
      patch(rail(r), {
        topIndex: loopIndex(
          r.startsWith("medial") ? "medial" : "lateral",
          m.index,
          nm,
          nl,
        ),
      });
    }
  }
  // lateral / medial rails draw their plan as the top outline: the point's
  // index there is the index in the top outline, taken from the "top" member
  for (const [r, l] of rails)
    if (!hasPlan(r) && top?.focus.topIndex !== undefined)
      rails.set(r, {
        ...l,
        focus: { ...l.focus, topIndex: top.focus.topIndex },
      });
  out.push(...rails.values());
  if (top) out.push(top);
  if (section) out.push(section);
  return out;
}

export const isElevRole = (r: string): r is ElevRole =>
  (ELEV_ROLES as readonly string[]).includes(r);
