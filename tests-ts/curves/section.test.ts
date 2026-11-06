import { describe, expect, it } from "vitest";
import { moveAnchor, type EditableCurve } from "~/lib/curves";
import {
  defaultDoc,
  parseDoc,
  serializeDoc,
  withCurve,
  withSection,
  withUnlocked,
} from "~/lib/studio/document";
import { railValues } from "~/lib/studio/rails";
import {
  SECTION_IDS,
  heightAtStation,
  sectionDrives,
  sectionGeometry,
  sectionGirth,
} from "~/lib/studio/section";

const railValuesFor = (
  d: ReturnType<typeof defaultDoc>,
  id: (typeof SECTION_IDS)[number],
) => railValues(geom(d, id), d.rails);
const pos = (c: EditableCurve, r: string) =>
  c.points.find((p) => p.role === r)!.pos;
const geom = (d = defaultDoc(), id: (typeof SECTION_IDS)[number] = "ball") =>
  sectionGeometry(d.top, d.dorsal, id)!;

describe("section geometry", () => {
  it("cuts through the medial and lateral landmarks, tilted when they differ in y", () => {
    const g = geom();
    expect(g.width).toBeCloseTo(Math.hypot(48 + 50, 180 - 190), 9);
    expect(g.tiltDeg).toBeCloseTo((Math.atan2(-10, 98) * 180) / Math.PI, 9);
    expect(Math.abs(g.tiltDeg)).toBeGreaterThan(1);
    expect(g.station).toBe(185);
    // waist pair is level: no tilt
    expect(geom(defaultDoc(), "waist").tiltDeg).toBeCloseTo(0, 9);
  });

  it("finds where the cut crosses the centre plane and the upper height there", () => {
    const d = defaultDoc(),
      g = geom(d);
    expect(g.centreU).not.toBeNull();
    const t = g.centreU! / g.width;
    expect(g.centreStation).toBeCloseTo(190 + t * -10, 9);
    expect(g.crownHeight).toBeCloseTo(
      heightAtStation(d.dorsal, g.centreStation!)!,
      9,
    );
    expect(g.crownHeight).toBeGreaterThan(0);
  });
});

describe("section document", () => {
  it("starts with four closed sections that satisfy every drive", () => {
    const d = defaultDoc();
    for (const id of SECTION_IDS) {
      const c = d.sections[id],
        g = geom(d, id),
        roles = c.points.map((p) => p.role);
      expect(c.closed).toBe(true);
      expect(new Set(roles).size).toBe(roles.length);
      expect(pos(c, "medial")[0]).toBeCloseTo(0, 9);
      expect(pos(c, "lateral")[0]).toBeCloseTo(g.width, 9);
      expect(pos(c, "crown")[0]).toBeCloseTo(g.centreU!, 9);
      expect(pos(c, "crown")[1]).toBeCloseTo(g.crownHeight!, 9);
      expect(pos(c, "sole")[1]).toBeCloseTo(0, 9);
      expect(sectionGirth(c)).toBeGreaterThan(g.width * 2);
    }
  });

  it("follows the top outline: moving the lateral ball landmark widens the section", () => {
    const d = defaultDoc(),
      i = d.top.points.findIndex((p) => p.role === "lateral_ball"),
      p = d.top.points[i]!.pos,
      d2 = withCurve(d, "top", moveAnchor(d.top, i, [p[0] + 10, p[1]]));
    expect(pos(d2.sections.ball, "lateral")[0]).toBeGreaterThan(
      pos(d.sections.ball, "lateral")[0] + 9,
    );
    expect(pos(d2.sections.ball, "lateral")[0]).toBeCloseTo(geom(d2).width, 9);
  });

  it("follows the upper: raising the instep raises the crown", () => {
    const d = defaultDoc(),
      i = d.dorsal.points.findIndex((p) => p.role === "ball_top"),
      p = d.dorsal.points[i]!.pos,
      d2 = withCurve(d, "dorsal", moveAnchor(d.dorsal, i, [p[0], p[1] + 8]));
    expect(pos(d2.sections.ball, "crown")[1]).toBeGreaterThan(
      pos(d.sections.ball, "crown")[1] + 4,
    );
  });

  it("editing a free point changes that section only, and drives stay true", () => {
    const d = defaultDoc(),
      c = d.sections.ball,
      i = c.points.findIndex((p) => p.role === "sole"),
      q = c.points[i]!.pos,
      // the sole's u is the one free coordinate: the rails drive all the rest
      d2 = withSection(d, "ball", moveAnchor(c, i, [q[0] - 3, q[1]]));
    expect(pos(d2.sections.ball, "sole")[0]).toBeCloseTo(q[0] - 3, 6);
    expect(d2.sections.heel).toBe(d.sections.heel);
    expect(pos(d2.sections.ball, "crown")[1]).toBeCloseTo(
      pos(c, "crown")[1],
      9,
    );
  });

  it("a locked drive resists edits; unlocking frees it", () => {
    const d = defaultDoc(),
      c = d.sections.ball,
      i = c.points.findIndex((p) => p.role === "crown"),
      q = c.points[i]!.pos,
      moved = moveAnchor(c, i, [q[0], q[1] + 5]),
      locked = withSection(d, "ball", moved),
      id = sectionDrives(geom(d)).find(
        (x) => x.role === "crown" && x.axis === 1,
      )!.id,
      free = withSection(withUnlocked(d, id, true), "ball", moved);
    expect(pos(locked.sections.ball, "crown")[1]).toBeCloseTo(q[1], 9);
    expect(pos(free.sections.ball, "crown")[1]).toBeCloseTo(q[1] + 5, 9);
  });

  it("round-trips through JSON, and a save without sections gets them seeded", () => {
    const d = defaultDoc();
    expect(parseDoc(serializeDoc(d))).toEqual(JSON.parse(JSON.stringify(d)));
    const legacy = JSON.parse(serializeDoc(d)) as Record<string, unknown>;
    delete legacy.sections;
    const up = parseDoc(JSON.stringify(legacy));
    expect(up.sections.ball.closed).toBe(true);
    expect(pos(up.sections.ball, "lateral")[0]).toBeCloseTo(geom(d).width, 6);
  });
});

describe("section bottom", () => {
  const ball = () => defaultDoc().sections.ball;
  it("is flat: corners at z=0, straight segments around the sole, tucked in", () => {
    const c = ball(),
      W = geom().width,
      mb = pos(c, "medial_bottom"),
      lb = pos(c, "lateral_bottom");
    expect(mb[1]).toBeCloseTo(0, 9);
    expect(lb[1]).toBeCloseTo(0, 9);
    expect(mb[0]).toBeGreaterThan(0);
    expect(lb[0]).toBeLessThan(W);
    const by = (r: string) => c.points.find((p) => p.role === r)!;
    expect(by("medial_bottom").mode).toBe("corner");
    expect(by("medial_bottom").lineToNext).toBe(true);
    expect(by("sole").lineToNext).toBe(true);
    // widest point is just above the corner, not far up the wall
    expect(pos(c, "lateral")[1]).toBeLessThan(15);
  });
  it("bottom corners are driven by the rails (flat at first)", () => {
    const d = defaultDoc();
    const ids = (id: (typeof SECTION_IDS)[number]) =>
      sectionDrives(geom(d, id), railValuesFor(d, id)).map((x) => x.id);
    expect(ids("waist")).toContain("waist/medial_bottom:1");
    expect(ids("ball")).toContain("ball/lateral_bottom:0");
    expect(pos(d.sections.waist, "medial_bottom")[1]).toBeCloseTo(0, 6);
  });
});
