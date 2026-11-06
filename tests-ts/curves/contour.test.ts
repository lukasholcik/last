import { describe, expect, it } from "vitest";
import { moveAnchor } from "~/lib/curves";
import {
  buildContour,
  flatToPosed,
  posedToFlat,
  splitContour,
  upperFrame,
} from "~/lib/studio/contour";
import {
  defaultDoc,
  withCurve,
  withParams,
  type StudioDoc,
} from "~/lib/studio/document";
import { sideContext, validContext } from "~/lib/studio/side";

const frameOf = (d: StudioDoc) => {
  const c = validContext(sideContext(d.top, d.params));
  if (!c) throw new Error("invalid test context");
  return upperFrame(c);
};
const at = (d: StudioDoc, role: string) =>
  d.dorsal.points.find((p) => p.role === role)!;
const near = (a: readonly number[], b: readonly number[], e = 1e-6) => {
  expect(Math.abs(a[0]! - b[0]!)).toBeLessThan(e);
  expect(Math.abs(a[1]! - b[1]!)).toBeLessThan(e);
};
const HEELS = [0, 8, 40, 80];
const docAt = (H: number) =>
  withParams(defaultDoc(), { heelHeight: H, seatOffsetDeg: 0 });

describe("flat ⇄ posed map", () => {
  it("is inverted by posedToFlat over the whole foot at every heel height", () => {
    for (const H of HEELS) {
      const f = frameOf(docAt(H));
      for (const s of [-3, 0, 10, 30, 54, 90, 150, 220, 270])
        for (const h of [0, 12, 40, 80]) {
          const back = posedToFlat(f, flatToPosed(f, [s, h]), s);
          near(back, [s, h], 1e-5);
        }
    }
  });

  it("maps the heel back onto the sole's rear point", () => {
    for (const H of HEELS) {
      const d = docAt(H),
        f = frameOf(d);
      near(flatToPosed(f, [0, 0]), d.bottom.points[0]!.pos);
    }
  });

  it("is the identity on a flat foot", () => {
    const f = frameOf(docAt(0));
    near(flatToPosed(f, [100, 30]), [100, 30], 1e-6);
  });
});

describe("closed side contour", () => {
  it("is one closed loop with unique roles and no duplicated heel point", () => {
    const d = docAt(8),
      c = buildContour(frameOf(d), d.bottom, d.dorsal),
      roles = c.points.map((p) => p.role);
    expect(c.closed).toBe(true);
    expect(new Set(roles).size).toBe(roles.length);
    expect(roles).not.toContain("heel_back");
    expect(c.points.length).toBe(
      d.bottom.points.length + d.dorsal.points.length - 1,
    );
  });

  it("splits back to exactly the stored curves", () => {
    for (const H of HEELS) {
      const d = docAt(H),
        f = frameOf(d),
        r = splitContour(f, buildContour(f, d.bottom, d.dorsal), d);
      expect(r.bottom.points.length).toBe(d.bottom.points.length);
      expect(r.dorsal.points.length).toBe(d.dorsal.points.length);
      d.bottom.points.forEach((p, i) => {
        near(r.bottom.points[i]!.pos, p.pos, 1e-9);
        expect(r.bottom.points[i]!.lineToNext).toBe(p.lineToNext);
      });
      d.dorsal.points.forEach((p, i) => {
        near(r.dorsal.points[i]!.pos, p.pos, 1e-9);
        near(r.dorsal.points[i]!.handleOut, p.handleOut, 1e-6);
        expect(r.dorsal.points[i]!.lineToNext).toBe(p.lineToNext);
      });
    }
  });

  it("dragging one upper point in the posed view changes only that point", () => {
    const d = docAt(40),
      f = frameOf(d),
      c = buildContour(f, d.bottom, d.dorsal),
      i = c.points.findIndex((p) => p.role === "instep_waist"),
      p = c.points[i]!.pos,
      moved = moveAnchor(c, i, [p[0], p[1] + 6]),
      r = splitContour(f, moved, d);
    near(r.bottom.points[1]!.pos, d.bottom.points[1]!.pos, 1e-9);
    d.dorsal.points.forEach((q, k) => {
      if (q.role === "instep_waist") return;
      near(r.dorsal.points[k]!.pos, q.pos, 1e-9);
    });
    // The point itself lands where it was dropped, in the posed view.
    const rebuilt = buildContour(f, r.bottom, r.dorsal);
    near(
      rebuilt.points.find((q) => q.role === "instep_waist")!.pos,
      [p[0], p[1] + 6],
      1e-4,
    );
  });

  it("reshaping the sole does not move the upper", () => {
    const d = docAt(8),
      moved = moveAnchor(d.bottom, 1, [
        d.bottom.points[1]!.pos[0] + 4,
        d.bottom.points[1]!.pos[1] + 2,
      ]),
      d2 = withCurve(d, "bottom", moved);
    d.dorsal.points.forEach((q, k) =>
      near(d2.dorsal.points[k]!.pos, q.pos, 1e-9),
    );
    near(
      buildContour(frameOf(d2), d2.bottom, d2.dorsal).points.find(
        (q) => q.role === "ball_top",
      )!.pos,
      buildContour(frameOf(d), d.bottom, d.dorsal).points.find(
        (q) => q.role === "ball_top",
      )!.pos,
    );
  });
});

describe("heel elevation drives the upper", () => {
  it("leaves the flat upper untouched and lifts the toe, keeping the ball fixed", () => {
    const lo = docAt(8),
      hi = docAt(60);
    lo.dorsal.points.forEach((p, i) =>
      near(hi.dorsal.points[i]!.pos, p.pos, 1e-9),
    );
    const tip = (d: StudioDoc) => flatToPosed(frameOf(d), at(d, "toe_tip").pos),
      cut = (d: StudioDoc) => flatToPosed(frameOf(d), at(d, "roof_rear").pos);
    // heel block rides up with the heel; toe tip height follows toe spring, not H
    expect(cut(hi)[1]).toBeGreaterThan(cut(lo)[1] + 40);
    expect(tip(hi)[1]).toBeLessThan(tip(lo)[1] + 15);
    // (Horizontal station is not asserted: the tilted seat eats part of the
    // stretched arc, so the toe tip's x can move either way.)
  });

  it("flat → elevated → flat returns anchors exactly", () => {
    const d = docAt(0),
      up = withParams(d, { heelHeight: 80 }),
      back = withParams(up, { heelHeight: 0 });
    d.dorsal.points.forEach((p, i) =>
      near(back.dorsal.points[i]!.pos, p.pos, 1e-9),
    );
  });
});

describe("sections turn with the foot", () => {
  // The tilt of a section plane is the angle of "up" at its station: the
  // direction a flat point moves in when its height grows.
  const tilt = (f: ReturnType<typeof frameOf>, s: number) => {
    const a = flatToPosed(f, [s, 0]),
      b = flatToPosed(f, [s, 50]);
    return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  };
  const deg = (r: number) => (r * 180) / Math.PI;

  it("keeps the heel at the seat angle and the waist and ball at the foot's hinge angle", () => {
    for (const H of [40, 80, 100]) {
      const d = docAt(H),
        c = validContext(sideContext(d.top, d.params))!,
        f = frameOf(d),
        th = deg(c.pose.theta);
      expect(tilt(f, 20)).toBeCloseTo(deg(c.pose.seatAngle), 3);
      // the waist, and the ball just behind the hinge line (the ball section
      // lies a little behind the medial-ball station A)
      expect(tilt(f, 117)).toBeCloseTo(th, 3);
      expect(tilt(f, c.ballStation - 5)).toBeCloseTo(th, 3);
      // the toe section keeps only a little of it; the toe box itself is flat
      expect(tilt(f, c.ballStation + 46)).toBeLessThan(0.2 * th);
      expect(tilt(f, c.ballStation + 61)).toBeCloseTo(0, 6);
      expect(tilt(f, 290)).toBeCloseTo(0, 6);
    }
  });

  it("changes smoothly along the foot, with no step in the tilt", () => {
    const f = frameOf(docAt(100));
    let prev = tilt(f, -3);
    for (let s = -2; s <= 300; s++) {
      const t = tilt(f, s);
      expect(Math.abs(t - prev)).toBeLessThan(1.2);
      prev = t;
    }
  });

  it("does not fold the surface: heights up to 60 mm round-trip at 100 mm heel", () => {
    const f = frameOf(docAt(100));
    for (let s = 40; s <= 280; s += 8)
      for (const h of [20, 40, 60]) {
        const back = posedToFlat(f, flatToPosed(f, [s, h]), s);
        near(back, [s, h], 1e-5);
      }
  });

  it("is the flat foot when the heel is flat", () => {
    const f = frameOf(docAt(0));
    for (const s of [0, 60, 117, 194, 251])
      expect(tilt(f, s)).toBeCloseTo(0, 6);
  });
});
