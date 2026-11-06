import { describe, expect, it } from "vitest";
import {
  appendPoint,
  createCurve,
  evalCubic,
  historyReducer,
  initHistory,
  insertPoint,
  kinkAngle,
  moveAnchor,
  moveHandle,
  nearestOnCurve,
  parseCurve,
  removePoint,
  segmentCubic,
  serializeCurve,
  setClosed,
  setLine,
  setMode,
  PRESETS,
  type EditableCurve,
} from "~/lib/curves";

const open = () =>
  createCurve(
    [{ pos: [0, 0] }, { pos: [50, 40] }, { pos: [100, 0] }, { pos: [150, 30] }],
    false,
  );
const cross = (a: readonly number[], b: readonly number[]) =>
  a[0]! * b[1]! - a[1]! * b[0]!;

describe("point modes", () => {
  it("auto points never kink, even on sharp turns", () => {
    const c = createCurve(
      [{ pos: [0, 0] }, { pos: [50, 5] }, { pos: [10, 60] }, { pos: [90, 90] }],
      false,
    );
    for (const i of [1, 2]) expect(kinkAngle(c, i)).toBeLessThan(1e-3);
  });

  it("smooth keeps handles collinear with independent lengths", () => {
    let c = setMode(open(), 1, "smooth");
    c = moveHandle(c, 1, "out", [20, 30]);
    const p = c.points[1]!;
    expect(cross(p.handleIn, p.handleOut)).toBeCloseTo(0, 6);
    expect(
      p.handleIn[0] * p.handleOut[0] + p.handleIn[1] * p.handleOut[1],
    ).toBeLessThan(0);
    const lenIn = Math.hypot(...p.handleIn);
    c = moveHandle(c, 1, "out", [40, 60]);
    expect(Math.hypot(...c.points[1]!.handleIn)).toBeCloseTo(lenIn, 9);
  });

  it("symmetric mirrors the opposite handle", () => {
    let c = setMode(open(), 1, "symmetric");
    c = moveHandle(c, 1, "in", [-12, -7]);
    expect(c.points[1]!.handleOut[0]).toBeCloseTo(12);
    expect(c.points[1]!.handleOut[1]).toBeCloseTo(7);
  });

  it("corner is the only mode that can kink", () => {
    let c = setMode(open(), 1, "corner");
    c = moveHandle(c, 1, "out", [0, 30]);
    expect(kinkAngle(c, 1)).toBeGreaterThan(10);
    c = setMode(c, 1, "smooth");
    expect(kinkAngle(c, 1)).toBeLessThan(1e-3);
  });

  it("dragging an auto handle takes manual control (smooth)", () => {
    const c = moveHandle(open(), 1, "out", [5, 25]);
    expect(c.points[1]!.mode).toBe("smooth");
    expect(c.points[1]!.handleOut).toEqual([5, 25]);
  });

  it("moving a point re-derives auto neighbours only", () => {
    const before = open();
    const after = moveAnchor(before, 1, [50, 90]);
    expect(after.points[2]!.handleIn).not.toEqual(before.points[2]!.handleIn);
    const manual = moveAnchor(setMode(before, 2, "corner"), 1, [50, 90]);
    expect(manual.points[2]!.handleIn).toEqual(before.points[2]!.handleIn);
  });
});

describe("editing", () => {
  it("inserting between non-auto points leaves the shape unchanged", () => {
    const c = createCurve(
      [
        { pos: [0, 0], mode: "corner" },
        { pos: [100, 0], mode: "corner" },
      ],
      false,
    );
    const bent = moveHandle(
      moveHandle(c, 0, "out", [10, 50]),
      1,
      "in",
      [-10, 50],
    );
    const { curve, index } = insertPoint(bent, 0, 0.3);
    expect(index).toBe(1);
    const q = segmentCubic(bent, 0);
    const [a, b] = [segmentCubic(curve, 0), segmentCubic(curve, 1)];
    expect(evalCubic(a, 1)).toEqual(curve.points[1]!.pos);
    for (const s of [0.25, 0.8]) {
      expect(evalCubic(a, s)[1]).toBeCloseTo(evalCubic(q, 0.3 * s)[1], 6);
      expect(evalCubic(b, s)[1]).toBeCloseTo(evalCubic(q, 0.3 + 0.7 * s)[1], 6);
    }
    expect(kinkAngle(curve, 1)).toBeLessThan(1e-3);
  });

  it("insert on the closing segment of a closed curve appends", () => {
    const c = PRESETS.find((p) => p.id === "oval")!.curve();
    const { curve, index } = insertPoint(c, c.points.length - 1, 0.5);
    expect(index).toBe(c.points.length);
    expect(curve.points).toHaveLength(c.points.length + 1);
  });

  it("append heals the former end point's missing handle", () => {
    const c = appendPoint(setMode(open(), 3, "smooth"), [200, 0]).curve;
    const p = c.points[3]!;
    expect(Math.hypot(...p.handleOut)).toBeGreaterThan(0);
    expect(kinkAngle(c, 3)).toBeLessThan(1e-3);
  });

  it("enforces minimum point counts", () => {
    const two = createCurve([{ pos: [0, 0] }, { pos: [1, 1] }], false);
    expect(removePoint(two, 0)).toBe(two);
    expect(setClosed(two, true)).toBe(two);
    const tri = setClosed(
      createCurve([{ pos: [0, 0] }, { pos: [10, 0] }, { pos: [5, 9] }], false),
      true,
    );
    expect(tri.closed).toBe(true);
    expect(removePoint(tri, 0)).toBe(tri);
  });

  it("closing a curve makes the seam smooth", () => {
    const c = setClosed(open(), true);
    expect(kinkAngle(c, 0)).toBeLessThan(1e-3);
    expect(kinkAngle(c, 3)).toBeLessThan(1e-3);
  });

  it("finds the nearest point on the curve", () => {
    const c = createCurve([{ pos: [0, 0] }, { pos: [100, 0] }], false);
    const hit = nearestOnCurve(c, [40, 7])!;
    expect(hit.point[0]).toBeCloseTo(40, 3);
    expect(hit.distance).toBeCloseTo(7, 3);
  });
});

describe("serialization and history", () => {
  it("round-trips every preset", () => {
    for (const preset of PRESETS) {
      const c = preset.curve();
      expect(parseCurve(serializeCurve(c))).toEqual(
        JSON.parse(JSON.stringify(c)),
      );
    }
  });

  it("rejects malformed documents with readable errors", () => {
    expect(() => parseCurve("{")).toThrow("Not valid JSON");
    expect(() => parseCurve('{"version":2}')).toThrow("Invalid curve");
    const c: EditableCurve = {
      closed: true,
      points: open().points.slice(0, 2),
    };
    expect(() => parseCurve(serializeCurve(c))).toThrow("at least 3");
  });

  it("a drag is one undo step, and cancel restores the start", () => {
    const a = open(),
      b = moveAnchor(a, 1, [60, 60]),
      c = moveAnchor(a, 1, [70, 80]);
    let s = initHistory(a);
    s = historyReducer(s, { type: "preview", value: b });
    s = historyReducer(s, { type: "preview", value: c });
    s = historyReducer(s, { type: "finish" });
    expect(s.past).toEqual([a]);
    s = historyReducer(s, { type: "undo" });
    expect(s.present).toBe(a);
    s = historyReducer(s, { type: "redo" });
    expect(s.present).toBe(c);
    s = historyReducer(s, { type: "preview", value: b });
    s = historyReducer(s, { type: "cancel" });
    expect(s.present).toBe(c);
    expect(s.past).toHaveLength(1);
  });
});

describe("straight line segments", () => {
  const lineCurve = () =>
    setLine(
      createCurve(
        [{ pos: [0, 0] }, { pos: [90, 0] }, { pos: [150, 60] }],
        false,
      ),
      0,
      true,
    );

  it("handles lie on the chord and follow the end points", () => {
    let c = lineCurve();
    c = moveAnchor(c, 1, [90, 40]);
    const a = c.points[0]!,
      b = c.points[1]!,
      chord = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]];
    expect(a.handleOut[0]).toBeCloseTo(chord[0]! / 3, 9);
    expect(a.handleOut[1]).toBeCloseTo(chord[1]! / 3, 9);
    expect(b.handleIn[1]).toBeCloseTo(-chord[1]! / 3, 9);
  });

  it("a smooth neighbour stays collinear when the line tilts", () => {
    let c = setMode(lineCurve(), 1, "smooth");
    c = moveAnchor(c, 1, [90, 40]);
    expect(kinkAngle(c, 1)).toBeLessThan(1e-3);
  });

  it("dragging one of its handles turns it back into a curve", () => {
    const c = moveHandle(lineCurve(), 0, "out", [10, 30]);
    expect(c.points[0]!.lineToNext).toBe(false);
    expect(c.points[0]!.handleOut).toEqual([10, 30]);
  });

  it("splitting a line gives two lines; deleting inside merges them", () => {
    const { curve } = insertPoint(lineCurve(), 0, 0.5);
    expect(curve.points[0]!.lineToNext).toBe(true);
    expect(curve.points[1]!.lineToNext).toBe(true);
    expect(removePoint(curve, 1).points[0]!.lineToNext).toBe(true);
  });

  it("survives JSON", () => {
    const c = lineCurve();
    expect(parseCurve(serializeCurve(c)).points[0]!.lineToNext).toBe(true);
  });
});
