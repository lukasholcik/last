import { describe, expect, it } from "vitest";
import { moveAnchor } from "~/lib/curves";
import { sectionGaps } from "~/lib/studio/crossing";
import { defaultDoc, withSection, withUnlocked } from "~/lib/studio/document";
import { buildLoft } from "~/lib/studio/loft";
import { upperFrame } from "~/lib/studio/contour";
import { railValues } from "~/lib/studio/rails";
import {
  heightAtStation,
  sectionGeometry,
  type SectionId,
} from "~/lib/studio/section";
import { sideContext, validContext } from "~/lib/studio/side";

// A section's point at a crossing with a rail or the contour is written back
// to its owner, locally (src/lib/studio/crossing.ts).
const point = (d: ReturnType<typeof defaultDoc>, id: SectionId, role: string) =>
  d.sections[id].points.findIndex((p) => p.role === role);
const drag = (
  d: ReturnType<typeof defaultDoc>,
  id: SectionId,
  role: string,
  by: [number, number],
) => {
  const i = point(d, id, role),
    p = d.sections[id].points[i]!.pos;
  return withSection(
    d,
    id,
    moveAnchor(d.sections[id], i, [p[0] + by[0], p[1] + by[1]]),
  );
};
const rv = (d: ReturnType<typeof defaultDoc>, id: SectionId) =>
  railValues(sectionGeometry(d.top, d.dorsal, id)!, d.rails);

describe("crossing write-back", () => {
  it("a shoulder's height edit moves the elevation rail, not just the section", () => {
    const d0 = defaultDoc(),
      before = rv(d0, "ball").lateral_shoulder!,
      d1 = drag(d0, "ball", "lateral_shoulder", [0, 4]),
      after = rv(d1, "ball").lateral_shoulder!,
      p = d1.sections.ball.points[point(d1, "ball", "lateral_shoulder")]!;
    expect(after.z!).toBeCloseTo(before.z! + 4, 1);
    expect(after.u!).toBeCloseTo(before.u!, 1);
    // the section point stays locked to the rail and sits where it was dragged
    expect(p.pos[1]).toBeCloseTo(before.z! + 4, 1);
    expect(d1.unlocked).toEqual([]);
  });

  it("is local: the rail far from the section is untouched", () => {
    const d0 = defaultDoc(),
      d1 = drag(d0, "ball", "lateral_shoulder", [0, 6]),
      c0 = d0.rails.elev.lateral_shoulder,
      c1 = d1.rails.elev.lateral_shoulder;
    // far away: unchanged; the neighbours' auto handles re-derive, so a little
    // moves close by (0.3 mm at 100 mm from a 6 mm edit)
    for (const y of [10, 40, 285])
      expect(heightAtStation(c1, y)!).toBeCloseTo(heightAtStation(c0, y)!, 1);
    expect(
      Math.abs(heightAtStation(c1, 90)! - heightAtStation(c0, 90)!),
    ).toBeLessThan(0.5);
    expect(c1.points.length).toBeGreaterThan(c0.points.length - 1);
  });

  it("a shoulder's u edit moves the plan rail's crossing", () => {
    const d0 = defaultDoc(),
      before = rv(d0, "waist").medial_shoulder!,
      d1 = drag(d0, "waist", "medial_shoulder", [3, 0]),
      after = rv(d1, "waist").medial_shoulder!;
    expect(after.u!).toBeCloseTo(before.u! + 3, 1);
  });

  it("the crown height edit moves the side contour's upper", () => {
    const d0 = defaultDoc(),
      g = sectionGeometry(d0.top, d0.dorsal, "ball")!,
      d1 = drag(d0, "ball", "crown", [0, -5]),
      g1 = sectionGeometry(d1.top, d1.dorsal, "ball")!;
    expect(g1.crownHeight!).toBeCloseTo(g.crownHeight! - 5, 1);
    expect(
      d1.sections.ball.points[point(d1, "ball", "crown")]!.pos[1],
    ).toBeCloseTo(g.crownHeight! - 5, 1);
  });

  it("the medial/lateral u stays driven by the outline", () => {
    const d0 = defaultDoc(),
      d1 = drag(d0, "ball", "lateral", [5, 0]);
    expect(
      d1.sections.ball.points[point(d1, "ball", "lateral")]!.pos[0],
    ).toBeCloseTo(
      d0.sections.ball.points[point(d0, "ball", "lateral")]!.pos[0],
      3,
    );
  });

  it("an unlocked drive is detached: nothing is written, and the gap is reported", () => {
    const d0 = withUnlocked(defaultDoc(), "ball/lateral_shoulder:1", true),
      d1 = drag(d0, "ball", "lateral_shoulder", [0, 7]);
    expect(d1.rails).toBe(d0.rails);
    const gaps = sectionGaps(d1, "ball");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gap).toBeCloseTo(7, 1);
  });

  it("the surface follows the edited section (a detached edit does not)", () => {
    // distance of the ball section's drawn line from the nearest mesh vertex
    const gap = (d: ReturnType<typeof defaultDoc>) => {
      const L = buildLoft(
          d,
          upperFrame(validContext(sideContext(d.top, d.params))!),
          { topCut: false },
        ),
        sec = L.sections.find((s) => s.id === "ball")!;
      let worst = 0;
      for (const p of sec.pts) {
        let m = Infinity;
        for (let i = 0; i < L.positions.length; i += 3)
          m = Math.min(
            m,
            Math.hypot(
              p[0] - L.positions[i]!,
              p[1] - L.positions[i + 1]!,
              p[2] - L.positions[i + 2]!,
            ),
          );
        worst = Math.max(worst, m);
      }
      return worst;
    };
    const base = gap(defaultDoc()),
      linked = drag(
        drag(defaultDoc(), "ball", "crown", [0, -6]),
        "ball",
        "lateral_shoulder",
        [0, 5],
      ),
      detached = drag(
        withUnlocked(
          withUnlocked(defaultDoc(), "ball/crown:1", true),
          "ball/lateral_shoulder:1",
          true,
        ),
        "ball",
        "crown",
        [0, -6],
      );
    expect(gap(linked)).toBeLessThan(base + 1.5);
    expect(gap(detached)).toBeGreaterThan(base + 3);
  });
});
