import { describe, expect, it } from "vitest";
import { moveAnchor } from "~/lib/curves";
import {
  defaultDoc,
  parseDoc,
  serializeDoc,
  withPlanLoop,
  withRail,
} from "~/lib/studio/document";
import {
  ELEV_ROLES,
  PLAN_ROLES,
  cutCrossing,
  railValues,
} from "~/lib/studio/rails";
import { joinLoop, splitLoop } from "~/lib/studio/rail-loop";
import { sectionGeometry } from "~/lib/studio/section";

const pos = (
  c: { points: readonly { role?: string; pos: readonly [number, number] }[] },
  r: string,
) => c.points.find((p) => p.role === r)!.pos;
const ballGeom = (d = defaultDoc()) =>
  sectionGeometry(d.top, d.dorsal, "ball")!;

describe("rails", () => {
  it("are seeded through the sections: 6 points each, heel to toe", () => {
    const d = defaultDoc();
    for (const r of PLAN_ROLES) expect(d.rails.plan[r].points).toHaveLength(6);
    for (const r of ELEV_ROLES) expect(d.rails.elev[r].points).toHaveLength(6);
  });
  it("end at the outline's heel back and toe tip", () => {
    const d = defaultDoc(),
      toe = pos(d.top, "toe_tip");
    expect(pos(d.rails.plan.lateral_bottom, "start")).toEqual([0, 0]);
    expect(pos(d.rails.plan.lateral_bottom, "end")).toEqual(toe);
    expect(pos(d.rails.elev.lateral_bottom, "end")[0]).toBeCloseTo(toe[1], 9);
  });
  it("the section's bottom corner is where the cut meets the rail", () => {
    const d = defaultDoc(),
      g = ballGeom(d),
      c = cutCrossing(g, d.rails.plan.lateral_bottom, "lateral")!;
    expect(pos(d.sections.ball, "lateral_bottom")[0]).toBeCloseTo(c.u, 6);
    expect(railValues(g, d.rails).lateral_bottom!.u).toBeCloseTo(c.u, 9);
  });
  it("raising the waist medial-bottom elevation rail lifts that section's corner (arch)", () => {
    const d = defaultDoc(),
      el = d.rails.elev.medial_bottom,
      i = el.points.findIndex((p) => p.role === "waist"),
      p = el.points[i]!.pos,
      d2 = withRail(d, "elev", "medial_bottom", moveAnchor(el, i, [p[0], 9]));
    expect(pos(d2.sections.waist, "medial_bottom")[1]).toBeCloseTo(9, 6);
    // other sections are untouched
    expect(pos(d2.sections.ball, "medial_bottom")[1]).toBeCloseTo(0, 6);
  });
  it("moving a plan rail changes where the section's point sits across", () => {
    const d = defaultDoc(),
      pl = d.rails.plan.lateral_shoulder,
      i = pl.points.findIndex((p) => p.role === "ball"),
      p = pl.points[i]!.pos,
      before = pos(d.sections.ball, "lateral_shoulder")[0],
      d2 = withRail(
        d,
        "plan",
        "lateral_shoulder",
        moveAnchor(pl, i, [p[0] - 6, p[1]]),
      );
    expect(pos(d2.sections.ball, "lateral_shoulder")[0]).toBeLessThan(
      before - 3,
    );
  });
  it("round-trip through JSON, and old saves without rails are seeded", () => {
    const d = defaultDoc();
    expect(JSON.parse(serializeDoc(parseDoc(serializeDoc(d))))).toEqual(
      JSON.parse(serializeDoc(d)),
    );
    const old = JSON.parse(serializeDoc(d)) as Record<string, unknown>;
    delete old.rails;
    const back = parseDoc(JSON.stringify(old));
    expect(back.rails.elev.medial.points).toHaveLength(6);
  });
});

describe("paired plan rails as one outline", () => {
  it("join then split returns the same rails", () => {
    const d = defaultDoc(),
      a = d.rails.plan.medial_bottom,
      b = d.rails.plan.lateral_bottom,
      loop = joinLoop(a, b);
    expect(loop.closed).toBe(true);
    expect(loop.points).toHaveLength(a.points.length + b.points.length - 2);
    const back = splitLoop(loop, { medial: a, lateral: b });
    for (const [x, y] of [
      [back.medial, a],
      [back.lateral, b],
    ] as const) {
      expect(x.points.map((p) => p.role)).toEqual(y.points.map((p) => p.role));
      x.points.forEach((p, i) => {
        expect(p.pos[0]).toBeCloseTo(y.points[i]!.pos[0], 9);
        expect(p.pos[1]).toBeCloseTo(y.points[i]!.pos[1], 9);
      });
    }
  });
  it("editing one side of the loop moves only that rail and the section follows", () => {
    const d = defaultDoc(),
      loop = joinLoop(d.rails.plan.medial_bottom, d.rails.plan.lateral_bottom),
      i = loop.points.findIndex((p) => p.role === "lateral_ball"),
      q = loop.points[i]!.pos,
      d2 = withPlanLoop(d, "bottom", moveAnchor(loop, i, [q[0] + 4, q[1]]));
    expect(d2.rails.plan.medial_bottom.points.map((p) => p.pos[0])).toEqual(
      d.rails.plan.medial_bottom.points.map((p) => p.pos[0]),
    );
    expect(pos(d2.sections.ball, "lateral_bottom")[0]).toBeGreaterThan(
      pos(d.sections.ball, "lateral_bottom")[0] + 2,
    );
  });
});
