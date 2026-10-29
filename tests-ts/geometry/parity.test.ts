import { describe, it, expect } from "vitest";
import { buildLegacyLast as buildLast } from "../../src/lib/geometry/legacy";
import { buildTop, validateTop } from "../../src/lib/geometry/top";
import baseline from "../fixtures/baseline.json";
import heel40 from "../fixtures/heel-40.json";
import heel60 from "../fixtures/heel-60.json";
import heel80 from "../fixtures/heel-80.json";
import flat from "../fixtures/flat.json";
import flatGap from "../fixtures/flat-minimum-gap.json";
import waistCap from "../fixtures/waist-cap.json";
import length260 from "../fixtures/length-260.json";
import width54 from "../fixtures/width-54.json";

function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function compare(actual: unknown, expected: unknown, path = "root"): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    if (typeof actual !== "number") return;
    let tolerance = 1e-6; // Named geometry coordinates, dimensions and display samples.
    if (path.includes(".reports.")) {
      tolerance =
        path.includes(".contour.") ||
        path.includes("bottom_arc_length") ||
        path.includes("last_length_bounds")
          ? 0.01
          : 1e-6;
      if (path.endsWith(".tolerance"))
        tolerance = Math.max(1e-12, Math.abs(expected) * 1e-6);
      if (path.endsWith(".uncertainty_mm")) tolerance = 1e-7;
    }
    if (path.endsWith(".schema_version")) tolerance = 0;
    expect(
      Math.abs(actual - expected),
      `${path}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`,
    ).toBeLessThanOrEqual(tolerance);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    if (!Array.isArray(actual)) return;
    expect(actual.length, path).toBe(expected.length);
    expected.forEach((v, i) => compare(actual[i], v, `${path}[${i}]`));
  } else if (object(expected)) {
    expect(object(actual), path).toBe(true);
    if (!object(actual)) return;
    expect(Object.keys(actual).sort(), path).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [k, v] of Object.entries(expected))
      compare(actual[k], v, `${path}.${k}`);
  } else expect(actual, path).toBe(expected); // Names, flags and limits must match exactly.
}

describe("immutable Python-reference fixture parity", () => {
  for (const [name, fixture] of Object.entries({
    baseline,
    heel40,
    heel60,
    heel80,
    flat,
    flatGap,
    waistCap,
    length260,
    width54,
  })) {
    it(
      name,
      () => {
        const before = structuredClone(fixture.input),
          start = performance.now();
        const actual = buildLast(fixture.input);
        // These fields intentionally retain the original posed-bottom contract.
        compare(actual.inputs, fixture.expected.inputs, "root.inputs");
        compare(
          actual.models.bottom,
          fixture.expected.models.bottom,
          "root.models.bottom",
        );
        compare(
          actual.reports.bottom,
          fixture.expected.reports.bottom,
          "root.reports.bottom",
        );
        compare(actual.derived, fixture.expected.derived, "root.derived");
        compare(
          actual.display.bottom,
          fixture.expected.display.bottom,
          "root.display.bottom",
        );
        // Frozen top snapshots describe the old projected design. Keep primitive
        // construction/validation parity without pretending it is the new unbent model.
        const legacyTop = buildTop(fixture.expected.models.top.design);
        compare(legacyTop, fixture.expected.models.top, "root.models.top");
        compare(
          validateTop(legacyTop, fixture.expected.models.top.design),
          fixture.expected.reports.top,
          "root.reports.top",
        );
        for (const check of fixture.expected.reports.contour.checks)
          compare(
            actual.reports.contour.checks.find(
              (candidate) => candidate.name === check.name,
            ),
            check,
            "root.reports.contour.checks",
          );
        compare(
          actual.reports.contour.last_length_bounds,
          fixture.expected.reports.contour.last_length_bounds,
          "root.reports.contour.last_length_bounds",
        );
        expect(actual.reports.contour.passed).toBe(true);
        expect(actual.reports.contour.limits.slice(0, 2)).toEqual(
          fixture.expected.reports.contour.limits.slice(0, 2),
        );
        expect(actual.reports.contour.limits[2]).toContain(
          "unbent intrinsic s",
        );
        expect(fixture.input).toEqual(before);
        console.info(`${name}: ${(performance.now() - start).toFixed(1)} ms`);
      },
      30000,
    );
  }
});
