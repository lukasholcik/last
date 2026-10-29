import { describe, expect, it, vi } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import {
  buildLast,
  buildLast2D,
  previewLast2D,
  parseFootFirstInput,
  InputError,
} from "../../src/lib/geometry";
import {
  createCrossSectionEnvelope,
  editCrossSection,
  editCrossSectionFrame,
  resolveCrossSections,
  splitMidfoot,
} from "../../src/lib/geometry/cross-sections";
import { createLastSurfaceEvaluator } from "../../src/lib/geometry/last-surface";
import type { FootFirstInput, Vec2 } from "../../src/lib/geometry/types";
import * as crossSections from "../../src/lib/geometry/cross-sections";
import { resolveSectionFrame } from "../../src/lib/geometry/section-frame";
import { bezier } from "../../src/lib/geometry/math";

describe("shared authored cross sections", () => {
  it("continuously follows both descending rear caps without endpoint bands", () => {
    const g = buildLast2D(baseline),
      envelope = createCrossSectionEnvelope(g),
      rear = resolveSectionFrame(g),
      H = envelope.height(0);
    for (const name of ["rear_cap_lower", "rear_cap_upper"]) {
      const piece = g.models.section.boundary.find((p) => p.name === name);
      if (piece?.kind !== "cubic") throw new Error("missing rear cap");
      expect(rear.local(piece.points[0])[1]).toBeGreaterThan(
        rear.local(piece.points[3])[1],
      );
      for (const t of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
        const expected = bezier(piece.points, t),
          depth = rear.local(expected)[1],
          actual = envelope.pose(0, 0, depth, H);
        expect(actual[1]).toBeCloseTo(expected[0], 6);
        expect(actual[2]).toBeCloseTo(expected[1], 6);
      }
    }
    const before = envelope.pose(0, 0, H * (0.5 - 1e-6), H),
      after = envelope.pose(0, 0, H * (0.5 + 1e-6), H);
    expect(Math.hypot(...after.map((v, i) => v - before[i]!))).toBeLessThan(
      0.001,
    );
    // The correction remains a transverse/local-depth transport, not a fold.
    for (const s of [0, 5, 15, 30]) {
      let previous = -Infinity;
      for (let i = 0; i <= 32; i++) {
        const p = envelope.pose(s, 0, (H * i) / 32, H),
          depth = rear.local([p[1], p[2]])[1];
        expect(depth).toBeGreaterThan(previous);
        previous = depth;
      }
    }
  });
  it("resolves the complete default section family on preview and acceptance without an authored branch", () => {
    expect(baseline).not.toHaveProperty("cross_sections");
    const resolve = vi.spyOn(crossSections, "resolveCrossSections");
    try {
      const preview = previewLast2D(baseline),
        accepted = buildLast2D(baseline);
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(resolve).toHaveBeenNthCalledWith(1, preview);
      expect(resolve.mock.calls[1]![0].models).toEqual(accepted.models);
      expect(preview.display).not.toHaveProperty("surface");
      expect(accepted.display).not.toHaveProperty("surface");
    } finally {
      resolve.mockRestore();
    }
  });
  it("reports an off-axis toe termination whose envelope no longer contains the shared x=0 seam", () => {
    const input = parseFootFirstInput(baseline);
    input.last_outline = {
      anchors: { toe_tip: { station_offset_ratio: 0, side_offset_ratio: 0.2 } },
      handles: {},
    };
    const planar = buildLast2D(input);
    expect(planar.models.top.points.toe_tip!.x).toBe(20);
    expect(() => buildLast(input)).toThrow(
      "Section frame must cross both sides of the last exactly around its centre seam",
    );
  });
  it("independently transports a flat-pose oblique frame and local coordinates", () => {
    const input = structuredClone(baseline);
    input.pose = { heel_height: 0, toe_spring: 0, seat_inclination_deg: 0 };
    const g = buildLast2D(input),
      ball = resolveCrossSections(g).find((s) => s.id === "ball")!;
    const slope = (165 - 175) / (48 - -46),
      magnitude = Math.hypot(1, slope);
    expect(ball.frame.transverse[0]).toBeCloseTo(1 / magnitude, 7);
    expect(ball.frame.transverse[1]).toBeCloseTo(slope / magnitude, 7);
    expect(ball.frame.transverse[2]).toBeCloseTo(0, 7);
    const piece = g.models.section.boundary.find(
      (p) => p.name === "roof_waist_to_ball",
    );
    if (piece?.kind !== "cubic") throw new Error("missing native roof");
    const t = 1 - (ball.referenceStation - 100) / 75;
    const y = piece.points.reduce(
      (sum, p, i) =>
        sum +
        p[0] *
          [
            Math.pow(1 - t, 3),
            3 * Math.pow(1 - t, 2) * t,
            3 * (1 - t) * t * t,
            t * t * t,
          ][i]!,
      0,
    );
    const z = piece.points.reduce(
      (sum, p, i) =>
        sum +
        p[1] *
          [
            Math.pow(1 - t, 3),
            3 * Math.pow(1 - t, 2) * t,
            3 * (1 - t) * t * t,
            t * t * t,
          ][i]!,
      0,
    );
    expect(ball.frame.up[1]).toBeCloseTo(
      (y - ball.referenceStation) / Math.hypot(y - ball.referenceStation, z),
      7,
    );
    expect(ball.frame.up[2]).toBeCloseTo(
      z / Math.hypot(y - ball.referenceStation, z),
      7,
    );
    for (let i = 0; i < ball.samples.length; i++) {
      expect(ball.posedSamples[i]![0]).toBeCloseTo(ball.samples[i]![0], 7);
    }
  });
  it("derives five labelled sections, preserving independent oblique ball landmarks", () => {
    const g = buildLast2D(baseline),
      before = structuredClone(g),
      sections = resolveCrossSections(g),
      ball = sections.find((s) => s.id === "ball")!;
    expect(sections.map((s) => s.id)).toEqual([
      "heel_width",
      "midfoot",
      "ball",
      "fore_toe",
      "toe_end",
    ]);
    const m = g.models.top.points.medial_ball!,
      l = g.models.top.points.lateral_ball!;
    expect(ball.anchors[0]!.point[0]).toBeCloseTo(m.x, 6);
    expect(ball.anchors[2]!.point[0]).toBeCloseTo(l.x, 6);
    const slope = (l.y - m.y) / (l.x - m.x);
    expect(ball.referenceStation + slope * m.x).toBeCloseTo(m.y, 7);
    expect(ball.referenceStation + slope * l.x).toBeCloseTo(l.y, 7);
    expect(Math.hypot(...ball.frame.transverse)).toBeCloseTo(1, 10);
    expect(ball.frame.transverse[0]).toBeGreaterThan(0);
    expect(g).toEqual(before);
    expect(g.display).not.toHaveProperty("surface");
  });
  it("updates shared last width and profile height, not foot observations or ball stations", () => {
    const g = buildLast2D(baseline),
      ball = resolveCrossSections(g).find((s) => s.id === "ball")!,
      p = ball.anchors[0]!.point;
    const edited = editCrossSection(
        g,
        "ball",
        { anchor: "medial", kind: "point" },
        [p[0] - 2, p[1]],
      ),
      next = buildLast2D(edited);
    expect(next.models.top.points.medial_ball!.x).toBeCloseTo(p[0] - 2, 7);
    expect(next.models.top.points.medial_ball!.y).toBe(
      g.models.top.points.medial_ball!.y,
    );
    expect(next.models.top.points.lateral_ball!.y).toBe(
      g.models.top.points.lateral_ball!.y,
    );
    expect(next.models.foot).toEqual(g.models.foot);
    expect(edited.template).toEqual(g.inputs.template);
    const height = editCrossSection(
      next,
      "ball",
      { anchor: "dorsal", kind: "point" },
      [0, ball.height + 1],
    );
    expect(height.centre_section.ball_height_ratio).toBeGreaterThan(
      next.inputs.centre_section.ball_height_ratio,
    );
    expect(buildLast2D(height).models.section).not.toEqual(next.models.section);
    expect(() =>
      editCrossSection(g, "ball", { anchor: "medial", kind: "point" }, [1, 10]),
    ).toThrow(InputError);
  });
  it("retains optional schema-4 branches, rejects malformed IDs, and validates incompatible handle edits", () => {
    const input = parseFootFirstInput(baseline);
    input.last_outline = { anchors: {}, handles: {} };
    input.section_handles = {};
    input.cross_sections = { sections: { ball: { tilt_deg: 3 } } };
    expect(parseFootFirstInput(input)).toEqual(input);
    expect(() =>
      parseFootFirstInput({
        ...input,
        cross_sections: { sections: { unknown: {} } },
      }),
    ).toThrow(InputError);
    const g = buildLast2D(baseline),
      bad = editCrossSection(
        g,
        "ball",
        { anchor: "medial", kind: "outgoing" },
        [1000, 1000],
      );
    expect(() => previewLast2D(bad)).toThrow(InputError);
    expect(() => editCrossSectionFrame(g, "ball", { tiltDeg: 31 })).toThrow(
      InputError,
    );
    expect(() =>
      previewLast2D(
        editCrossSectionFrame(g, "midfoot", {
          stationOffsetRatio: 0.2,
          tiltDeg: 30,
        }),
      ),
    ).toThrow(InputError);
  });
  it("splits at the current shape with zero jump, retaining accumulated refinements", () => {
    const g = buildLast2D(baseline),
      m = resolveCrossSections(g).find((s) => s.id === "midfoot")!;
    const split = buildLast2D(splitMidfoot(g)),
      sections = resolveCrossSections(split);
    expect(sections.map((s) => s.id)).toEqual([
      "heel_width",
      "waist",
      "instep",
      "ball",
      "fore_toe",
      "toe_end",
    ]);
    for (const id of ["waist", "instep"])
      expect(sections.find((s) => s.id === id)!.posedSamples).toEqual(
        m.posedSamples,
      );
  });
  it.each([8, 80])(
    "builds a finite closed indexed surface and frozen markers at heel height %i",
    (H) => {
      const input = structuredClone(baseline);
      input.pose.heel_height = H;
      const state = buildLast(input),
        mesh = state.display.surface!,
        count = mesh.positions.length / 3;
      expect(mesh.positions.every(Number.isFinite)).toBe(true);
      expect(
        mesh.indices.every((i) => Number.isInteger(i) && i >= 0 && i < count),
      ).toBe(true);
      const edges = new Map<string, number>();
      for (let i = 0; i < mesh.indices.length; i += 3)
        for (let k = 0; k < 3; k++) {
          const a = mesh.indices[i + k]!,
            b = mesh.indices[i + ((k + 1) % 3)]!,
            key = [Math.min(a, b), Math.max(a, b)].join(":");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      expect([...edges.values()].every((n) => n === 2)).toBe(true);
      expect(state.display.heelWraps!.map((p) => p.status)).toEqual([
        "unconfigured",
        "unconfigured",
      ]);
      const env = createCrossSectionEnvelope(state),
        at = createLastSurfaceEvaluator(state);
      for (const u of [0.2, 0.5, 0.8]) {
        const s = u * state.resolved.reference_last_length,
          roof = env.roof(s),
          upper = at(u, 0.25),
          lower = at(u, 0.75);
        expect(upper[0]).toBeCloseTo(0, 7);
        expect(upper[1]).toBeCloseTo(roof[0], 6);
        expect(upper[2]).toBeCloseTo(roof[1], 6);
        expect(lower[0]).toBeCloseTo(0, 7);
      }
      for (const section of state.display.crossSections!.filter(
        (s) => s.cubics.length,
      ))
        for (let j = 0; j < 64; j++) {
          const sample = at(
              section.referenceStation / state.resolved.reference_last_length,
              j / 64,
            ),
            expected = section.posedSamples[j]!;
          sample.forEach((v, k) => expect(v).toBeCloseTo(expected[k]!, 5));
        }
    },
  );
  it("evaluates separately declared on-surface routes with honest target and foot deltas", () => {
    const input: FootFirstInput = parseFootFirstInput(baseline),
      route: Vec2[] = [
        [0.2, 0],
        [0.2, 0.5],
        [0.2, 1],
      ];
    input.cross_sections = {
      heel_wraps: {
        short_heel: {
          protocol: "Authored prototype loop",
          route,
          target_mm: 200,
          foot: { value_mm: 210, conditions: "Synthetic test only" },
        },
        long_heel: {
          protocol: "Different declared route",
          route: [
            [0.1, 0],
            [0.4, 0.5],
            [0.1, 1],
          ],
        },
      },
    };
    const state = buildLast(input),
      [short, long] = state.display.heelWraps!;
    expect(short!.computed_mm).toBeGreaterThan(0);
    expect(short!.target_delta_mm).toBeCloseTo(short!.computed_mm! - 200, 9);
    expect(short!.foot_delta_mm).toBeCloseTo(short!.computed_mm! - 210, 9);
    expect(long!.computed_mm).not.toBe(short!.computed_mm);
    expect(long).not.toHaveProperty("target_mm");
    expect(long).not.toHaveProperty("foot");
    expect(state.inputs.foot).toEqual(input.foot);
  });
  it("agrees with an independent rounded-ellipse perimeter estimate in a flat waist case", () => {
    const input = parseFootFirstInput(baseline);
    input.pose = { heel_height: 0, toe_spring: 0, seat_inclination_deg: 0 };
    const u = 100 / 260;
    input.cross_sections = {
      heel_wraps: {
        short_heel: {
          protocol: "Explicit synthetic waist-route test, not a heel protocol",
          route: [
            [u, 0],
            [u, 0.5],
            [u, 1],
          ],
        },
      },
    };
    const computed = buildLast(input).display.heelWraps![0]!.computed_mm!;
    // Two half ellipses, horizontal radii 29/32 and vertical radius 55/2.
    // Ramanujan approximation is independent of our cubic/path sampler.
    const ellipse = (a: number, b: number) =>
      Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const expected = (ellipse(29, 27.5) + ellipse(32, 27.5)) / 2;
    expect(Math.abs(computed - expected)).toBeLessThan(0.15);
  });
});
