import { describe, expect, it } from "vitest";
import { moveAnchor, parseCurve, serializeCurve } from "~/lib/curves";
import {
  defaultTopOutline,
  topMeasures,
  widthAtY,
} from "~/lib/studio/top-outline";

describe("top outline", () => {
  const c = defaultTopOutline();

  it("is a closed, labelled outline with a movable ball", () => {
    expect(c.closed).toBe(true);
    expect(c.points.map((p) => p.role)).toContain("medial_ball");
    expect(c.points.every((p) => p.role)).toBe(true);
  });

  it("measures length and station widths from the curve", () => {
    const m = topMeasures(c);
    expect(m.length).toBeGreaterThan(268);
    expect(m.length).toBeLessThan(285);
    expect(m.stations.map((s) => s.id)).toEqual([
      "heel",
      "waist",
      "ball",
      "toe",
    ]);
    const ball = m.stations.find((s) => s.id === "ball")!;
    expect(ball.width).toBeGreaterThan(90);
    expect(ball.ratio).toBeGreaterThan(0.6);
    expect(ball.ratio).toBeLessThan(0.75);
  });

  it("moving a ball point in both axes changes the station", () => {
    const i = c.points.findIndex((p) => p.role === "medial_ball");
    const moved = moveAnchor(c, i, [-56, 200]);
    const before = topMeasures(c).stations.find((s) => s.id === "ball")!;
    const after = topMeasures(moved).stations.find((s) => s.id === "ball")!;
    expect(after.y).toBeGreaterThan(before.y);
    expect(widthAtY(moved, 195)!).toBeGreaterThan(widthAtY(c, 195)!);
  });

  it("keeps roles through insert and delete", async () => {
    const { insertPoint, removePoint } = await import("~/lib/curves");
    const { curve } = insertPoint(c, 0, 0.5);
    expect(curve.points[1]!.role).toBeUndefined();
    expect(removePoint(curve, 1).points.map((p) => p.role)).toEqual(
      c.points.map((p) => p.role),
    );
  });

  it("keeps landmark roles through the autosave JSON", () => {
    expect(parseCurve(serializeCurve(c)).points.map((p) => p.role)).toEqual(
      c.points.map((p) => p.role),
    );
  });
});
