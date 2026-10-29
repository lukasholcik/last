import { describe, expect, it, vi } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import legacy from "../fixtures/baseline.json";
import {
  buildLast,
  parseFootFirstInput,
  GeometryValidationError,
  InputError,
  type FootFirstInput,
  type LastState,
  type Cubic,
  type Vec2,
} from "../../src/lib/geometry";
import * as footFirst from "../../src/lib/geometry/foot-first";
import {
  resolveFootFirst,
  solvePosture,
  referenceToPosed,
  validateFootFirst,
} from "../../src/lib/geometry/foot-first";
import {
  STATIONS,
  createStationEvaluator,
} from "../../src/lib/geometry/contour";
import { bottomCurvePoints } from "../../src/lib/geometry/bottom";
import {
  buildTop,
  topCurvePoints,
  validateTop,
} from "../../src/lib/geometry/top";
import { bezier, nextafter, ulp } from "../../src/lib/geometry/math";

function input(): FootFirstInput {
  return structuredClone(parseFootFirstInput(baseline));
}
function withPose(pose: Partial<FootFirstInput["pose"]>) {
  const value = input();
  Object.assign(value.pose, pose);
  return value;
}
function integrate(p: Cubic, end = 1, n = 1024): number {
  const speed = (t: number) => {
    const derivative = (axis: 0 | 1) =>
      3 *
      ((1 - t) ** 2 * (p[1][axis] - p[0][axis]) +
        2 * (1 - t) * t * (p[2][axis] - p[1][axis]) +
        t * t * (p[3][axis] - p[2][axis]));
    return Math.hypot(derivative(0), derivative(1));
  };
  let result = speed(0) + speed(end);
  for (let i = 1; i < n; i++) result += (i % 2 ? 4 : 2) * speed((end * i) / n);
  return (result * end) / (3 * n);
}
function actualGuide(state: LastState) {
  return state.models.bottom.profile.map((name) =>
    bottomCurvePoints(state.models.bottom, name),
  );
}
function actualArcAt(curves: Cubic[], point: Vec2) {
  let station = 0;
  for (const p of curves) {
    if (point[0] <= p[3][0] + 1e-10) {
      // Recover the bottom parameter from linear forward coordinate, never from s.
      const t = (point[0] - p[0][0]) / (p[3][0] - p[0][0]);
      const z =
        (1 - t) ** 3 * p[0][1] +
        3 * (1 - t) ** 2 * t * p[1][1] +
        3 * (1 - t) * t * t * p[2][1] +
        t ** 3 * p[3][1];
      return { station: station + integrate(p, t), z };
    }
    station += integrate(p);
  }
  throw new Error("point is outside the final public guide");
}
// Independent inverse: direct cosine expression and a separate bracket loop.
function independentAngle(anchor: number, radius: number, height: number) {
  if (height === 0) return 0;
  let lower = 0,
    upper = Math.PI / 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lower + upper) / 2;
    if (anchor * Math.sin(mid) + radius * (1 - Math.cos(mid)) < height)
      lower = mid;
    else upper = mid;
  }
  return (lower + upper) / 2;
}

describe("strict foot-first authored contract", () => {
  it("keeps the deliberately new baseline and source provenance unchanged", () => {
    const value = input(),
      before = structuredClone(value);
    Object.freeze(value.reference);
    Object.freeze(value.foot);
    const state = buildLast(value);
    expect(value).toEqual(before);
    expect(state.inputs).toEqual(before);
    expect(state.inputs).not.toBe(value);
    expect(state.models.foot.points.toe_tip!.y).toBe(250);
    expect(state.models.top.points.toe_tip!.y).toBe(260);
    expect(state.resolved.toe_extension).toBe(10);
    expect(state.resolved.posed_last_length).toBeGreaterThan(260);
    expect(Object.keys(state.reports).sort()).toEqual([
      "bottom",
      "contour",
      "foot",
      "section",
      "top",
    ]);
    expect(Object.values(state.reports).every((report) => report.passed)).toBe(
      true,
    );
    expect(
      state.reports.foot.sections!.find(
        (section) => section.name === "medial_ball",
      )!.width,
    ).not.toBe(100);
  });

  it.each([
    null,
    [],
    {},
    legacy.input,
    { top: {}, bottom: {} },
    { ...baseline, schema_version: 1 },
  ])("rejects absent/legacy input rather than migrating it: %j", (value) => {
    expect(() => buildLast(value)).toThrow(InputError);
  });

  it("requires exact root and nested objects, including all eight station objects", () => {
    for (const key of Object.keys(baseline)) {
      const missing = input();
      Reflect.deleteProperty(missing, key);
      expect(() => parseFootFirstInput(missing)).toThrow(InputError);
    }
    for (const key of [
      "reference",
      "foot",
      "template",
      "design",
      "pose",
      "centre_section",
    ] as const) {
      const extra = input();
      Reflect.set(extra[key], "unexpected", 1);
      expect(() => parseFootFirstInput(extra)).toThrow(InputError);
      const array = input();
      Reflect.set(array, key, []);
      expect(() => parseFootFirstInput(array)).toThrow(InputError);
      for (const field of Object.keys(baseline[key])) {
        const missing = input();
        Reflect.deleteProperty(missing[key], field);
        expect(() => parseFootFirstInput(missing)).toThrow(InputError);
      }
    }
    for (const name of STATIONS) {
      for (const field of ["station_ratio", "side_extent_ratio"]) {
        const missing = input();
        Reflect.deleteProperty(missing.template[name], field);
        expect(() => parseFootFirstInput(missing)).toThrow(InputError);
      }
      const extra = input();
      Reflect.set(extra.template[name], "resolved_mm", 30);
      expect(() => parseFootFirstInput(extra)).toThrow(InputError);
    }
  });

  it("does not coerce finite numbers or accept negative ratios, invalid provenance or competing lengths", () => {
    for (const value of [NaN, Infinity, -Infinity, -0.01, "0.1", true, 1e300]) {
      for (const name of Object.keys(baseline.design)) {
        const malformed = input();
        Reflect.set(malformed.design, name, value);
        expect(() => parseFootFirstInput(malformed)).toThrow(InputError);
      }
    }
    for (const value of [NaN, Infinity, "250", true, 0, -1, 10001]) {
      const malformed = input();
      Reflect.set(malformed.foot, "length", value);
      expect(() => parseFootFirstInput(malformed)).toThrow(InputError);
    }
    for (const provenance of ["observed", true, null]) {
      const malformed = input();
      Reflect.set(malformed.reference, "provenance", provenance);
      expect(() => parseFootFirstInput(malformed)).toThrow(InputError);
    }
    for (const name of [
      "last_length",
      "contact_s",
      "bend_angle_rad",
      "posture_allowance",
    ]) {
      const malformed = input();
      Reflect.set(malformed.design, name, 1);
      expect(() => parseFootFirstInput(malformed)).toThrow(InputError);
    }
    const measured = input();
    measured.reference.provenance = "measured";
    expect(parseFootFirstInput(measured).reference).toEqual(measured.reference);
    let nested: unknown = [];
    for (let i = 0; i < 70; i++) nested = [nested];
    const deep = input();
    Reflect.set(deep, "description", nested);
    expect(() => parseFootFirstInput(deep)).toThrow(/nesting/);
  });

  it("checks finite dimensions/template extents/pose fields and the actual finite size limits", () => {
    for (const value of [true, "8", -1, NaN, Infinity, 10001]) {
      for (const field of [
        "heel_height",
        "toe_spring",
        "seat_inclination_deg",
      ]) {
        if (field === "seat_inclination_deg" && value === -1) continue; // Signed relative offset is intentional.
        const malformed = input();
        Reflect.set(malformed.pose, field, value);
        expect(() => parseFootFirstInput(malformed)).toThrow(InputError);
      }
      for (const field of ["foot_length", "foot_width"]) {
        const malformed = input();
        Reflect.set(malformed.reference, field, value);
        expect(() => parseFootFirstInput(malformed)).toThrow(InputError);
      }
      for (const field of ["station_ratio", "side_extent_ratio"]) {
        const malformed = input();
        Reflect.set(malformed.template.medial_ball, field, value);
        expect(() => parseFootFirstInput(malformed)).toThrow(InputError);
      }
    }
    const invalidAngle = input();
    invalidAngle.pose.seat_inclination_deg = 90;
    expect(() => parseFootFirstInput(invalidAngle)).toThrow(/less than 90/);
    const beyondFoot = input();
    beyondFoot.template.medial_toe.station_ratio = 1;
    expect(() => parseFootFirstInput(beyondFoot)).toThrow(
      /reference foot stations/,
    );
    const forepartBeyondFoot = input();
    forepartBeyondFoot.design.blend_arc_ratio = 0.32;
    // A+J=255 would still fit the extended last L0=260, but not the foot F=250.
    expect(() => parseFootFirstInput(forepartBeyondFoot)).toThrow(/A\+J < F/);
  });

  it("allows zero extension and tiny valid ratios with resolved .01 mm roundoff-aware gaps", () => {
    const zero = input();
    zero.design.toe_extension_ratio = 0;
    const state = buildLast(zero);
    expect(state.resolved.toe_extension).toBe(0);
    expect(state.resolved.reference_last_length).toBe(250);
    expect(state.models.top.points).toEqual(state.models.foot.points);
    const tiny = withPose({
      heel_height: 0,
      toe_spring: 0,
      seat_inclination_deg: 0,
    });
    tiny.design.seat_arc_ratio = 0.00004;
    tiny.design.blend_arc_ratio = 0.00004;
    tiny.design.toe_extension_ratio = 1e-8;
    tiny.template.medial_waist.station_ratio = 30.01 / 250;
    tiny.centre_section.top_front_station_ratio = 0.08;
    tiny.centre_section.waist_height_ratio =
      tiny.centre_section.top_front_height_ratio;
    tiny.centre_section.instep_front_handle_ratio = 0.004;
    tiny.centre_section.instep_waist_handle_ratio = 0.004;
    const small = buildLast(tiny);
    expect(small.resolved.seat_arc_length).toBe(0.01);
    expect(small.resolved.blend_arc_length).toBe(0.01);
    expect(small.resolved.toe_extension).toBeCloseTo(1e-6, 14);
    expect(
      small.models.foot.points.medial_waist!.y -
        small.models.foot.points.medial_heel!.y,
    ).toBeCloseTo(0.01, 12);
    const roundoff = structuredClone(tiny);
    roundoff.design.seat_arc_ratio = nextafter(0.00004, 0);
    roundoff.design.blend_arc_ratio = nextafter(0.00004, 0);
    expect(buildLast(roundoff).reports.bottom.passed).toBe(true);
    tiny.template.medial_waist.station_ratio = 30.009999 / 250;
    expect(() => buildLast(tiny)).toThrow(/0.01/);
    const inclined = input();
    inclined.template.medial_waist.station_ratio = 30.01 / 250;
    inclined.centre_section.top_front_station_ratio = 0.08;
    inclined.centre_section.waist_height_ratio =
      inclined.centre_section.top_front_height_ratio;
    inclined.centre_section.instep_front_handle_ratio = 0.004;
    inclined.centre_section.instep_waist_handle_ratio = 0.004;
    expect(buildLast(inclined).reports.foot.passed).toBe(true);
  });

  it.each(["medial_heel", "lateral_heel"] as const)(
    "preserves the exact and next-down first-station minimum for %s",
    (name) => {
      for (const stationRatio of [0.01 / 250, nextafter(0.01 / 250, 0)]) {
        const value = input();
        value.template[name].station_ratio = stationRatio;
        const before = structuredClone(value);
        const parsed = parseFootFirstInput(value);
        const state = buildLast(value);
        const station = stationRatio * value.foot.length;
        expect(value).toEqual(before);
        expect(parsed).toEqual(before);
        expect(state.inputs).toEqual(before);
        expect(state.inputs.reference).toEqual(before.reference);
        expect(state.models.foot.points[name]!.y).toBe(station);
        expect(state.models.top.points[name]!.y).toBe(station);
        expect(state.derived.station_map[name].reference_s).toBe(station);
        expect(
          Object.values(state.reports).every((report) => report.passed),
        ).toBe(true);
        if (stationRatio < 0.01 / 250) expect(station).toBeLessThan(0.01);
      }
    },
  );

  it.each(["medial_heel", "lateral_heel"] as const)(
    "still rejects genuinely undersized, zero and negative first stations for %s",
    (name) => {
      for (const station of [0.009999, 0.01 - 2e-11, 0, -0.01]) {
        const value = input();
        value.template[name].station_ratio = station / value.foot.length;
        const before = structuredClone(value);
        expect(() => parseFootFirstInput(value)).toThrow(InputError);
        expect(() => buildLast(value)).toThrow(InputError);
        expect(value).toEqual(before);
      }
    },
  );

  it("retains strict .01 numeric minima for top length and widths", () => {
    const dimensions = buildLast(input()).models.foot.design;
    expect(() =>
      buildTop({ ...dimensions, length: nextafter(0.01, 0) }),
    ).toThrow(/length must be finite and between 0.01/);
    expect(() =>
      buildTop({ ...dimensions, medial_heel_width: nextafter(0.01, 0) }),
    ).toThrow(/medial_heel_width must be finite and between 0.01/);
  });
});

describe("virtual hinge and approved allowance budget", () => {
  it("matches known trigonometric cases and an independent inverse across sizes/radii/heights", () => {
    for (const F of [180, 250, 320])
      for (const anchorRatio of [0.4, 0.7, 0.85])
        for (const radiusRatio of [0, 0.05, 0.1])
          for (const fraction of [0, 0.001, 0.25, 0.6, 0.95, 0.9999]) {
            const A = F * anchorRatio,
              r = F * radiusRatio,
              H = fraction * (A + r);
            const result = solvePosture(A, r, H);
            expect(
              Math.abs(
                A * Math.sin(result.angle) +
                  2 * r * Math.sin(result.angle / 2) ** 2 -
                  H,
              ),
            ).toBeLessThan(1e-10);
            expect(result.angle).toBeCloseTo(independentAngle(A, r, H), 10);
            expect(result.allowance).toBe(r * result.angle);
          }
    for (const theta of [1e-30, 1e-12, 0.2, Math.PI / 6, 1.3]) {
      const H = 175 * Math.sin(theta) + 25 * Math.sin(theta / 2) ** 2;
      expect(solvePosture(175, 12.5, H).angle).toBeCloseTo(theta, 12);
      if (theta < 1e-6)
        expect(
          Math.abs(solvePosture(175, 12.5, H).angle / theta - 1),
        ).toBeLessThan(1e-12);
    }
  });

  it("has exact flat and radius-zero cases, rejects the upper domain, and keeps near-bound values finite", () => {
    expect(solvePosture(175, 12.5, 0)).toEqual({ angle: 0, allowance: 0 });
    expect(solvePosture(175, 0, 80)).toEqual({
      angle: Math.asin(80 / 175),
      allowance: 0,
    });
    for (const radius of [0, 12.5]) {
      const result = solvePosture(175, radius, nextafter(175 + radius, 0));
      expect(result.angle).toBeLessThan(Math.PI / 2);
      expect(Number.isFinite(result.angle)).toBe(true);
      for (const height of [175 + radius, 176 + radius, NaN, Infinity, -1])
        expect(() => solvePosture(175, radius, height)).toThrow(InputError);
    }
    expect(() => solvePosture(175, -1, 8)).toThrow(InputError);
    const flat = withPose({
      heel_height: 0,
      toe_spring: 0,
      seat_inclination_deg: 0,
    });
    expect(buildLast(flat).resolved.posture_allowance).toBe(0);
    const disabled = input();
    disabled.design.bend_radius_ratio = 0;
    expect(buildLast(disabled).resolved.posture_allowance).toBe(0);
    expect(() => buildLast(withPose({ heel_height: 0 }))).toThrow(/seat front/);
  });

  it("resolves the legal near-pi/2 hinge while separately enforcing the actual rear angle", () => {
    const value = input();
    value.design.bend_radius_ratio = 0.768148;
    value.pose.heel_height = 367.037;
    const before = structuredClone(value);
    const anchor = value.template.medial_ball.station_ratio * value.foot.length;
    const radius = value.design.bend_radius_ratio * value.foot.length;
    const upper = anchor + radius;
    expect(value.pose.heel_height).toBeLessThan(upper);
    for (const height of [
      value.pose.heel_height,
      nextafter(value.pose.heel_height, 0),
    ]) {
      const legal = structuredClone(value);
      legal.pose.heel_height = height;
      const hinge = solvePosture(anchor, radius, height);
      const angle = hinge.angle;
      const budget = 8 * (ulp(anchor) + ulp(radius) + ulp(height));
      const actualHeight =
        anchor * Math.sin(angle) + 2 * radius * Math.sin(angle / 2) ** 2;
      const independentHeight =
        anchor * Math.sin(angle) + radius * (1 - Math.cos(angle));
      expect(angle).toBeLessThan(Math.PI / 2);
      expect(Math.abs(actualHeight - height)).toBeLessThanOrEqual(budget);
      expect(Math.abs(independentHeight - height)).toBeLessThanOrEqual(budget);
      expect(() => buildLast(legal)).toThrow(/actual rear sole angle/);
      if (height === value.pose.heel_height) {
        expect(angle).toBe(nextafter(Math.PI / 2, 0));
        expect(hinge.allowance).toBe(301.6510142087115);
      }
    }
    for (const height of [upper, nextafter(upper, Infinity), upper + 1]) {
      const invalid = structuredClone(value);
      invalid.pose.heel_height = height;
      expect(() => solvePosture(anchor, radius, height)).toThrow(/0 <= H/);
      expect(() => buildLast(invalid)).toThrow(/0 <= H/);
    }
    expect(value).toEqual(before);
  });

  it("keeps ordinary hinge angles and allowances bit-for-bit unchanged", () => {
    expect(solvePosture(175, 12.5, 8)).toEqual({
      angle: 0.045655713687427074,
      allowance: 0.5706964210928385,
    });
    expect(solvePosture(175, 12.5, 80)).toEqual({
      angle: 0.4662271636923051,
      allowance: 5.827839546153814,
    });
  });

  it("preserves virtual angle and scales allowance under proportional F/W/H resizing", () => {
    const original = input(),
      resized = input();
    resized.foot.length *= 0.75;
    resized.foot.width *= 0.75;
    resized.pose.heel_height *= 0.75;
    resized.pose.toe_spring *= 0.75;
    const a = buildLast(original),
      b = buildLast(resized);
    expect(b.resolved.bend_angle_rad).toBeCloseTo(
      a.resolved.bend_angle_rad,
      13,
    );
    expect(b.resolved.posture_allowance).toBeCloseTo(
      a.resolved.posture_allowance * 0.75,
      12,
    );
    for (const key of [
      "foot_length",
      "foot_width",
      "toe_extension",
      "reference_last_length",
      "bend_station",
      "effective_radius",
      "posed_last_length",
    ] as const)
      expect(b.resolved[key]).toBeCloseTo(a.resolved[key] * 0.75, 10);
    expect(b.inputs.reference).toEqual(original.reference);
  });

  it.each([8, 40, 60, 80])(
    "independently integrates the four final public curves for H=%i",
    (height) => {
      const state = buildLast(withPose({ heel_height: height }));
      const r = state.resolved;
      const lengths = actualGuide(state).map((p) => integrate(p));
      const targets = [
        r.seat_arc_length,
        r.bend_station - r.seat_arc_length + r.posture_allowance,
        r.blend_arc_length,
        r.reference_last_length - r.bend_station - r.blend_arc_length,
      ];
      lengths.forEach((length, i) =>
        expect(Math.abs(length - targets[i]!)).toBeLessThan(0.0001),
      );
      expect(
        Math.abs(lengths.reduce((a, b) => a + b, 0) - r.posed_last_length),
      ).toBeLessThan(0.0001);
      expect(r.contact_s).toBe(r.bend_station + r.posture_allowance);
      expect(r.posed_last_length).toBe(
        r.reference_last_length + r.posture_allowance,
      );
      expect(state.derived.bottom_stations.contact_s).toBe(r.contact_s);
      expect(Math.abs(lengths[0]! + lengths[1]! - r.contact_s)).toBeLessThan(
        0.0001,
      );
      expect(r.ramp_arc_length).toBe(75);
      expect(state.reports.bottom.passed).toBe(true);
    },
  );

  it("rejects real bottom conflicts rather than changing seat angle or borrowing arcs", () => {
    const validHinge = withPose({ heel_height: 180 });
    expect(resolveFootFirst(validHinge).bend_angle_rad).toBeLessThan(
      Math.PI / 2,
    );
    expect(() => buildLast(validHinge)).toThrow(/waist|instep tangent/);
    expect(() => buildLast(withPose({ toe_spring: 85 }))).toThrow(
      /toe_spring|forepart arc\/height conflict/,
    );
    expect(() => buildLast(withPose({ seat_inclination_deg: 89 }))).toThrow(
      /actual rear sole angle/,
    );
  });
});

describe("reference geometry and actual spatial correspondence", () => {
  it("keeps both complete reference models and reports exactly pose-independent", () => {
    const reference = buildLast(input());
    for (const pose of [
      { heel_height: 40 },
      { heel_height: 60 },
      { heel_height: 80 },
      { toe_spring: 15 },
      { seat_inclination_deg: 1 },
    ]) {
      const state = buildLast(withPose(pose));
      expect(state.models.foot).toEqual(reference.models.foot);
      expect(state.models.top).toEqual(reference.models.top);
      expect(state.reports.foot).toEqual(reference.reports.foot);
      expect(state.reports.top).toEqual(reference.reports.top);
      expect(state.inputs.reference).toEqual(reference.inputs.reference);
    }
  });

  it("extends only the last terminal taper, preserving the entire foot and named internal anchors", () => {
    const original = buildLast(input()),
      extended = input();
    extended.design.toe_extension_ratio = 0.2;
    const state = buildLast(extended);
    expect(state.models.foot).toEqual(original.models.foot);
    expect(state.reports.foot).toEqual(original.reports.foot);
    for (const name of STATIONS)
      expect(state.models.top.points[name]).toEqual(
        original.models.top.points[name],
      );
    expect(state.models.top.points.toe_tip!.y).toBe(270);
    expect(state.resolved.bend_angle_rad).toBe(
      original.resolved.bend_angle_rad,
    );
    expect(state.resolved.contact_s).toBe(original.resolved.contact_s);
    expect(state.resolved.ramp_arc_length).toBe(
      original.resolved.ramp_arc_length + 10,
    );
    expect(validateTop(state.models.top, state.models.top.design).passed).toBe(
      true,
    );
    const curves = state.models.top.outline.map((name) =>
      topCurvePoints(state.models.top, name),
    );
    curves.forEach((curve, i) => {
      const next = curves[(i + 1) % curves.length]!;
      expect(curve[3]).toEqual(next[0]);
      expect(curve[3][0] - curve[2][0]).toBeCloseTo(
        next[1][0] - next[0][0],
        10,
      );
      expect(curve[3][1] - curve[2][1]).toBeCloseTo(
        next[1][1] - next[0][1],
        10,
      );
    });
  });

  it("uses only medial ball as contact/hinge anchor; independent widths and working dimensions remain independent", () => {
    const original = buildLast(input());
    const medial = input();
    medial.template.medial_ball.station_ratio = 0.72;
    const m = buildLast(medial);
    expect(m.resolved.bend_station).toBe(180);
    expect(m.resolved.bend_angle_rad).toBeLessThan(
      original.resolved.bend_angle_rad,
    );
    expect(m.resolved.contact_s).not.toBe(original.resolved.contact_s);
    const lateral = input();
    lateral.template.lateral_ball.station_ratio = 0.68;
    const l = buildLast(lateral);
    expect(l.resolved).toEqual(original.resolved);
    expect(l.models.bottom).toEqual(original.models.bottom);
    const wider = input();
    wider.template.lateral_ball.side_extent_ratio = 0.54;
    const w = buildLast(wider);
    expect(w.models.foot.points.lateral_ball!.x).toBe(54);
    expect(w.models.foot.points.medial_ball!.x).toBe(-46);
    expect(w.resolved).toEqual(original.resolved);
    const lengthOnly = input();
    lengthOnly.foot.length = 275;
    const lengthState = buildLast(lengthOnly);
    expect(lengthState.resolved.toe_extension).toBe(10);
    expect(lengthState.models.foot.points.medial_ball!.x).toBe(-46);
    expect(lengthState.models.foot.points.medial_ball!.y).toBe(192.5);
    expect(lengthState.inputs.reference).toEqual(original.inputs.reference);
    const widthOnly = input();
    widthOnly.foot.width = 120;
    const widthState = buildLast(widthOnly);
    expect(widthState.resolved.toe_extension).toBe(12);
    expect(widthState.models.foot.points.medial_ball!.x).toBeCloseTo(-55.2, 12);
    expect(widthState.models.foot.points.medial_ball!.y).toBe(175);
    expect(widthState.resolved.bend_angle_rad).toBe(
      original.resolved.bend_angle_rad,
    );
    expect(widthState.inputs.reference).toEqual(original.inputs.reference);
    expect(widthState.inputs.template).toEqual(original.inputs.template);
  });

  it("has endpoint-preserving monotone C1 reference-to-posed mapping at S and A", () => {
    const resolved = resolveFootFirst(withPose({ heel_height: 80 }));
    const map = (station: number) => referenceToPosed(station, resolved);
    const S = resolved.seat_arc_length,
      A = resolved.bend_station,
      delta = resolved.posture_allowance;
    expect(map(0)).toBe(0);
    expect(map(S)).toBe(S);
    expect(map(A)).toBe(A + delta);
    expect(map(resolved.reference_last_length)).toBe(
      resolved.posed_last_length,
    );
    const eps = 1e-4;
    for (const join of [S, A]) {
      expect((map(join) - map(join - eps)) / eps).toBeCloseTo(1, 5);
      expect((map(join + eps) - map(join)) / eps).toBeCloseTo(1, 5);
    }
    let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const station = (resolved.reference_last_length * i) / 1000;
      const posed = map(station);
      expect(posed).toBeGreaterThan(previous);
      previous = posed;
    }
    for (const station of [
      -1e-12,
      resolved.reference_last_length + 1e-12,
      NaN,
      Infinity,
    ])
      expect(() => map(station)).toThrow(InputError);
  });

  it("places boundary and between-station points at g(s), with independent measured arc and guide membership", () => {
    const state = buildLast(withPose({ heel_height: 80 }));
    const curves = actualGuide(state);
    const evaluate = createStationEvaluator(
      curves,
      state.resolved.posed_last_length,
    );
    const {
      seat_arc_length: S,
      bend_station: A,
      reference_last_length: L,
    } = state.resolved;
    for (const station of [
      0,
      13,
      S - 1e-4,
      S,
      S + 1e-4,
      87.3,
      123,
      A - 1e-4,
      A,
      A + 1e-4,
      190,
      211.2,
      L,
    ]) {
      const posed = referenceToPosed(station, state.resolved);
      const point = evaluate(posed);
      const measured = actualArcAt(curves, point);
      expect(Math.abs(measured.station - posed)).toBeLessThan(0.0001);
      expect(Math.abs(measured.z - point[1])).toBeLessThan(1e-8);
    }
  });

  it.each([8, 80])(
    "places actual whole-last samples on the final guide with unchanged x at H=%i",
    (height) => {
      const state = buildLast(withPose({ heel_height: height }));
      const curves = actualGuide(state);
      for (const [index, curve] of state.display.top.entries()) {
        const original = topCurvePoints(state.models.top, curve.name);
        for (let i = 0; i < curve.points.length; i++) {
          const [x, y, z] = curve.points[i]!,
            [expectedX, reference] = bezier(original, i / 64);
          expect(x).toBe(expectedX);
          const measured = actualArcAt(curves, [y, z]);
          expect(Math.abs(measured.z - z)).toBeLessThan(1e-8);
          expect(
            Math.abs(
              measured.station - referenceToPosed(reference, state.resolved),
            ),
          ).toBeLessThan(0.0001);
        }
        expect(curve.points.at(-1)).toEqual(
          state.display.top[(index + 1) % state.display.top.length]!.points[0],
        );
      }
      const rear = state.models.bottom.points.bottom_heel_rear!,
        toe = state.models.bottom.points.bottom_toe_end!;
      expect(state.display.top[0]!.points[0]).toEqual([0, rear.y, rear.z]);
      expect(
        state.display.top.find((curve) => curve.name.startsWith("toe_tip_to_"))!
          .points[0],
      ).toEqual([0, toe.y, toe.z]);
      for (const name of STATIONS) {
        const entry = state.derived.station_map[name];
        expect(entry.reference_s).toBe(
          state.inputs.template[name].station_ratio * state.inputs.foot.length,
        );
        expect(entry.posed_s).toBe(
          referenceToPosed(entry.reference_s, state.resolved),
        );
        expect(
          Math.abs(
            actualArcAt(curves, [entry.y, entry.z]).station - entry.posed_s,
          ),
        ).toBeLessThan(0.0001);
      }
    },
  );

  it("validates final public geometry, correspondence and resolved numbers, not a transient helper", () => {
    const state = buildLast(input());
    const mutated = structuredClone(state);
    mutated.resolved.waist_arc_length += 1;
    expect(validateFootFirst(mutated, mutated.inputs).passed).toBe(false);
    const movedFoot = structuredClone(state);
    movedFoot.models.foot.points.medial_ball!.y += 1;
    expect(validateFootFirst(movedFoot, movedFoot.inputs).passed).toBe(false);
    const movedTop = structuredClone(state);
    movedTop.models.top.points.medial_ball!.x += 1;
    expect(validateFootFirst(movedTop, movedTop.inputs).passed).toBe(false);
    const movedMap = structuredClone(state);
    movedMap.derived.station_map.medial_ball.posed_s += 1;
    expect(validateFootFirst(movedMap, movedMap.inputs).passed).toBe(false);
    const brokenBottom = structuredClone(state);
    brokenBottom.models.bottom.points.bottom_toe_end!.z += 2;
    expect(validateFootFirst(brokenBottom, brokenBottom.inputs).passed).toBe(
      false,
    );
  });

  it("blocks a failed report from each of the four final validators", () => {
    const state = buildLast(input());
    for (const name of ["foot", "top", "bottom", "contour"] as const) {
      const failed = structuredClone(state);
      failed.reports[name].passed = false;
      const spy = vi
        .spyOn(footFirst, "buildFootFirst")
        .mockReturnValueOnce(failed);
      try {
        expect(() => buildLast(input())).toThrow(GeometryValidationError);
      } finally {
        spy.mockRestore();
      }
    }
  });
});
