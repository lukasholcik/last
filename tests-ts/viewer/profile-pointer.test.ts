import { describe, expect, it } from "vitest";
import {
  modelToSvg,
  svgToModel,
  nudgeTarget,
} from "../../src/app/_components/viewer/profile-pointer";

const frame = { left: 16, topBase: 70, bottomBase: 250 };
describe("shape pointer coordinates and commit boundaries", () => {
  it("round trips top [reference_s,x] without confusing lateral x with height", () => {
    expect(modelToSvg([175, -46], "top", frame)).toEqual([191, 24]);
    expect(svgToModel([191, 24], "top", frame)).toEqual([175, -46]);
  });
  it("round trips side [y,z] with the SVG vertical direction reversed", () => {
    expect(modelToSvg([70, 80], "side", frame)).toEqual([86, 170]);
    expect(svgToModel([86, 170], "side", frame)).toEqual([70, 80]);
  });
  it("matches keyboard arrows to the visual direction in each plane", () => {
    expect(nudgeTarget([70, 80], "side", "ArrowUp", 1)).toEqual([70, 81]);
    expect(nudgeTarget([175, -46], "top", "ArrowUp", 5)).toEqual([175, -51]);
    expect(nudgeTarget([175, -46], "top", "ArrowRight", 0.1)).toEqual([
      175.1, -46,
    ]);
    expect(nudgeTarget([70, 80], "side", "Escape", 1)).toBeNull();
  });
});
