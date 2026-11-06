import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cutZ, defaultCut } from "~/lib/studio/cut";
import { upperFrame } from "~/lib/studio/contour";
import {
  defaultDoc,
  parseDoc,
  serializeDoc,
  withCut,
  withParams,
} from "~/lib/studio/document";
import { sideContext, validContext } from "~/lib/studio/side";

const frameOf = (heel: number) => {
  const d = withParams(defaultDoc(), { heelHeight: heel, seatOffsetDeg: 0 });
  return upperFrame(validContext(sideContext(d.top, d.params))!);
};

describe("top cut", () => {
  const d = defaultDoc();

  it("is a height and a tilt, not a curve", () => {
    expect(d.cut).toEqual(defaultCut(d.cut.height / 0.3));
    expect(Object.keys(d.cut).sort()).toEqual(["height", "tiltDeg"]);
  });

  it("is the flat line height + tan(tilt) y on the flat foot", () => {
    const z = cutZ({ height: 100, tiltDeg: -10 }, null);
    expect(z(0)).toBeCloseTo(100, 9);
    expect(z(50)).toBeCloseTo(100 - 50 * Math.tan((10 * Math.PI) / 180), 9);
  });

  it("is a straight plane in the pose at every heel height, carried by the heel block", () => {
    for (const heel of [8, 40, 80]) {
      const f = frameOf(heel),
        z = cutZ({ height: 100, tiltDeg: -7 }, f),
        a = [0, 120, 240].map((y) => z(y));
      // straight: equal steps over equal distances
      expect(a[1]! - a[0]!).toBeCloseTo(a[2]! - a[1]!, 9);
    }
    // the plane rises with the heel and tilts with the seat angle
    expect(cutZ({ height: 100, tiltDeg: 0 }, frameOf(80))(0)).toBeGreaterThan(
      cutZ({ height: 100, tiltDeg: 0 }, frameOf(8))(0) + 40,
    );
    expect(cutZ({ height: 100, tiltDeg: 0 }, frameOf(80))(240)).toBeLessThan(
      cutZ({ height: 100, tiltDeg: 0 }, frameOf(80))(0) - 60,
    );
  });

  it("survives a save and a load", () => {
    expect(parseDoc(serializeDoc(d)).cut).toEqual(d.cut);
  });

  it("clamps what is entered", () => {
    expect(withCut(d, { tiltDeg: 500 }).cut.tiltDeg).toBe(60);
    expect(withCut(d, { height: -3 }).cut.height).toBe(1);
    expect(withCut(d, {})).toBe(d);
    expect(withCut(d, { height: 80 }).cut.height).toBe(80);
  });

  describe("older saves", () => {
    type P = { role?: string; pos: number[] };
    const old = () =>
      JSON.parse(serializeDoc(d)) as {
        cut?: unknown;
        dorsal: { points: P[] };
      };

    it("take the cut over from the upper's cut_rear / cut_front points", () => {
      const o = old();
      delete o.cut;
      for (const p of o.dorsal.points)
        if (p.role === "roof_rear") p.role = "cut_rear";
        else if (p.role === "roof_front") p.role = "cut_front";
      o.dorsal.points.find((p) => p.role === "cut_rear")!.pos = [10, 110];
      o.dorsal.points.find((p) => p.role === "cut_front")!.pos = [110, 90];
      const back = parseDoc(JSON.stringify(o));
      expect(back.cut.tiltDeg).toBeCloseTo(
        (Math.atan(-0.2) * 180) / Math.PI,
        9,
      );
      // height at station 0 of the line through (10, 110) and (110, 90)
      expect(back.cut.height).toBeCloseTo(112, 9);
      expect(back.dorsal.points.some((p) => p.role === "roof_rear")).toBe(true);
    });

    it("are level at the rear point's height when the front point is gone", () => {
      const fx = parseDoc(readFileSync("debug/heel-contour.json", "utf8"));
      // debug/heel-contour.json: cut_front had been deleted, so there was no cut
      expect(fx.cut.tiltDeg).toBeCloseTo(0, 9);
      expect(fx.cut.height).toBeCloseTo(115.2, 0);
    });

    it("convert the 2-point cut curve of the previous version", () => {
      const o = old();
      const pt = (role: string, pos: number[]) => ({
        role,
        pos,
        mode: "corner",
        handleIn: [0, 0],
        handleOut: [0, 0],
      });
      o.cut = {
        closed: false,
        points: [pt("cut_rear", [10, 110]), pt("cut_front", [110, 90])],
      };
      const back = parseDoc(JSON.stringify(o));
      expect(back.cut.height).toBeCloseTo(112, 9);
      expect(back.cut.tiltDeg).toBeCloseTo(
        (Math.atan(-0.2) * 180) / Math.PI,
        9,
      );
    });
  });
});
