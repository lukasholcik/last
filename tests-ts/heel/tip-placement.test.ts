import { describe, expect, it } from "vitest";
import type { HeelParameters } from "../../src/lib/heel/model";
import {
  placeTip,
  placeTipAtOffset,
  tipOffset,
  topEnvelopeCenter,
} from "../../src/app/heel/tip-placement";
import { pointerValue, type ScalarDrag } from "../../src/app/heel/pointer";

const parameters: HeelParameters = {
  top: { leftX: -23, rightX: 29, backY: 2, frontY: 44 },
  bottom: { centerX: 1, centerY: 17, width: 9, depth: 10 },
  handles: { left: [-6, -10], right: [7, 15], back: [10, 7], front: [25, 30] },
  symmetricBody: true,
  roundness: 2,
  frontShoulderMm: 3,
};

describe("tip placement relative to the sharp top envelope", () => {
  it("uses independent asymmetric top bounds, not a cap or footprint centroid", () => {
    expect(topEnvelopeCenter(parameters, "x")).toBe(3);
    expect(topEnvelopeCenter(parameters, "y")).toBe(23);
    expect(tipOffset(parameters, "x")).toBe(-2);
    expect(tipOffset(parameters, "y")).toBe(-6);
  });
  it("round-trips numeric offsets and permits placement outside top bounds", () => {
    const moved = placeTipAtOffset(parameters, "y", 30);
    expect(moved.bottom.centerY).toBe(53);
    expect(tipOffset(moved, "y")).toBe(30);
    expect(placeTipAtOffset(parameters, "x", 0).bottom.centerX).toBe(3);
  });
  it.each(["x", "y"] as const)(
    "changes only the %s bottom centre coordinate",
    (axis) => {
      const snapshot = structuredClone(parameters);
      const moved = placeTip(parameters, axis, 12);
      const key = axis === "x" ? "centerX" : "centerY";
      expect(moved).toEqual({
        ...parameters,
        bottom: { ...parameters.bottom, [key]: 12 },
      });
      expect(moved.top).toBe(parameters.top);
      expect(moved.handles).toBe(parameters.handles);
      expect(parameters).toEqual(snapshot);
    },
  );
});

describe("tip gesture boundaries and recovery", () => {
  const drag: ScalarDrag = {
    pointerId: 3,
    startX: 100,
    initial: 17,
    unitsPerPixel: 0.5,
    min: -15,
    max: 60,
  };
  it("clamps to supplied expanded bounds, not the top's bounding box", () => {
    const value = pointerValue(drag, 3, 300, "move", 17)!;
    expect(value).toBe(60);
    expect(placeTip(parameters, "y", value).bottom.centerY).toBe(60);
  });
  it("restores the start on cancellation", () => {
    const start = structuredClone(parameters);
    const moved = placeTip(start, "y", 45);
    const restored = pointerValue(
      drag,
      3,
      170,
      "cancel",
      moved.bottom.centerY,
    )!;
    expect(placeTip(start, "y", restored)).toEqual(parameters);
  });
  it("ignores a foreign pointer, repeated values and invalid input", () => {
    expect(pointerValue(drag, 4, 160, "move", 17)).toBeNull();
    expect(pointerValue(drag, 3, 100, "move", 17)).toBeNull();
    expect(pointerValue(drag, 3, NaN, "move", 17)).toBeNull();
  });
});
