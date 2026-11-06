import { describe, expect, it } from "vitest";
import { joinLoop, pairRoles } from "~/lib/studio/rail-loop";
import { defaultDoc } from "~/lib/studio/document";
import { linesOf, loopIndex, railLine } from "~/lib/studio/focus";

describe("focus: which line a 2D pane shows for a 3D selection", () => {
  const d = defaultDoc(),
    counts = (k: "bottom" | "shoulder") =>
      [
        d.rails.plan[pairRoles(k).medial].points.length,
        d.rails.plan[pairRoles(k).lateral].points.length,
      ] as const;

  it("a derived rail shows its pair's plan loop and its own elevation", () => {
    expect(railLine("lateral_shoulder").focus).toEqual({
      outline: "shoulder",
      sideCurve: "lateral_shoulder",
    });
  });
  it("the widest rails use the top outline as plan; sole and crown the centre contour", () => {
    expect(railLine("medial").focus).toEqual({
      outline: "top",
      sideCurve: "medial",
    });
    expect(railLine("sole").focus).toEqual({ sideCurve: "centre" });
    expect(railLine("crown").focus).toEqual({ sideCurve: "centre" });
  });
  it("maps a plan point to its index in the closed loop", () => {
    for (const k of ["bottom", "shoulder"] as const) {
      const { medial, lateral } = pairRoles(k),
        loop = joinLoop(d.rails.plan[medial], d.rails.plan[lateral]),
        [nm, nl] = counts(k);
      for (let i = 1; i < nm - 1; i++)
        expect(loop.points[loopIndex("medial", i, nm, nl)]!.role).toBe(
          `medial_${d.rails.plan[medial].points[i]!.role}`,
        );
      for (let j = 1; j < nl - 1; j++)
        expect(loop.points[loopIndex("lateral", j, nm, nl)]!.role).toBe(
          `lateral_${d.rails.plan[lateral].points[j]!.role}`,
        );
      expect(loopIndex("lateral", 0, nm, nl)).toBe(0);
      expect(loopIndex("lateral", nl - 1, nm, nl)).toBe(nm - 1);
    }
  });
  it("lists every line through a node, rail first, with the selected point's indices", () => {
    const lines = linesOf(
      [
        { curve: "plan:lateral_bottom", index: 2 },
        { curve: "elev:lateral_bottom", index: 2 },
        { curve: "section:ball", index: 1 },
      ],
      counts,
    );
    expect(lines.map((l) => l.id)).toEqual([
      "rail:lateral_bottom",
      "section:ball",
    ]);
    expect(lines[0]!.focus.sideIndex).toBe(2);
    expect(lines[0]!.focus.topIndex).toBeGreaterThan(0);
    // the section pane gets the section and the selected point in it
    expect(lines[1]!.focus).toEqual({ section: "ball", sectionIndex: 1 });
  });
  it("a top-outline point on the lateral rail offers both lines", () => {
    const lines = linesOf(
      [
        { curve: "top", index: 7 },
        { curve: "elev:lateral", index: 3 },
      ],
      counts,
    );
    expect(lines.map((l) => l.id)).toEqual(["rail:lateral", "top"]);
    expect(lines[0]!.focus).toMatchObject({
      outline: "top",
      sideCurve: "lateral",
      topIndex: 7,
      sideIndex: 3,
    });
  });
});
