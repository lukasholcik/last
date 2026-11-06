import { describe, expect, it } from "vitest";
import {
  calibrateImage,
  centerImageOn,
  fitImageAround,
  imageContains,
  imageCorners,
  imageHeight,
  moveImage,
  newRefImage,
  parseRefImage,
  rotateImageTo,
  scaleImageAbout,
  scaleImageFromCorner,
  serializeRefImage,
  worldToLocal,
  localToWorld,
  type RefImage,
} from "~/lib/studio/reference-image";

const base = (): RefImage => ({
  src: "data:image/png;base64,AAAA",
  name: "foot.png",
  aspect: 2,
  cx: 10,
  cy: 20,
  width: 100,
  rotationDeg: 0,
  opacity: 0.5,
  flipX: false,
  locked: false,
  visible: true,
});
const near = (a: readonly number[], b: readonly number[], d = 6) => {
  expect(a[0]).toBeCloseTo(b[0]!, d);
  expect(a[1]).toBeCloseTo(b[1]!, d);
};

describe("reference image geometry", () => {
  it("height follows the fixed aspect and corners are ordered bottom-left first", () => {
    const i = base();
    expect(imageHeight(i)).toBe(50);
    const [bl, br, tr, tl] = imageCorners(i);
    near(bl, [-40, -5]);
    near(br, [60, -5]);
    near(tr, [60, 45]);
    near(tl, [-40, 45]);
  });

  it("world and local coordinates round-trip at any rotation", () => {
    const i = { ...base(), rotationDeg: 37 };
    for (const p of [
      [0, 0],
      [12, -7],
      [-90, 55],
    ] as const)
      near(localToWorld(i, worldToLocal(i, p)), p);
  });

  it("hit testing follows rotation", () => {
    const i = { ...base(), rotationDeg: 90 },
      // rotated 90°: the 100-wide side now runs along y
      inside = [i.cx, i.cy + 45],
      outside = [i.cx + 45, i.cy];
    expect(imageContains(i, inside as [number, number])).toBe(true);
    expect(imageContains(i, outside as [number, number])).toBe(false);
  });

  it("scaling about a point keeps that point fixed", () => {
    const i = base(),
      anchor: [number, number] = [-40, -5],
      s = scaleImageAbout(i, anchor, 2);
    expect(s.width).toBe(200);
    near(imageCorners(s)[0], anchor);
  });

  it("dragging a corner keeps the opposite corner and the aspect", () => {
    const i = { ...base(), rotationDeg: 25 },
      corners = imageCorners(i),
      target: [number, number] = [
        corners[2][0] + 30 * Math.cos((25 * Math.PI) / 180),
        corners[2][1] + 30 * Math.sin((25 * Math.PI) / 180),
      ],
      s = scaleImageFromCorner(i, 2, target);
    near(imageCorners(s)[0], corners[0], 5);
    expect(s.aspect).toBe(i.aspect);
    expect(s.width).toBeGreaterThan(i.width);
  });

  it("never collapses below the minimum width", () => {
    const i = base(),
      s = scaleImageFromCorner(i, 2, imageCorners(i)[0]);
    expect(s.width).toBeGreaterThanOrEqual(1);
  });

  it("rotating points the up handle at the pointer, with optional snap", () => {
    const i = base(),
      r = rotateImageTo(i, [i.cx - 50, i.cy]); // pointer left of centre → up = left → +90°
    expect(r.rotationDeg).toBeCloseTo(90, 6);
    expect(
      Math.abs(rotateImageTo(i, [i.cx + 50, i.cy + 52], 15).rotationDeg % 15),
    ).toBe(0);
  });

  it("calibration makes two picked points exactly the real distance apart", () => {
    const i = base(),
      p1: [number, number] = [0, 0],
      p2: [number, number] = [30, 40], // 50 apart on screen
      c = calibrateImage(i, p1, p2, 100)!,
      // the picked image features move with the image when it scales about p1
      f = c.width / i.width;
    expect(f).toBeCloseTo(2, 9);
    expect(Math.hypot(p2[0] * f - p1[0], p2[1] * f - p1[1])).toBeCloseTo(
      100,
      9,
    );
  });

  it("rejects an unusable calibration", () => {
    expect(calibrateImage(base(), [1, 1], [1, 1], 50)).toBeNull();
    expect(calibrateImage(base(), [0, 0], [3, 4], 0)).toBeNull();
    expect(calibrateImage(base(), [0, 0], [3, 4], NaN)).toBeNull();
  });

  it("fits around and centres on a curve's bounds", () => {
    const pts: [number, number][] = [
        [0, 0],
        [100, 0],
        [100, 300],
        [0, 300],
      ],
      c = centerImageOn(base(), pts),
      f = fitImageAround(base(), pts);
    expect([c.cx, c.cy]).toEqual([50, 150]);
    expect(c.width).toBe(100);
    near([f.cx, f.cy], [50, 150]);
    // frame contains the curve with margin
    expect(f.width).toBeGreaterThanOrEqual(100);
    expect(imageHeight(f)).toBeGreaterThanOrEqual(300);
    const m = moveImage(f, [5, -5]);
    expect([m.cx, m.cy]).toEqual([f.cx + 5, f.cy - 5]);
  });

  it("new images start behind the curve at half opacity", () => {
    const n = newRefImage("data:image/png;base64,AA", "a.png", 0.5, [
      [0, 0],
      [100, 270],
    ]);
    expect(n.opacity).toBe(0.5);
    expect(n.locked).toBe(false);
    expect(n.visible).toBe(true);
  });

  it("round-trips through JSON and rejects non-image data", () => {
    const i = base();
    expect(parseRefImage(serializeRefImage(i))).toEqual(i);
    expect(() =>
      parseRefImage(JSON.stringify({ ...i, src: "https://example.com/a.png" })),
    ).toThrow();
    expect(() => parseRefImage('{"nope":1}')).toThrow();
  });
});
