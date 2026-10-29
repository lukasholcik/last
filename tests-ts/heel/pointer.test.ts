import { describe, expect, it } from "vitest";
import {
  clientToViewBox,
  pointerValue,
  type ScalarDrag,
} from "../../src/app/heel/pointer";

describe("heel-local pointer conversion", () => {
  it("accounts for SVG meet letterboxing and client offsets", () => {
    expect(
      clientToViewBox(
        210,
        120,
        { left: 10, top: 20, width: 400, height: 200 },
        { x: 0, y: 0, width: 100, height: 100 },
      ),
    ).toEqual([50, 50]);
    expect(
      clientToViewBox(
        110,
        20,
        { left: 10, top: 20, width: 400, height: 200 },
        { x: -50, y: 0, width: 100, height: 100 },
      ),
    ).toEqual([-50, 0]);
  });
  it("ignores detached or nonfinite viewports", () => {
    expect(
      clientToViewBox(
        0,
        0,
        { left: 0, top: 0, width: 0, height: 100 },
        { x: 0, y: 0, width: 100, height: 100 },
      ),
    ).toBeNull();
  });
});

describe("heel scalar gesture", () => {
  const drag: ScalarDrag = {
    pointerId: 7,
    startX: 10,
    initial: 5,
    unitsPerPixel: 0.5,
    min: 0,
    max: 12,
  };
  it("moves only the scalar axis and clamps at its guide", () => {
    expect(pointerValue(drag, 7, 20, "move", 5)).toBe(10);
    expect(pointerValue(drag, 7, 100, "move", 5)).toBe(12);
    expect(pointerValue(drag, 7, -100, "move", 5)).toBe(0);
  });
  it("restores the initial scalar on cancellation", () => {
    expect(pointerValue(drag, 7, 100, "cancel", 11)).toBe(5);
  });
  it("ignores other pointers, repeated values and invalid positions", () => {
    expect(pointerValue(drag, 9, 20, "move", 5)).toBeNull();
    expect(pointerValue(drag, 7, 10, "move", 5)).toBeNull();
    expect(pointerValue(drag, 7, NaN, "move", 5)).toBeNull();
  });
});
