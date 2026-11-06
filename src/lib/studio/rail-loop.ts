import { normalize, type CurvePoint, type EditableCurve } from "~/lib/curves";
import type { PlanRole } from "./rails";
import type { Drive } from "./side";

/**
 * PAIRED PLAN RAILS as one closed outline.
 *
 * The medial and lateral rail of a pair (bottoms, shoulders) meet at the heel
 * back and the toe tip, so in plan they are ONE closed outline, like the top
 * outline (which already is the medial + lateral widest rail). The "sole edge"
 * outline is the bottom pair, the "upper edge" outline the shoulder pair.
 * Storage stays two open curves per pair (the section drives and the loft read
 * those); the closed loop is a derived editing view, joined and split here the
 * same way the side contour joins the sole and the upper.
 *
 * Loop order matches the top outline: heel_back, medial points heel to toe,
 * toe_tip, lateral points toe to heel. Roles: shared ends `heel_back` /
 * `toe_tip`, others prefixed `medial_` / `lateral_` so they stay unique.
 * The two shared points are corners carrying the handles of both rails, so the
 * loop draws exactly what the rails are. Points inserted in the loop go to the
 * half they fall in.
 */
export type PairKind = "bottom" | "shoulder";
export const PAIR_LABEL: Record<PairKind, string> = {
  bottom: "Sole edge (bottoms)",
  shoulder: "Upper edge (shoulders)",
};
export const pairRoles = (k: PairKind) => ({
  medial: `medial_${k}` as PlanRole,
  lateral: `lateral_${k}` as PlanRole,
});
export const pairOf = (role: string): PairKind =>
  role.endsWith("bottom") ? "bottom" : "shoulder";

const flip = (p: CurvePoint): CurvePoint => ({
  ...p,
  handleIn: p.handleOut,
  handleOut: p.handleIn,
});
const prefix = (side: string, p: CurvePoint): CurvePoint => ({
  ...p,
  ...(p.role ? { role: `${side}_${p.role}` } : {}),
});
const strip = (side: string, p: CurvePoint): CurvePoint => {
  const { role, ...rest } = p;
  return role?.startsWith(`${side}_`)
    ? { ...rest, role: role.slice(side.length + 1) }
    : rest;
};

export function joinLoop(
  medial: EditableCurve,
  lateral: EditableCurve,
): EditableCurve {
  const m = medial.points,
    l = lateral.points,
    mh = m[0]!,
    mt = m[m.length - 1]!,
    lh = l[0]!,
    lt = l[l.length - 1]!;
  return {
    closed: true,
    points: [
      {
        ...mh,
        role: "heel_back",
        mode: "corner",
        handleIn: lh.handleOut,
        handleOut: mh.handleOut,
      },
      ...m.slice(1, -1).map((p) => prefix("medial", p)),
      {
        ...mt,
        role: "toe_tip",
        mode: "corner",
        handleIn: mt.handleIn,
        handleOut: lt.handleIn,
      },
      ...l
        .slice(1, -1)
        .map((p) => flip(prefix("lateral", p)))
        .reverse(),
    ],
  };
}

/** Inverse of `joinLoop`; returns `prev` if the loop lost its two shared points. */
export function splitLoop(
  loop: EditableCurve,
  prev: { medial: EditableCurve; lateral: EditableCurve },
): { medial: EditableCurve; lateral: EditableCurve } {
  const c = loop.points,
    iTip = c.findIndex((p) => p.role === "toe_tip");
  if (c[0]?.role !== "heel_back" || iTip < 1) return prev;
  const heel = c[0],
    tip = c[iTip]!,
    end = (p: CurvePoint, role: string): CurvePoint => ({
      ...p,
      role,
      mode: "corner",
    }),
    medial = normalize({
      closed: false,
      points: [
        { ...end(heel, "start"), handleIn: [0, 0] },
        ...c.slice(1, iTip).map((p) => strip("medial", p)),
        { ...end(tip, "end"), handleOut: [0, 0] },
      ],
    }),
    lateral = normalize({
      closed: false,
      points: [
        {
          ...end(heel, "start"),
          handleIn: [0, 0],
          handleOut: heel.handleIn,
        },
        ...c
          .slice(iTip + 1)
          .reverse()
          .map((p) => strip("lateral", flip(p))),
        {
          ...end(tip, "end"),
          handleIn: tip.handleOut,
          handleOut: [0, 0],
        },
      ],
    });
  return { medial, lateral };
}

/** The loop's two shared points follow the top outline (unlockable together). */
export function loopDrives(kind: PairKind, top: EditableCurve): Drive[] {
  const out: Drive[] = [];
  for (const [role, anchor, label] of [
    ["heel_back", "start", "Heel back"],
    ["toe_tip", "end", "Toe tip"],
  ] as const) {
    const p = top.points.find((q) => q.role === role)?.pos;
    for (const axis of [0, 1] as const)
      out.push({
        id: `rail-plan-${kind}/${anchor}:${axis}`,
        role,
        axis,
        label,
        source: `${label} of the top outline`,
        driver: p ? { kind: "value", value: p[axis] } : { kind: "pending" },
      });
  }
  return out;
}
