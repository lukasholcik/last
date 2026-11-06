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
import {
  CROSS_SECTION_ANCHORS,
  LOCAL_CROSS_SECTION_ANCHORS,
} from "../../src/lib/geometry/section-types";

describe("shared authored cross sections", () => {
  it("uses eight semantic anchors and 64 samples, retaining the original route quarters", () => {
    const sections = resolveCrossSections(buildLast2D(baseline));
    expect(CROSS_SECTION_ANCHORS).toEqual([
      "medial",
      "medial_shoulder",
      "dorsal",
      "lateral_shoulder",
      "lateral",
      "lateral_bottom",
      "plantar",
      "medial_bottom",
    ]);
    for (const section of sections.filter((s) => s.id !== "toe_end")) {
      expect(section.anchors.map((a) => a.id)).toEqual(CROSS_SECTION_ANCHORS);
      expect(section.cubics).toHaveLength(8);
      expect(section.samples).toHaveLength(64);
      expect(section.posedSamples).toHaveLength(64);
      section.anchors.forEach((a, i) =>
        expect(section.samples[i * 8]).toEqual(a.point),
      );
      for (const [id, index] of [
        ["medial", 0],
        ["dorsal", 16],
        ["lateral", 32],
        ["plantar", 48],
      ] as const)
        expect(section.samples[index]).toEqual(
          section.anchors.find((a) => a.id === id)!.point,
        );
    }
  });
  it("authors genuinely flat heel/ball/fore-toe soles and a medial-only midfoot arch", () => {
    const sections = resolveCrossSections(buildLast2D(baseline));
    for (const id of ["heel_width", "ball", "fore_toe"]) {
      const section = sections.find((s) => s.id === id)!;
      for (const start of ["lateral_bottom", "plantar"] as const) {
        const index = section.anchors.findIndex((a) => a.id === start);
        expect(section.cubics[index]!.every((p) => p[1] === 0)).toBe(true);
        for (let i = 0; i <= 16; i++)
          expect(bezier(section.cubics[index]!, i / 16)[1]).toBe(0);
      }
    }
    const mid = sections.find((s) => s.id === "midfoot")!;
    expect(
      mid.anchors.find((a) => a.id === "medial_bottom")!.point[1],
    ).toBeCloseTo(0.15 * mid.height, 10);
    expect(mid.anchors.find((a) => a.id === "lateral_bottom")!.point[1]).toBe(
      0,
    );
    expect(mid.anchors.find((a) => a.id === "plantar")!.point).toEqual([0, 0]);
    expect(
      bezier(
        mid.cubics[mid.anchors.findIndex((a) => a.id === "plantar")]!,
        0.5,
      )[1],
    ).toBeGreaterThan(0);
    expect(
      bezier(
        mid.cubics[mid.anchors.findIndex((a) => a.id === "lateral_bottom")]!,
        0.5,
      )[1],
    ).toBe(0);
  });
  it.each(LOCAL_CROSS_SECTION_ANCHORS)(
    "serializes independent %s point/handles without changing shared models or other sections",
    (anchor) => {
      const initial = buildLast2D(baseline),
        before = resolveCrossSections(initial),
        ball = before.find((s) => s.id === "ball")!,
        point = ball.anchors.find((a) => a.id === anchor)!.point;
      const target: Vec2 = [
        point[0] * 0.9,
        anchor.endsWith("shoulder")
          ? point[1] + 0.02 * ball.height
          : 0.1 * ball.height,
      ];
      const moved = buildLast2D(
        editCrossSection(initial, "ball", { anchor, kind: "point" }, target),
      );
      expect(moved.models).toEqual(initial.models);
      expect(moved.inputs.foot).toEqual(initial.inputs.foot);
      expect(moved.inputs.centre_section).toEqual(
        initial.inputs.centre_section,
      );
      expect(moved.inputs.last_outline).toEqual(initial.inputs.last_outline);
      const section = resolveCrossSections(moved).find((s) => s.id === "ball")!,
        a = section.anchors.find((a) => a.id === anchor)!;
      a.point.forEach((v, i) => expect(v).toBeCloseTo(target[i]!, 8));
      const incoming: Vec2 = a.incoming.map(
        (v, i) => a.point[i]! + 0.7 * (v - a.point[i]!),
      ) as Vec2;
      const first = buildLast2D(
          editCrossSection(
            moved,
            "ball",
            { anchor, kind: "incoming" },
            incoming,
          ),
        ),
        afterFirst = resolveCrossSections(first)
          .find((s) => s.id === "ball")!
          .anchors.find((a) => a.id === anchor)!;
      expect(afterFirst.outgoing).toEqual(a.outgoing);
      const outgoing: Vec2 = afterFirst.outgoing.map(
        (v, i) => a.point[i]! + 0.6 * (v - a.point[i]!),
      ) as Vec2;
      const final = buildLast2D(
          editCrossSection(
            first,
            "ball",
            { anchor, kind: "outgoing" },
            outgoing,
          ),
        ),
        sections = resolveCrossSections(final),
        edited = sections
          .find((s) => s.id === "ball")!
          .anchors.find((a) => a.id === anchor)!;
      expect(edited.incoming).toEqual(afterFirst.incoming);
      edited.outgoing.forEach((v, i) => expect(v).toBeCloseTo(outgoing[i]!, 9));
      expect(
        parseFootFirstInput(JSON.parse(JSON.stringify(final.inputs))),
      ).toEqual(final.inputs);
      expect(final.models).toEqual(initial.models);
      expect(sections.filter((s) => s.id !== "ball")).toEqual(
        before.filter((s) => s.id !== "ball"),
      );
      expect(sections.find((s) => s.id === "ball")!.samples).not.toEqual(
        ball.samples,
      );
    },
  );
  it("allows an independent lower handle to shape an arch between flat corner anchors", () => {
    const initial = buildLast2D(baseline),
      ball = resolveCrossSections(initial).find((s) => s.id === "ball")!,
      corner = ball.anchors.find((a) => a.id === "lateral_bottom")!;
    const next = buildLast2D(
      editCrossSection(
        initial,
        "ball",
        { anchor: "lateral_bottom", kind: "outgoing" },
        [corner.outgoing[0], 0.1 * ball.height],
      ),
    );
    const edited = resolveCrossSections(next).find((s) => s.id === "ball")!,
      index = edited.anchors.findIndex((a) => a.id === "lateral_bottom");
    expect(edited.anchors[index]!.point[1]).toBe(0);
    expect(edited.anchors.find((a) => a.id === "plantar")!.point).toEqual([
      0, 0,
    ]);
    expect(bezier(edited.cubics[index]!, 0.5)[1]).toBeGreaterThan(0);
    expect(next.models).toEqual(initial.models);
  });
  it("rejects unknown, nonfinite, wrong-side and out-of-region local points", () => {
    for (const points of [
      { medial: [-0.5, 0.5] },
      { unknown: [0.5, 0.5] },
      { medial_bottom: [0.5, 0.1] },
      { lateral_bottom: [1.1, 0] },
      { medial_shoulder: [-0.5, NaN] },
      { lateral_shoulder: [0.5, 1.1] },
    ]) {
      expect(() =>
        parseFootFirstInput({
          ...baseline,
          cross_sections: { sections: { ball: { points } } },
        }),
      ).toThrow(InputError);
    }
    for (const points of [
      { medial_shoulder: [-0.6, 0.1] },
      { lateral_bottom: [0.7, 0.9] },
      { medial_shoulder: [-0.6, 0.5] },
      { lateral_bottom: [0.7, 0.5] },
    ])
      expect(() =>
        buildLast2D({
          ...baseline,
          cross_sections: { sections: { ball: { points } } },
        }),
      ).toThrow(InputError);
    const g = buildLast2D(baseline);
    expect(() =>
      editCrossSection(
        g,
        "ball",
        { anchor: "medial_bottom", kind: "point" },
        [1, 0],
      ),
    ).toThrow(InputError);
    expect(() =>
      editCrossSection(g, "ball", { anchor: "plantar", kind: "point" }, [0, 1]),
    ).toThrow(InputError);
  });
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
    expect(ball.anchors.find((a) => a.id === "medial")!.point[0]).toBeCloseTo(
      m.x,
      6,
    );
    expect(ball.anchors.find((a) => a.id === "lateral")!.point[0]).toBeCloseTo(
      l.x,
      6,
    );
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
      p = ball.anchors.find((a) => a.id === "medial")!.point;
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
    const initial = buildLast2D(baseline),
      mid = resolveCrossSections(initial).find((s) => s.id === "midfoot")!,
      corner = mid.anchors.find((a) => a.id === "medial_bottom")!;
    const g = buildLast2D(
        editCrossSection(
          initial,
          "midfoot",
          { anchor: "medial_bottom", kind: "point" },
          [corner.point[0] * 0.95, mid.height * 0.2],
        ),
      ),
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
        expect(lower).toEqual(env.pose(s, 0, 0, env.height(s)));
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
  it("agrees with independent numerical integration of the authored waist curves", () => {
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
    // Explicit independent reference: 29/32 mm half-widths, 55 mm depth,
    // medial arch corner 8.25 mm high. No production evaluator or sampler.
    const curves: Vec2[][] = [
      [
        [-29, 27.5],
        [-29, 37.95],
        [-22.91, 40.04],
        [-18.85, 48.4],
      ],
      [
        [-18.85, 48.4],
        [-11.31, 51.04],
        [-7.54, 55],
        [0, 55],
      ],
      [
        [0, 55],
        [8.32, 55],
        [12.48, 51.04],
        [20.8, 48.4],
      ],
      [
        [20.8, 48.4],
        [25.28, 40.04],
        [32, 37.95],
        [32, 27.5],
      ],
      [
        [32, 27.5],
        [32, 13.75],
        [28.128, 0],
        [24.96, 0],
      ],
      [
        [24.96, 0],
        [16.64, 0],
        [8.32, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [-7.54, 0],
        [-15.08, 8.25],
        [-22.62, 8.25],
      ],
      [
        [-22.62, 8.25],
        [-25.491, 8.25],
        [-29, 17.875],
        [-29, 27.5],
      ],
    ];
    const steps = 512;
    const expected = curves.reduce((total, p) => {
      const speed = (t: number) =>
        Math.hypot(
          ...[0, 1].map(
            (k) =>
              3 *
              ((1 - t) ** 2 * (p[1]![k]! - p[0]![k]!) +
                2 * (1 - t) * t * (p[2]![k]! - p[1]![k]!) +
                t * t * (p[3]![k]! - p[2]![k]!)),
          ),
        );
      let sum = speed(0) + speed(1);
      for (let i = 1; i < steps; i++)
        sum += (i % 2 === 0 ? 2 : 4) * speed(i / steps);
      return total + sum / (3 * steps);
    }, 0);
    // The diagnostic deliberately retains its cheap 64-chord route sampling.
    expect(Math.abs(computed - expected)).toBeLessThan(0.25);
  });
});
