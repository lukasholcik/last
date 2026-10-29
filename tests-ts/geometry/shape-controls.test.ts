import { describe, it, expect } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import {
  buildLast,
  parseFootFirstInput,
  InputError,
  GeometryValidationError,
  type LastState,
  type Cubic,
  type Vec2,
} from "../../src/lib/geometry";
import { bottomCurvePoints } from "../../src/lib/geometry/bottom";
import { createSectionEvaluator } from "../../src/lib/geometry/section";

const input = () => parseFootFirstInput(structuredClone(baseline));
function native(state: LastState, name: string): Cubic {
  const p = state.models.section.boundary.find((p) => p.name === name);
  if (p?.kind !== "cubic") throw new Error("native cubic missing");
  return [...p.points].reverse() as Cubic;
}
function value(p: Cubic, t: number): Vec2 {
  const u = 1 - t;
  return [0, 1].map(
    (a) =>
      u * u * u * p[0][a]! +
      3 * u * u * t * p[1][a]! +
      3 * u * t * t * p[2][a]! +
      t * t * t * p[3][a]!,
  ) as Vec2;
}
function parameter(p: Cubic, y: number) {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 64; i++) {
    const t = (lo + hi) / 2;
    if (value(p, t)[0] < y) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}
function arc(p: Cubic, end = 1) {
  const n = 1024;
  const speed = (t: number) =>
    Math.hypot(
      ...[0, 1].map(
        (a) =>
          3 *
          ((1 - t) ** 2 * (p[1][a]! - p[0][a]!) +
            2 * (1 - t) * t * (p[2][a]! - p[1][a]!) +
            t * t * (p[3][a]! - p[2][a]!)),
      ),
    );
  let s = speed(0) + speed(end);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * speed((end * i) / n);
  return (s * end) / (3 * n);
}
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l];
};

describe("schema4 independent shape controls", () => {
  it("requires all eight controls and explicitly rejects schema3", () => {
    expect(baseline.schema_version).toBe(4);
    expect(() =>
      parseFootFirstInput({ ...baseline, schema_version: 3 }),
    ).toThrow(/schema_version 4/);
    for (const field of [
      "arch_start_reach_ratio",
      "arch_contact_reach_ratio",
    ]) {
      const p = input();
      Reflect.deleteProperty(p.design, field);
      expect(() => parseFootFirstInput(p)).toThrow(InputError);
    }
    for (const field of [
      "heel_leave_outward_deg",
      "heel_bulge_ratio",
      "instep_front_handle_ratio",
      "instep_waist_handle_ratio",
      "instep_front_down_offset_deg",
      "instep_waist_down_offset_deg",
    ]) {
      const p = input();
      Reflect.deleteProperty(p.centre_section, field);
      expect(() => parseFootFirstInput(p)).toThrow(InputError);
    }
    const p = input();
    p.centre_section.heel_bulge_ratio = 0;
    p.centre_section.heel_leave_outward_deg = 0;
    expect(parseFootFirstInput(p).centre_section.heel_bulge_ratio).toBe(0);
    p.centre_section.instep_front_handle_ratio = 0.001;
    p.centre_section.instep_waist_handle_ratio = 0.001;
    expect(buildLast(p).reports.section.passed).toBe(true);
  });
  it.each([8, 80])(
    "changes heel departure and bulge while retaining the sole-relative angle at H%i",
    (H) => {
      const p = input();
      p.pose.heel_height = H;
      p.centre_section.heel_leave_outward_deg = 20;
      p.centre_section.heel_bulge_ratio = 0.035;
      const before = structuredClone(p),
        state = buildLast(p),
        lower = native(state, "rear_cap_lower");
      const seat = bottomCurvePoints(state.models.bottom, "bottom_heel_seat");
      const t = unit([seat[3][0] - seat[0][0], seat[3][1] - seat[0][1]]),
        n: Vec2 = [-t[1], t[0]],
        leave = unit([lower[1][0] - lower[0][0], lower[1][1] - lower[0][1]]);
      const angle =
        (Math.atan2(
          leave[0] * n[0] + leave[1] * n[1],
          leave[0] * t[0] + leave[1] * t[1],
        ) *
          180) /
        Math.PI;
      expect(angle).toBeCloseTo(110, 8);
      const middle = state.models.section.points.heel_middle,
        B0 = state.models.section.points.heel_bottom;
      expect((middle.y - B0.y) * t[0] + (middle.z - B0.z) * t[1]).toBeCloseTo(
        -8.75,
        9,
      );
      expect(
        state.reports.section.checks.find(
          (c) => c.name === "heel_departure_angle_deg",
        )!.actual,
      ).toBeCloseTo(110, 8);
      expect(p).toEqual(before);
      expect(state.inputs.reference).toEqual(before.reference);
    },
  );
  it("emits actual native instep handles with shared waist derivative and ball G1", () => {
    const p = input(),
      state = buildLast(p),
      first = native(state, "roof_front_to_waist"),
      second = native(state, "roof_waist_to_ball");
    const alpha =
      state.resolved.bend_angle_rad +
      (p.pose.seat_inclination_deg * Math.PI) / 180;
    const df: Vec2 = [
      Math.cos(
        alpha + (p.centre_section.instep_front_down_offset_deg * Math.PI) / 180,
      ),
      -Math.sin(
        alpha + (p.centre_section.instep_front_down_offset_deg * Math.PI) / 180,
      ),
    ];
    const waistAngle =
      alpha + (p.centre_section.instep_waist_down_offset_deg * Math.PI) / 180;
    const dw: Vec2 = [Math.cos(waistAngle), -Math.sin(waistAngle)];
    const lf = p.centre_section.instep_front_handle_ratio * p.foot.length,
      lw = p.centre_section.instep_waist_handle_ratio * p.foot.length;
    first[0].forEach((_, a) => {
      expect(first[1][a]! - first[0][a]!).toBeCloseTo(lf * df[a]!, 9);
      expect(first[3][a]! - first[2][a]!).toBeCloseTo(lw * dw[a]!, 9);
      expect(second[1][a]! - second[0][a]!).toBeCloseTo(lw * dw[a]!, 9);
    });
    const evaluator = createSectionEvaluator(state, state.models.section),
      M = p.template.medial_waist.station_ratio * 250,
      a = p.centre_section.top_front_station_ratio * 250;
    const mid = evaluator.roof((a + M) / 2);
    expect(mid[0]).toBeCloseTo(value(first, 0.5)[0], 10);
    expect(mid[1]).toBeCloseTo(value(first, 0.5)[1], 10);
    const end = unit([
        second[3][0] - second[2][0],
        second[3][1] - second[2][1],
      ]),
      fore = unit(evaluator.roofTangent(state.resolved.bend_station));
    expect(Math.hypot(end[0] - fore[0], end[1] - fore[1])).toBeLessThan(1e-8);
    const changed = input();
    Object.assign(changed.centre_section, {
      instep_front_handle_ratio: 0.06,
      instep_waist_handle_ratio: 0.03,
      instep_front_down_offset_deg: 45,
      instep_waist_down_offset_deg: -5,
    });
    const next = buildLast(changed);
    expect(native(next, "roof_front_to_waist")).not.toEqual(first);
    expect(next.models.section.height_curves).toEqual(
      state.models.section.height_curves,
    );
    expect(next.models.bottom).toEqual(state.models.bottom);
    expect(
      next.display.section.find((c) => c.name === "roof_ball_to_toe"),
    ).toEqual(state.display.section.find((c) => c.name === "roof_ball_to_toe"));
  });
  it.each([8, 80])(
    "changes the actual arch but preserves measured regional arcs and station correspondence at H%i",
    (H) => {
      const p = input();
      p.pose.heel_height = H;
      p.design.arch_start_reach_ratio = 0.2;
      p.design.arch_contact_reach_ratio = 0.45;
      const state = buildLast(p),
        curves = state.models.bottom.profile.map((n) =>
          bottomCurvePoints(state.models.bottom, n),
        ),
        waist = curves[1]!,
        span = waist[3][0] - waist[0][0],
        r = state.resolved;
      expect(waist[1][0] - waist[0][0]).toBeCloseTo(0.2 * span, 10);
      expect(waist[3][0] - waist[2][0]).toBeCloseTo(0.45 * span, 10);
      expect(
        (waist[1][1] - waist[0][1]) / (waist[1][0] - waist[0][0]),
      ).toBeCloseTo(
        -Math.tan(
          r.bend_angle_rad + (p.pose.seat_inclination_deg * Math.PI) / 180,
        ),
        9,
      );
      const lengths = curves.map((c) => arc(c));
      const targets = [
        r.seat_arc_length,
        r.waist_arc_length,
        r.blend_arc_length,
        r.ramp_arc_length,
      ];
      lengths.forEach((l, i) =>
        expect(Math.abs(l - targets[i]!)).toBeLessThan(0.001),
      );
      for (const entry of Object.values(state.derived.station_map)) {
        let offset = 0;
        for (let i = 0; i < curves.length; i++) {
          const c = curves[i]!;
          if (entry.y <= c[3][0]) {
            expect(
              Math.abs(offset + arc(c, parameter(c, entry.y)) - entry.posed_s),
            ).toBeLessThan(0.001);
            break;
          }
          offset += lengths[i]!;
        }
      }
      for (const c of state.display.section.filter(
        (c) => !state.models.bottom.profile.includes(c.name),
      ))
        for (const point of c.points.filter((_, i) => i % 8 === 0)) {
          if (point[1] < 0) continue;
          const lower = curves.find((c) => point[1] <= c[3][0] + 1e-8)!;
          expect(
            point[2] - value(lower, parameter(lower, point[1]))[1],
          ).toBeGreaterThanOrEqual(-1e-7);
        }
      const old = structuredClone(p);
      old.design.arch_start_reach_ratio = 1 / 3;
      old.design.arch_contact_reach_ratio = 1 / 3;
      expect(state.models.bottom).not.toEqual(buildLast(old).models.bottom);
      expect(Object.values(state.reports).every((r) => r.passed)).toBe(true);
    },
  );
  it("allows equal inner arch y controls when the fractions sum to one", () => {
    const p = input();
    p.pose.heel_height = 80;
    p.design.arch_start_reach_ratio = 0.5;
    p.design.arch_contact_reach_ratio = 0.5;
    expect(buildLast(p).reports.bottom.passed).toBe(true);
  });
  it("rejects bad arch fractions, backwards instep tangents and folded native handles without clamping", () => {
    for (const [a, b] of [
      [0, 0.3],
      [1, 0.1],
      [0.8, 0.5],
    ]) {
      const p = input();
      p.design.arch_start_reach_ratio = a!;
      p.design.arch_contact_reach_ratio = b!;
      expect(() => buildLast(p)).toThrow(InputError);
    }
    const bad = input();
    bad.centre_section.instep_front_down_offset_deg = 100;
    expect(() => buildLast(bad)).toThrow(/instep tangent must point forward/);
    const fold = input();
    fold.centre_section.instep_front_handle_ratio = 0.8;
    expect(() => buildLast(fold)).toThrow(GeometryValidationError);
  });
  it("builds the prior fitted geometry with explicit schema4 defaults added", () => {
    const p = input();
    p.template.medial_waist.station_ratio = 0.5317500000000001;
    p.template.medial_ball.station_ratio = 0.689;
    p.design.toe_extension_ratio = 0.0475;
    p.design.seat_arc_ratio = 0.26699999999999996;
    Object.assign(p.pose, {
      heel_height: 84.95999999999998,
      toe_spring: 0,
      seat_inclination_deg: -5.625,
    });
    Object.assign(p.centre_section, {
      top_rear_station_ratio: 0.021750000000000002,
      top_front_station_ratio: 0.41900000000000004,
      toe_roof_station_ratio: 0.9659999999999999,
      top_front_height_ratio: 0.322,
      waist_height_ratio: 0.308,
      ball_height_ratio: 0.16750000000000004,
      toe_roof_height_ratio: 0.06565,
    });
    expect(Object.values(buildLast(p).reports).every((r) => r.passed)).toBe(
      true,
    );
  });
});
