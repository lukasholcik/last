import { describe, it, expect } from "vitest";
import {
  ulp,
  nextafter,
  fsum,
  sum,
  bezier,
  arcLengthBounds,
  curveBounds,
  derivativeRoots,
} from "../../src/lib/geometry/math";
import { sectionRoots, segmentsIntersect } from "../../src/lib/geometry/top";
import type { Cubic } from "../../src/lib/geometry/types";

describe("IEEE arithmetic and independent known curves", () => {
  it("nextafter and ulp at signs, zero, subnormals, powers and extrema", () => {
    expect(nextafter(0, 1)).toBe(Number.MIN_VALUE);
    expect(nextafter(0, -1)).toBe(-Number.MIN_VALUE);
    expect(Object.is(nextafter(0, -0), -0)).toBe(true);
    expect(nextafter(1, 2)).toBe(1 + 2 ** -52);
    expect(nextafter(1, 0)).toBe(1 - 2 ** -53);
    expect(nextafter(-1, 0)).toBe(-1 + 2 ** -53);
    expect(nextafter(-1, -2)).toBe(-1 - 2 ** -52);
    expect(nextafter(Number.MAX_VALUE, Infinity)).toBe(Infinity);
    expect(nextafter(Infinity, 0)).toBe(Number.MAX_VALUE);
    expect(nextafter(-Infinity, 0)).toBe(-Number.MAX_VALUE);
    expect(nextafter(Number.MIN_VALUE, 0)).toBe(0);
    expect(ulp(0)).toBe(Number.MIN_VALUE);
    expect(ulp(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
    expect(ulp(1)).toBe(2 ** -52);
    expect(ulp(0.5)).toBe(2 ** -53);
    expect(ulp(-1024)).toBe(2 ** -42);
    expect(ulp(Number.MAX_VALUE)).toBe(2 ** 971);
    expect(ulp(Infinity)).toBe(Infinity);
  });
  it("fsum retains cancellation and half-even final rounding", () => {
    expect(fsum([1e16, 1, -1e16])).toBe(1);
    expect(sum([1e16, 1, -1e16])).toBe(1);
    expect(fsum([1, 2 ** -53, 2 ** -54])).toBe(1 + 2 ** -52);
    expect(fsum([1, 2 ** -53])).toBe(1);
    expect(fsum([])).toBe(0);
  });
  it("uses analytic extrema and multiple section roots", () => {
    const p: Cubic = [
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 0],
    ];
    expect(bezier(p, 0.5)).toEqual([2, 3]);
    expect(curveBounds(p, 1)).toEqual([0, 3]);
    expect(sectionRoots(p, 2.25)).toEqual([0.25, 0.75]);
    expect(sectionRoots(p, 3)).toEqual([0.5]);
    expect(derivativeRoots([0, 1, 2, 3])).toEqual([]);
    expect(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
  });
  it("bounds straight and independently integrated quadratic lengths", () => {
    const line: Cubic = [
      [0, 0],
      [1, 4 / 3],
      [2, 8 / 3],
      [3, 4],
    ];
    const [lo, hi] = arcLengthBounds(line);
    expect(lo).toBeCloseTo(5, 12);
    expect(hi).toBeCloseTo(5, 12);
    const quadratic: Cubic = [
        [0, 0],
        [1 / 3, 0],
        [2 / 3, 1 / 3],
        [1, 1],
      ],
      exact = Math.sqrt(5) / 2 + Math.asinh(2) / 4;
    const [a, b] = arcLengthBounds(quadratic, 1e-6);
    expect(a).toBeLessThanOrEqual(exact);
    expect(b).toBeGreaterThanOrEqual(exact);
    expect(b - a).toBeLessThanOrEqual(1e-6);
    expect(() => arcLengthBounds(quadratic, 0)).toThrow();
  });
});
