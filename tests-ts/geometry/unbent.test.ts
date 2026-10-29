import { describe, expect, it } from "vitest";
import {
  type BottomControls,
  type Cubic,
  type LegacyLastState as LastState,
  type Vec2,
} from "../../src/lib/geometry";
import { buildLegacyLast as buildLast } from "../../src/lib/geometry/legacy";
import { bottomCurvePoints } from "../../src/lib/geometry/bottom";
import {
  createStationEvaluator,
  pointAtStation,
  STATIONS,
  validateContour,
} from "../../src/lib/geometry/contour";
import { arc, bezier, sum } from "../../src/lib/geometry/math";
import { topCurvePoints } from "../../src/lib/geometry/top";
import baseline from "../fixtures/baseline.json";

// Independent quadrature: no production arc bounds or inverse used to measure s.
function integrated(p: Cubic, end = 1, n = 512): number {
  const speed = (t: number) => {
    const axis = (a: 0 | 1) =>
      3 *
      ((1 - t) ** 2 * (p[1][a] - p[0][a]) +
        2 * (1 - t) * t * (p[2][a] - p[1][a]) +
        t * t * (p[3][a] - p[2][a]));
    return Math.hypot(axis(0), axis(1));
  };
  let total = speed(0) + speed(end);
  for (let i = 1; i < n; i++) total += (i % 2 ? 4 : 2) * speed((end * i) / n);
  return (total * end) / (3 * n);
}

function guide(state: LastState) {
  return state.models.bottom.profile.map((name) =>
    bottomCurvePoints(state.models.bottom, name),
  );
}

function measuredAt(
  curves: Cubic[],
  point: Vec2,
): { station: number; z: number } {
  let station = 0;
  for (const p of curves) {
    if (point[0] <= p[3][0] + 1e-10) {
      // Bottom cubics are linear in y; this recovers t from position, not from s.
      const t = (point[0] - p[0][0]) / (p[3][0] - p[0][0]);
      const z =
        (1 - t) ** 3 * p[0][1] +
        3 * (1 - t) ** 2 * t * p[1][1] +
        3 * (1 - t) * t * t * p[2][1] +
        t ** 3 * p[3][1];
      return { station: station + integrated(p, t), z };
    }
    station += integrated(p);
  }
  throw new Error("sample is outside the guide");
}

function inputWith(bottom: Partial<BottomControls>) {
  const input = structuredClone(baseline.input);
  Object.assign(input.design.bottom, bottom);
  return input;
}

describe("schema-1 unbent reference top and bent display placement", () => {
  it("labels runtime top metadata as intrinsic without changing primitive top semantics", () => {
    const state = buildLast(baseline.input);
    expect(state.models.top.source).toContain("unbent (x,s)");
    expect(state.models.top.dimensions.length!.definition).toContain(
      "Unbent longitudinal span in intrinsic s",
    );
    for (const dimension of Object.values(state.models.top.dimensions))
      if (dimension.kind === "side_extent")
        expect(dimension.definition).toContain(
          "intrinsic s (stored as station_y)",
        );
    expect(state.reports.top.limits[0]).toContain("unbent intrinsic s");
  });

  it("measures baseline and 80 mm complete rebuild cost", () => {
    for (const height of [8, 80]) {
      const input = inputWith({ heel_height: height });
      const start = performance.now();
      const state = buildLast(input);
      console.info(
        `unbent + bent samples heel ${height}: ${(performance.now() - start).toFixed(1)} ms`,
      );
      expect(state.display.top).toHaveLength(10);
    }
  }, 60000);

  it("keeps every top model field and top report exactly invariant under bottom-only edits", () => {
    const reference = buildLast(baseline.input);
    const edits: Partial<BottomControls>[] = [
      { heel_height: 40 },
      { heel_height: 60 },
      { heel_height: 80 },
      { toe_spring: 15 },
      { seat_inclination_deg: 3 },
      { seat_arc_length: 55 },
      { contact_s: 180 },
      { blend_arc_length: 15 },
    ];
    expect(reference.models.top.design.length).toBe(250);
    expect(reference.models.top.points.toe_tip!.y).toBe(250);
    for (const edit of edits) {
      const state = buildLast(inputWith(edit));
      expect(state.models.top).toEqual(reference.models.top);
      expect(state.reports.top).toEqual(reference.reports.top);
      for (const name of STATIONS) {
        expect(state.models.top.points[name]!.y).toBe(
          state.inputs.design.top[`${name}_s`],
        );
        expect(Math.abs(state.models.top.points[name]!.x)).toBe(
          state.inputs.design.top[`${name}_width`],
        );
      }
    }
    const wider = structuredClone(baseline.input);
    wider.design.top.lateral_ball_width = 54;
    const state = buildLast(wider);
    expect(state.models.top).not.toEqual(reference.models.top);
    expect(state.models.top.points.lateral_ball!.x).toBe(54);
  }, 60000);

  it.each([8, 80])(
    "bends every sampled x,s point onto the actual guide at heel %i",
    (height) => {
      const state = buildLast(inputWith({ heel_height: height }));
      const curves = guide(state);
      state.display.top.forEach((curve, curveIndex) => {
        const original = topCurvePoints(state.models.top, curve.name);
        curve.points.forEach(([x, y, z], sample) => {
          const [originalX, station] = bezier(original, sample / 64);
          expect(x).toBe(originalX);
          const measured = measuredAt(curves, [y, z]);
          expect(Math.abs(measured.z - z)).toBeLessThan(1e-8);
          expect(Math.abs(measured.station - station)).toBeLessThan(0.0001);
        });
        expect(curve.points.at(-1)).toEqual(
          state.display.top[(curveIndex + 1) % state.display.top.length]!
            .points[0],
        );
      });
      const rear = state.models.bottom.points.bottom_heel_rear!;
      const toe = state.models.bottom.points.bottom_toe_end!;
      expect(state.display.top[0]!.points[0]).toEqual([0, rear.y, rear.z]);
      const toeCurve = state.display.top.find((curve) =>
        curve.name.startsWith("toe_tip_to_"),
      )!;
      expect(toeCurve.points[0]).toEqual([0, toe.y, toe.z]);
      expect(state.derived.projected_length).toBeLessThan(250);
    },
    60000,
  );

  it("maps between-station points and actual joins by integrated distance, never by t fraction", () => {
    const state = buildLast(inputWith({ heel_height: 80 }));
    const curves = guide(state);
    const lengths = curves.map((p) => arc(p));
    const accelerated = createStationEvaluator(curves, 250);
    for (const station of [
      0,
      13,
      49,
      50,
      77,
      123,
      174.9,
      175,
      179.3,
      185,
      211,
      250,
      ...lengths.map((_, i) => sum(lengths.slice(0, i + 1))).slice(0, -1),
    ]) {
      for (const point of [
        pointAtStation(curves, lengths, station, 250),
        accelerated(station),
      ]) {
        const measured = measuredAt(curves, point);
        expect(Math.abs(measured.station - station)).toBeLessThan(0.0001);
        expect(Math.abs(measured.z - point[1])).toBeLessThan(1e-8);
      }
    }
    const correct = pointAtStation(curves, lengths, 100, 250);
    const naive = bezier(curves[1]!, (100 - 50) / 125);
    expect(
      Math.hypot(correct[0] - naive[0], correct[1] - naive[1]),
    ).toBeGreaterThan(0.1);
    for (const station of [-1e-12, 250 + 1e-12, NaN, Infinity])
      for (const evaluate of [
        accelerated,
        (s: number) => pointAtStation(curves, lengths, s, 250),
      ])
        expect(() => evaluate(station)).toThrow(/outside/);
  }, 60000);

  it("independently rejects moved unbent stations even when design metadata stays unchanged", () => {
    const state = buildLast(baseline.input);
    state.models.top.points.medial_waist!.y += 1;
    const report = validateContour(state, state.inputs);
    expect(report.passed).toBe(false);
    expect(
      report.checks.find(
        (check) => check.name === "medial_waist_unbent_station",
      )?.passed,
    ).toBe(false);
    // The separate bottom projection/arc roundtrip remains valid.
    expect(
      report.checks.find(
        (check) => check.name === "medial_waist_station_roundtrip",
      )?.passed,
    ).toBe(true);
  }, 60000);

  it("places a steep forepart without changing the intrinsic model or widening errors", () => {
    const state = buildLast(inputWith({ toe_spring: 74 }));
    const curves = guide(state);
    expect(state.reports.bottom.passed).toBe(true);
    expect(state.models.top).toEqual(buildLast(baseline.input).models.top);
    for (const curve of state.display.top) {
      const p = topCurvePoints(state.models.top, curve.name);
      for (const sample of [1, 17, 33, 49, 63]) {
        const [x, y, z] = curve.points[sample]!;
        const [expectedX, station] = bezier(p, sample / 64);
        const actual = measuredAt(curves, [y, z]);
        expect(x).toBe(expectedX);
        expect(Math.abs(actual.station - station)).toBeLessThan(0.0001);
        expect(Math.abs(actual.z - z)).toBeLessThan(1e-8);
      }
    }
  }, 60000);

  it("keeps flat and tiny-height placement finite without rejecting intrinsic minimum gaps", () => {
    for (const height of [0, 1e-10]) {
      const input = inputWith({
        heel_height: height,
        toe_spring: height,
        seat_inclination_deg: 0,
      });
      input.design.top.medial_waist_s = 30.01;
      const state = buildLast(input);
      for (const curve of state.display.top) {
        const p = topCurvePoints(state.models.top, curve.name);
        curve.points.forEach(([x, y, z], sample) => {
          const [originalX, s] = bezier(p, sample / 64);
          expect(x).toBe(originalX);
          // Preserve the existing solve's tiny total-length residual: the exact
          // target endpoint anchors to the actual toe, rather than rescaling it.
          if (s === input.design.last_length)
            expect(y).toBe(state.models.bottom.points.bottom_toe_end!.y);
          else expect(y).toBeCloseTo(s, 7);
          expect(z).toBeGreaterThanOrEqual(0);
          expect(z).toBeLessThanOrEqual(height + 1e-20);
        });
      }
    }
  }, 60000);
});
