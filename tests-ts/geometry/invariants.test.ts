import { describe, it, expect, vi } from "vitest";
import * as contourModule from "../../src/lib/geometry/contour";
import {
  buildLast,
  parseContourInput,
  InputError,
  GeometryValidationError,
  type Cubic,
  type LastState,
  type ProjectedBottom,
} from "../../src/lib/geometry";
import { STATIONS, validateContour } from "../../src/lib/geometry/contour";
import {
  bottomCurvePoints,
  buildBottom,
  validateBottom,
} from "../../src/lib/geometry/bottom";
import {
  topCurvePoints,
  validateTop,
  sectionExtent,
} from "../../src/lib/geometry/top";
import baseline from "../fixtures/baseline.json";

function simpson(p: Cubic, end = 1, n = 1000): number {
  const derivative = [0, 1, 2].map((i) => [
    3 * (p[i + 1]![0] - p[i]![0]),
    3 * (p[i + 1]![1] - p[i]![1]),
  ]);
  const speed = (t: number) =>
    Math.hypot(
      ...[0, 1].map((a) =>
        [(1 - t) ** 2, 2 * t * (1 - t), t * t].reduce(
          (v, w, i) => v + w * derivative[i]![a]!,
          0,
        ),
      ),
    );
  let result = speed(0) + speed(end);
  for (let i = 1; i < n; i++) result += (i % 2 ? 4 : 2) * speed((end * i) / n);
  return (result * end) / (3 * n);
}
function projected(state: LastState): ProjectedBottom {
  const p = state.models.bottom.points;
  return {
    heel_height: state.inputs.design.bottom.heel_height,
    toe_spring: state.inputs.design.bottom.toe_spring,
    seat_projected_length: p.bottom_seat_front!.y,
    seat_inclination_deg: state.inputs.design.bottom.seat_inclination_deg,
    contact_forward: p.bottom_forepart_contact!.y,
    forepart_blend_length:
      p.bottom_forepart_blend_end!.y - p.bottom_forepart_contact!.y,
  };
}

describe("independent invariants, not just Python snapshots", () => {
  it("entry point refuses a failed report from any of the three validators", () => {
    const state = buildLast(baseline.input);
    for (const name of ["top", "bottom", "contour"] as const) {
      const failed = structuredClone(state);
      failed.reports[name].passed = false;
      const spy = vi
        .spyOn(contourModule, "buildContour")
        .mockReturnValue(failed);
      try {
        expect(() => buildLast(baseline.input)).toThrow(
          GeometryValidationError,
        );
        try {
          buildLast(baseline.input);
        } catch (error) {
          expect(error).toBeInstanceOf(GeometryValidationError);
          if (error instanceof GeometryValidationError)
            expect(error.reports[name].passed).toBe(false);
        }
      } finally {
        spy.mockRestore();
      }
    }
  });
  it("preserves 250 total and 50/125/10/65 regional arcs while projection decreases", () => {
    const states = [8, 40, 60, 80].map((h) => {
      const input = structuredClone(baseline.input);
      input.design.bottom.heel_height = h;
      return buildLast(input);
    });
    let previous = Infinity;
    for (const state of states) {
      expect(state.derived.projected_length).toBeLessThan(previous);
      previous = state.derived.projected_length;
      const curves = state.models.bottom.profile.map((n) =>
          bottomCurvePoints(state.models.bottom, n),
        ),
        lengths = curves.map((p) => simpson(p));
      lengths.forEach((v, i) =>
        expect(Math.abs(v - [50, 125, 10, 65][i]!)).toBeLessThan(0.001),
      );
      expect(Math.abs(lengths.reduce((a, b) => a + b, 0) - 250)).toBeLessThan(
        0.001,
      );
      for (const name of STATIONS) {
        const y = state.models.top.points[name]!.y;
        let measured = 0;
        for (let i = 0; i < curves.length; i++) {
          const p = curves[i]!;
          if (y <= p[3][0]) {
            measured += simpson(p, (y - p[0][0]) / (p[3][0] - p[0][0]));
            break;
          }
          measured += lengths[i]!;
        }
        expect(
          Math.abs(measured - state.inputs.design.top[`${name}_s`]),
        ).toBeLessThan(0.001);
        const [lo, hi] = sectionExtent(state.models.top, y),
          extent = name.startsWith("medial") ? -lo : hi;
        expect(
          Math.abs(extent - state.inputs.design.top[`${name}_width`]),
        ).toBeLessThan(0.1);
      }
      for (let i = 0; i < 3; i++) {
        const a = curves[i]!,
          b = curves[i + 1]!;
        expect(a[3]).toEqual(b[0]);
        expect((a[3][1] - a[2][1]) / (a[3][0] - a[2][0])).toBeCloseTo(
          (b[1][1] - b[0][1]) / (b[1][0] - b[0][0]),
          8,
        );
      }
      const topCurves = state.models.top.outline.map((n) =>
        topCurvePoints(state.models.top, n),
      );
      topCurves.forEach((p, i) => {
        const q = topCurves[(i + 1) % topCurves.length]!;
        expect(p[3]).toEqual(q[0]);
        expect(p[3][0] - p[2][0]).toBeCloseTo(q[1][0] - q[0][0], 8);
        expect(p[3][1] - p[2][1]).toBeCloseTo(q[1][1] - q[0][1], 8);
      });
    }
    const first = states[0]!,
      last = states[3]!;
    const ratios = STATIONS.map(
      (n) => last.derived.station_map[n].y / first.derived.station_map[n].y,
    );
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0.01);
    for (const n of ["bottom_forepart_blend", "bottom_forepart_ramp"]) {
      const a = bottomCurvePoints(first.models.bottom, n),
        b = bottomCurvePoints(last.models.bottom, n),
        shift = b[0][0] - a[0][0];
      a.forEach((p, i) => {
        expect(b[i]![0] - p[0]).toBeCloseTo(shift, 8);
        expect(b[i]![1]).toBeCloseTo(p[1], 8);
      });
    }
  }, 30000);
  it("station and bracket regressions remain admitted without changing inputs", () => {
    const flat = structuredClone(baseline.input);
    Object.assign(flat.design.bottom, {
      heel_height: 0,
      seat_inclination_deg: 0,
      toe_spring: 0,
    });
    flat.design.top.medial_waist_s = 30.01;
    const before = structuredClone(flat),
      state = buildLast(flat);
    expect(flat).toEqual(before);
    for (const n of STATIONS)
      expect(state.derived.station_map[n].y).toBe(flat.design.top[`${n}_s`]);
    flat.design.top.medial_waist_s = 30.009999;
    expect(() => buildLast(flat)).toThrow(InputError);
    const cap = structuredClone(baseline.input);
    Object.assign(cap.design.bottom, {
      heel_height: 40,
      seat_inclination_deg: 35,
      contact_s: 99,
    });
    expect(buildLast(cap).reports.contour.passed).toBe(true);
    cap.design.bottom.contact_s = 101;
    expect(() => buildLast(cap)).toThrow(/unattainable/);
    const inclined = structuredClone(baseline.input);
    inclined.design.top.medial_waist_s = 30.01;
    expect(() => buildLast(inclined)).toThrow(/0.01 mm/);
  }, 30000);
  it("validators measure actual curves, not metadata", () => {
    const state = buildLast(baseline.input),
      topExpected = { ...state.models.top.design },
      d = projected(state),
      l = state.derived.projected_length;
    state.models.top.design.length = 1;
    state.models.bottom.dimensions = {};
    state.models.bottom.reference_lines = {};
    expect(validateTop(state.models.top, topExpected).passed).toBe(true);
    expect(validateBottom(state.models.bottom, l, d).passed).toBe(true);
    state.models.bottom.points.bottom_toe_end!.z += 2;
    expect(validateContour(state, state.inputs).passed).toBe(false);
    state.models.top.points.medial_waist!.y += 1;
    expect(validateContour(state, state.inputs).passed).toBe(false);
    state.models.top.points.lateral_ball_to_lateral_toe_handle_start!.x += 10;
    expect(validateTop(state.models.top, topExpected).passed).toBe(false);
  });
  it("requires actual zero-height contact even below size tolerance", () => {
    for (const clearance of [0.05, 1e-10]) {
      const state = buildLast(baseline.input),
        d = projected(state),
        l = state.derived.projected_length;
      for (const p of Object.values(state.models.bottom.points))
        if (p.kind !== "reference") p.z += clearance;
      const report = validateBottom(state.models.bottom, l, d);
      expect(report.passed).toBe(false);
      expect(report.ground_contact).toEqual({ intervals: [], isolated_y: [] });
      expect(
        report.checks.find(
          (c) => c.name === "designated_station_has_ground_contact",
        )!.passed,
      ).toBe(false);
    }
    const tiny = structuredClone(baseline.input);
    Object.assign(tiny.design.bottom, {
      heel_height: 1e-10,
      seat_inclination_deg: 0,
      toe_spring: 1e-10,
    });
    expect(buildLast(tiny).reports.bottom.ground_contact!.intervals).toEqual(
      [],
    );
  });
  it("keeps short steep projected roundoff allowance narrow enough to reject edits", () => {
    for (const [length, c, toe, a] of [
      [250, 249.98, 10, 2],
      [10000, 9999.98, 10000, 0],
    ]) {
      const d: ProjectedBottom = {
        heel_height: 8,
        toe_spring: toe!,
        seat_projected_length: 50,
        seat_inclination_deg: a!,
        contact_forward: c!,
        forepart_blend_length: 0.01,
      };
      const model = buildBottom(length!, d);
      expect(validateBottom(model, length!, d).passed).toBe(true);
      model.points.bottom_forepart_ramp_handle_start!.z += 0.01;
      expect(validateBottom(model, length!, d).passed).toBe(false);
      const s = buildBottom(length!, d);
      s.points.bottom_forepart_blend_handle_end!.z =
        s.points.bottom_forepart_blend_end!.z;
      expect(
        validateBottom(s, length!, d).checks.find(
          (c) => c.name === "forepart_blend_convex_up",
        )!.passed,
      ).toBe(false);
    }
  });
  it("rejects contradictory bottom identity and preserves typed report errors", () => {
    const state = buildLast(baseline.input),
      d = projected(state),
      l = state.derived.projected_length;
    for (const [key, value] of Object.entries({
      schema_version: true,
      units: "cm",
      axes: ["x", "y"],
      kind: "top",
      closed: 0,
    })) {
      const model = structuredClone(state.models.bottom);
      Reflect.set(model, key, value);
      expect(() => validateBottom(model, l, d)).toThrow(InputError);
    }
    const reports = structuredClone(state.reports);
    reports.contour.passed = false;
    const error = new GeometryValidationError(reports);
    expect(error.reports.contour.passed).toBe(false);
  });
  it("parses exact keys, bounded finite numbers and deep unknown values without coercion", () => {
    for (const value of [true, NaN, Infinity, -Infinity, 1e300, -1, "250"]) {
      const input = structuredClone(baseline.input);
      Reflect.set(input.design, "last_length", value);
      expect(() => parseContourInput(input)).toThrow(InputError);
    }
    for (const key of Object.keys(baseline.input.design.bottom)) {
      const input = structuredClone(baseline.input);
      Reflect.set(input.design.bottom, key, true);
      expect(() => buildLast(input)).toThrow(InputError);
    }
    for (const input of [
      {},
      null,
      { top: {}, bottom: {} },
      { ...baseline.input, filename: "anything" },
    ])
      expect(() => buildLast(input)).toThrow(InputError);
    const extra = structuredClone(baseline.input);
    Reflect.set(extra.design.top, "medial_heel_y", 30);
    expect(() => buildLast(extra)).toThrow(InputError);
    let nested: unknown = [];
    for (let i = 0; i < 70; i++) nested = [nested];
    const deep = structuredClone(baseline.input);
    Reflect.set(deep, "description", nested);
    expect(() => buildLast(deep)).toThrow(/nesting/);
    for (const edits of [
      { heel_height: 0 },
      { heel_height: 200 },
      { toe_spring: 75 },
      { seat_inclination_deg: 90 },
    ]) {
      const i = structuredClone(baseline.input);
      Object.assign(i.design.bottom, edits);
      expect(() => buildLast(i)).toThrow(InputError);
    }
  });
});
