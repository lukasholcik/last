import { describe, expect, it, vi } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import {
  buildLast,
  parseFootFirstInput,
  GeometryValidationError,
  InputError,
  type FootFirstInput,
} from "../../src/lib/geometry";
import * as footFirst from "../../src/lib/geometry/foot-first";
import * as sectionModule from "../../src/lib/geometry/section";
import {
  createSectionEvaluator,
  validateSection,
} from "../../src/lib/geometry/section";
import { nextafter } from "../../src/lib/geometry/math";

describe("rear block prototype", () => {
  it.each([0, 8, 40, 80])(
    "builds a closed clear profile at heel %i with the rear frame rigid",
    (height) => {
      const p = input();
      p.pose.heel_height = height;
      if (height === 0)
        Object.assign(p.pose, { seat_inclination_deg: 0, toe_spring: 0 });
      const state = buildLast(p),
        m = state.models.section;
      expect(Object.values(state.reports).every((r) => r.passed)).toBe(true);
      const alpha =
        state.resolved.bend_angle_rad +
        (p.pose.seat_inclination_deg * Math.PI) / 180;
      const t = [Math.cos(alpha), -Math.sin(alpha)],
        n = [Math.sin(alpha), Math.cos(alpha)];
      const origin = state.models.bottom.points.bottom_heel_rear!;
      const local = (q: { y: number; z: number }) => [
        (q.y - origin.y) * t[0]! + (q.z - origin.z) * t[1]!,
        (q.y - origin.y) * n[0]! + (q.z - origin.z) * n[1]!,
      ];
      const h = p.centre_section.top_front_height_ratio * p.foot.length;
      expect(local(m.points.heel_middle)[0]).toBeCloseTo(
        -0.02 * p.foot.length,
        9,
      );
      expect(local(m.points.heel_middle)[1]).toBeCloseTo(0.5 * h, 9);
      expect(local(m.points.cut_rear)[0]).toBeCloseTo(
        p.centre_section.top_rear_station_ratio * p.foot.length,
        9,
      );
      expect(local(m.points.cut_rear)[1]).toBeCloseTo(h, 9);
      expect(local(m.points.cut_front)[0]).toBeCloseTo(
        p.centre_section.top_front_station_ratio * p.foot.length,
        9,
      );
      expect(local(m.points.cut_front)[1]).toBeCloseTo(h, 9);
      expect(
        state.models.bottom.dimensions.seat_inclination_deg!.expected,
      ).toBeCloseTo((alpha * 180) / Math.PI, 9);
      const evaluator = createSectionEvaluator(state, m);
      m.boundary.forEach((piece, i) => {
        const end = evaluator.piece(piece, 1),
          start = evaluator.piece(m.boundary[(i + 1) % m.boundary.length]!, 0);
        expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeLessThan(
          1e-8,
        );
      });
    },
  );
  it("keeps reference foot/top models and reports unchanged by heel pose", () => {
    const a = buildLast(pose(8)),
      b = buildLast(pose(80));
    expect(a.models.foot).toEqual(b.models.foot);
    expect(a.models.top).toEqual(b.models.top);
    expect(a.reports.foot).toEqual(b.reports.foot);
    expect(a.reports.top).toEqual(b.reports.top);
  });
  it("accepts the ordinary .14 waist profile without changing harmonic slopes", () => {
    const p = input();
    p.centre_section.waist_height_ratio = 0.14;
    expect(buildLast(p).reports.section.passed).toBe(true);
  });
  it("rejects an actual rear angle at or above ninety degrees", () => {
    const p = pose(80);
    p.pose.seat_inclination_deg = 70;
    expect(() => buildLast(p)).toThrow(
      /theta \+ seat offset must be less than 90/,
    );
  });
  it("accepts a negative relative offset when the actual H80 rear angle stays positive", () => {
    const p = pose(80);
    p.pose.seat_inclination_deg = -6.5;
    const state = buildLast(p);
    expect(state.inputs.pose.seat_inclination_deg).toBe(-6.5);
    const actual = (state.resolved.bend_angle_rad * 180) / Math.PI - 6.5;
    expect(actual).toBeGreaterThan(0);
    expect(state.models.bottom.dimensions.seat_inclination_deg!.expected).toBe(
      actual,
    );
    expect(Object.values(state.reports).every((report) => report.passed)).toBe(
      true,
    );
  });
  it("builds the previously rejected negative-offset image-fit input", () => {
    const p = input();
    p.template.medial_waist.station_ratio = 0.463;
    p.template.medial_ball.station_ratio = 0.6799999999999999;
    p.design.seat_arc_ratio = 0.25999999999999995;
    Object.assign(p.pose, {
      heel_height: 83.15999999999998,
      toe_spring: 0,
      seat_inclination_deg: -6.5,
    });
    Object.assign(p.centre_section, {
      top_rear_station_ratio: 0.016450000000000003,
      top_front_station_ratio: 0.343,
      toe_roof_station_ratio: 0.9329999999999999,
      top_front_height_ratio: 0.322,
      waist_height_ratio: 0.283,
      ball_height_ratio: 0.14,
      toe_roof_height_ratio: 0.0639,
    });
    const before = structuredClone(p),
      state = buildLast(p);
    expect(p).toEqual(before);
    expect(Object.values(state.reports).every((report) => report.passed)).toBe(
      true,
    );
  });
  it("rejects net-negative and exactly ninety-degree actual angles, without clamping offsets", () => {
    const p = pose(80);
    p.pose.seat_inclination_deg = -40;
    expect(parseFootFirstInput(p).pose.seat_inclination_deg).toBe(-40);
    expect(() => buildLast(p)).toThrow(/actual rear sole angle.*nonnegative/);
    p.pose.seat_inclination_deg =
      90 - (footFirst.resolveFootFirst(p).bend_angle_rad * 180) / Math.PI;
    expect(() => buildLast(p)).toThrow(/actual rear sole angle.*less than 90/);
  });
  it("keeps signed offset bounds and finite-number guards", () => {
    const p = pose(80);
    p.pose.seat_inclination_deg = -90;
    expect(parseFootFirstInput(p).pose.seat_inclination_deg).toBe(-90);
    expect(() => buildLast(p)).toThrow(/actual rear sole angle.*nonnegative/);
    for (const value of [-90.001, 90, NaN, Infinity, -Infinity]) {
      p.pose.seat_inclination_deg = value;
      expect(() => parseFootFirstInput(p)).toThrow(InputError);
    }
  });
});

const fields = Object.keys(
  baseline.centre_section,
) as (keyof FootFirstInput["centre_section"])[];
function input() {
  return parseFootFirstInput(structuredClone(baseline));
}
function pose(height: number) {
  const p = input();
  p.pose.heel_height = height;
  return p;
}
function flat() {
  const p = input();
  Object.assign(p.pose, {
    heel_height: 0,
    toe_spring: 0,
    seat_inclination_deg: 0,
  });
  return p;
}
describe("schema-3 centre-section input", () => {
  it("requires the explicit seven-field schema without hidden defaults or migration", () => {
    expect(baseline.schema_version).toBe(4);
    const old = structuredClone(baseline);
    Reflect.set(old, "schema_version", 3);
    Reflect.deleteProperty(old, "centre_section");
    expect(() => buildLast(old)).toThrow(/schema_version 4/);
    const missing = structuredClone(baseline);
    Reflect.deleteProperty(missing, "centre_section");
    expect(() => parseFootFirstInput(missing)).toThrow(InputError);
    for (const field of fields) {
      const p = input();
      Reflect.deleteProperty(p.centre_section, field);
      expect(() => parseFootFirstInput(p)).toThrow(InputError);
    }
    for (const value of [
      null,
      [],
      {},
      { ...baseline.centre_section, extra: 1 },
    ]) {
      const p = input();
      Reflect.set(p, "centre_section", value);
      expect(() => parseFootFirstInput(p)).toThrow(InputError);
    }
  });
  it("rejects nonfinite, negative, zero, genuinely short and unordered section controls", () => {
    for (const field of fields)
      for (const bad of [
        NaN,
        Infinity,
        -Infinity,
        true,
        "0.1",
        1e300,
        ...(field.endsWith("down_offset_deg") ? [] : [-0.01]),
        ...(field.endsWith("_deg") || field === "heel_bulge_ratio" ? [] : [0]),
      ]) {
        const p = input();
        Reflect.set(p.centre_section, field, bad);
        expect(() => parseFootFirstInput(p)).toThrow(InputError);
      }
    for (const change of [
      { top_rear_station_ratio: 0.4 },
      { top_front_station_ratio: 0.5 },
      { toe_roof_station_ratio: 0.69 },
      { toe_roof_station_ratio: 0.73 },
    ]) {
      const p = input();
      Object.assign(p.centre_section, change);
      expect(() => parseFootFirstInput(p)).toThrow(/centre_section/);
    }
    const short = flat();
    short.centre_section.top_rear_station_ratio = 0.009999 / 250;
    expect(() => parseFootFirstInput(short)).toThrow(/0.01/);
    const tooHigh = input();
    for (const field of fields.filter((f) => f.includes("height")))
      tooHigh.centre_section[field] = 40;
    expect(() => buildLast(tooHigh)).toThrow(/absolute z/);
  });
  it("honors tiny resolved stations/heights and next-down .01 mm roundoff without clamping", () => {
    const p = flat();
    for (const field of fields.filter((f) => f.includes("height")))
      p.centre_section[field] = nextafter(0.01 / 250, 0);
    p.centre_section.top_rear_station_ratio = nextafter(0.01 / 250, 0);
    p.centre_section.top_front_station_ratio = 0.02 / 250;
    p.centre_section.toe_roof_station_ratio = (250 - 0.01) / 250;
    p.design.toe_extension_ratio = 0;
    p.centre_section.instep_front_down_offset_deg = 0;
    p.centre_section.instep_waist_down_offset_deg = 0;
    const before = structuredClone(p),
      state = buildLast(p);
    expect(p).toEqual(before);
    expect(state.inputs).toEqual(before);
    expect(state.models.section.points.cut_rear.reference_s).toBe(
      before.centre_section.top_rear_station_ratio * 250,
    );
    expect(state.models.section.points.cut_front.height).toBeLessThan(0.01);
    expect(state.reports.section.passed).toBe(true);
    p.centre_section.top_front_height_ratio = 0.009999 / 250;
    expect(() => buildLast(p)).toThrow(/0.01/);
  });
  it("rejects a folded roof without changing the authored pose", () => {
    const p = pose(80);
    p.centre_section.waist_height_ratio = 0.00004;
    const before = structuredClone(p);
    expect(() => buildLast(p)).toThrow(GeometryValidationError);
    expect(p).toEqual(before);
  });
});

describe("final section descriptor validation and five-report acceptance", () => {
  it("rejects corrupted controls/points/boundary without trusting display samples", () => {
    const state = buildLast(input());
    const mutations: ((p: typeof state.models.section) => void)[] = [
      (p) => {
        p.height_curves.front_to_waist[1][1] = -1;
      },
      (p) => {
        p.height_curves.front_to_waist[1][1] += 1;
      },
      (p) => {
        p.height_curves.waist_to_ball[1][0] += 1;
      },
      (p) => {
        p.points.waist_roof.height += 1;
      },
      (p) => {
        p.points.cut_rear.z += 1;
      },
      (p) => {
        Reflect.set(p, "closed", false);
      },
      (p) => {
        const q = p.boundary[4]!;
        if (q.kind === "cubic")
          q.points[1][1] = state.models.bottom.points.bottom_toe_end!.z - 0.001;
      },
      (p) => {
        const q = p.boundary[4]!;
        if (q.kind === "cubic")
          q.points[2][0] = state.models.bottom.points.bottom_toe_end!.y + 1;
      },
      (p) => {
        const q = p.boundary[8]!;
        if (q.kind === "line") q.points[1][1] += 0.01;
      },
      (p) => {
        const q = p.boundary[9]!;
        if (q.kind === "cubic")
          q.points[1][1] = state.inputs.pose.heel_height - 0.001;
      },
      (p) => {
        const q = p.boundary[5]!;
        if (q.kind === "roof") Reflect.set(q, "reverse", false);
      },
    ];
    for (const mutate of mutations) {
      const model = structuredClone(state.models.section);
      mutate(model);
      expect(validateSection(state, model).passed).toBe(false);
    }
    const lower = structuredClone(state);
    lower.models.bottom.points.bottom_forepart_ramp_handle_end!.z += 0.001;
    expect(validateSection(lower, lower.models.section).passed).toBe(false);
  });
  it("does not evaluate section on a failed base report and refuses a failed section report", () => {
    const state = buildLast(input()),
      failed = structuredClone(state);
    failed.reports.bottom.passed = false;
    const baseSpy = vi
      .spyOn(footFirst, "buildFootFirst")
      .mockReturnValueOnce(failed);
    const sectionSpy = vi.spyOn(sectionModule, "buildSection");
    try {
      buildLast(input());
      throw new Error("accepted failed base");
    } catch (error) {
      expect(error).toBeInstanceOf(GeometryValidationError);
      if (error instanceof GeometryValidationError) {
        expect(error.reports.section.passed).toBe(false);
        expect(error.reports.section.checks[0]!.name).toContain(
          "not_evaluated",
        );
      }
    } finally {
      baseSpy.mockRestore();
      expect(sectionSpy).not.toHaveBeenCalled();
      sectionSpy.mockRestore();
    }
    const failedReport = structuredClone(state.reports.section);
    failedReport.passed = false;
    const reportSpy = vi
      .spyOn(sectionModule, "validateSection")
      .mockReturnValueOnce(failedReport);
    try {
      expect(() => buildLast(input())).toThrow(GeometryValidationError);
    } finally {
      reportSpy.mockRestore();
    }
  });
});
