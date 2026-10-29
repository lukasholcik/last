import { describe, it, expect } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import {
  buildLast,
  buildLast2D,
  parseFootFirstInput,
  InputError,
  GeometryValidationError,
  type Last2DGeometry,
  type Cubic,
} from "../../src/lib/geometry";
import {
  getLastAnchor,
  getLastHandle,
  TOP_ANCHORS,
} from "../../src/lib/geometry/last-outline";
import {
  getShapeHandles,
  getFootReferenceHandles,
  moveShapeHandle,
  resetLastOutlinePoint,
  rebaseLastOutline,
} from "../../src/lib/shaping";

const initial = () => buildLast2D(baseline);
function native(s: Last2DGeometry, name: string): Cubic {
  const p = s.models.section.boundary.find((p) => p.name === name);
  if (p?.kind !== "cubic") throw new Error("native curve missing");
  return p.points;
}
function sameLast(a: Last2DGeometry, b: Last2DGeometry) {
  expect(a.models.top.outline).toEqual(b.models.top.outline);
  for (const id of TOP_ANCHORS) {
    const p = getLastAnchor(a.models.top, id),
      q = getLastAnchor(b.models.top, id);
    expect(p.x).toBeCloseTo(q.x, 9);
    expect(p.y).toBeCloseTo(q.y, 9);
    for (const d of ["incoming", "outgoing"] as const) {
      const p = getLastHandle(a.models.top, id, d),
        q = getLastHandle(b.models.top, id, d);
      expect(p.x).toBeCloseTo(q.x, 9);
      expect(p.y).toBeCloseTo(q.y, 9);
    }
  }
}
describe("independent last and split Bézier handles", () => {
  it("preserves absent-extension defaults and exposes mode/reset metadata without mode side effects", () => {
    const s = initial(),
      before = structuredClone(s),
      empty = buildLast2D({
        ...baseline,
        last_outline: { anchors: {}, handles: {} },
        section_handles: {},
      });
    expect(s.inputs).not.toHaveProperty("last_outline");
    expect(s.inputs).not.toHaveProperty("section_handles");
    expect(empty.models).toEqual(s.models);
    expect(empty.reports).toEqual(s.reports);
    expect(empty.display).toEqual(s.display);
    for (const mode of ["foot", "last", "foot", "last"]) {
      const h = getShapeHandles(s).filter((h) => h.editTarget === mode);
      expect(h).toHaveLength(mode === "foot" ? 8 : 30);
    }
    expect(getShapeHandles(s).filter((h) => h.resetToFoot)).toHaveLength(10);
    expect(
      getFootReferenceHandles(s).every(
        (h) => h.id.startsWith("foot:") && h.editTarget === "foot",
      ),
    ).toBe(true);
    expect(s).toEqual(before);
  });
  it("edits a last anchor without changing foot/template/observations or the foot bend anchor", () => {
    const s = initial(),
      p = moveShapeHandle(s, s.inputs, "top:medial_ball", [183, -49]),
      next = buildLast2D(p.input);
    expect(next.models.top.points.medial_ball).toMatchObject({
      x: -49,
      y: 183,
    });
    expect(next.models.foot).toEqual(s.models.foot);
    expect(next.reports.foot).toEqual(s.reports.foot);
    expect(next.inputs.template).toEqual(s.inputs.template);
    expect(next.inputs.foot).toEqual(s.inputs.foot);
    expect(next.inputs.reference).toEqual(s.inputs.reference);
    expect(next.resolved).toEqual(s.resolved);
    expect(next.resolved.bend_station).toBe(175);
    const free = moveShapeHandle(s, s.inputs, "top:medial_waist", [105, 2]);
    // Both waist landmarks on the same side cannot span the shared centre seam.
    // Reject the incompatible release rather than accepting an unusable section.
    expect(() => buildLast2D(free.input)).toThrow(InputError);
    expect(s.models.foot).toEqual(next.models.foot);
  });
  it("moves only one outgoing handle with independently calculated F/W vectors", () => {
    const s = initial(),
      anchor = getLastAnchor(s.models.top, "medial_ball"),
      p = moveShapeHandle(s, s.inputs, "top:medial_ball:out", [
        anchor.y - 20,
        anchor.x - 2,
      ]),
      next = buildLast2D(p.input);
    expect(p.input.last_outline?.handles.medial_ball?.outgoing).toEqual({
      forward_ratio: -20 / 250,
      side_ratio: -2 / 100,
    });
    expect(
      getLastHandle(next.models.top, "medial_ball", "outgoing"),
    ).toMatchObject({ x: anchor.x - 2, y: anchor.y - 20 });
    expect(getLastHandle(next.models.top, "medial_ball", "incoming")).toEqual(
      getLastHandle(s.models.top, "medial_ball", "incoming"),
    );
    expect(getLastHandle(next.models.top, "lateral_ball", "outgoing")).toEqual(
      getLastHandle(s.models.top, "lateral_ball", "outgoing"),
    );
    expect(next.models.foot).toEqual(s.models.foot);
  });
  it("carries existing manual vectors rigidly with their last anchor during cumulative 2D edits", () => {
    const s = initial(),
      first = moveShapeHandle(s, s.inputs, "top:medial_ball:out", [155, -48]),
      accepted = buildLast2D(first.input),
      moved = moveShapeHandle(
        accepted,
        accepted.inputs,
        "top:medial_ball",
        [183, -49],
      ),
      next = buildLast2D(moved.input);
    expect(moved.input.last_outline?.handles).toEqual(
      first.input.last_outline?.handles,
    );
    const a = getLastAnchor(next.models.top, "medial_ball"),
      h = getLastHandle(next.models.top, "medial_ball", "outgoing");
    expect(h.y - a.y).toBeCloseTo(-20, 10);
    expect(h.x - a.x).toBeCloseTo(-2, 10);
    expect(
      getShapeHandles(next).find((h) => h.id === "top:medial_ball:out")
        ?.position,
    ).toEqual([h.y, h.x]);
  });
  it("accepts a pointed asymmetric toe cusp and uses edited last curves in the explicit 3D result", () => {
    const p = parseFootFirstInput(baseline);
    p.last_outline = {
      anchors: {
        toe_tip: { station_offset_ratio: 0, side_offset_ratio: 0.02 },
      },
      handles: {
        toe_tip: {
          incoming: { forward_ratio: -0.04, side_ratio: 0.06 },
          outgoing: { forward_ratio: -0.04, side_ratio: -0.06 },
        },
      },
    };
    const s = buildLast(p),
      tip = getLastAnchor(s.models.top, "toe_tip");
    expect(tip).toMatchObject({ x: 2, y: 260 });
    expect(getLastHandle(s.models.top, "toe_tip", "incoming")).toMatchObject({
      x: 8,
      y: 250,
    });
    expect(getLastHandle(s.models.top, "toe_tip", "outgoing")).toMatchObject({
      x: -4,
      y: 250,
    });
    expect(s.models.foot.points.toe_tip).toMatchObject({ x: 0, y: 250 });
    expect(s.reports.top.passed).toBe(true);
    expect(
      s.display.top
        .find((c) => c.name.endsWith("to_toe_tip"))
        ?.points.at(-1)?.[0],
    ).toBe(2);
    p.last_outline.handles.toe_tip = {
      incoming: { forward_ratio: 0, side_ratio: 0 },
      outgoing: { forward_ratio: 0, side_ratio: 0 },
    };
    expect(buildLast2D(p).reports.top.passed).toBe(true);
  });
  it("resets only one point and its two handles to foot, including zero extension for toe reset", () => {
    const s = initial(),
      a = moveShapeHandle(s, s.inputs, "top:medial_ball", [183, -49]),
      b = buildLast2D(a.input),
      h = moveShapeHandle(b, b.inputs, "top:medial_ball:out", [163, -50]),
      c = buildLast2D(h.input),
      other = moveShapeHandle(c, c.inputs, "top:lateral_toe", [225, 34]);
    const reset = resetLastOutlinePoint(other.input, "medial_ball"),
      r = buildLast2D(reset);
    expect(reset.last_outline?.anchors.medial_ball).toBeUndefined();
    expect(reset.last_outline?.handles.medial_ball).toBeUndefined();
    expect(r.models.top.points.medial_ball).toEqual(
      r.models.foot.points.medial_ball,
    );
    expect(reset.last_outline?.anchors.lateral_toe).toEqual(
      other.input.last_outline?.anchors.lateral_toe,
    );
    const tip = moveShapeHandle(r, r.inputs, "top:last-toe", [270, 3]),
      toeReset = resetLastOutlinePoint(tip.input, "toe_tip"),
      final = buildLast2D(toeReset);
    expect(toeReset.design.toe_extension_ratio).toBe(0);
    expect(final.models.top.points.toe_tip).toEqual(
      final.models.foot.points.toe_tip,
    );
    expect(toeReset.template).toEqual(s.inputs.template);
    expect(toeReset.last_outline?.anchors.lateral_toe).toEqual(
      reset.last_outline?.anchors.lateral_toe,
    );
  });
  it.each([8, 80])(
    "keeps independent waist in/out vectors in the declared local frame at H%i",
    (H) => {
      const s = initial(),
        piece = native(s, "roof_front_to_waist"),
        anchor = piece[0],
        F = 250,
        a = s.inputs.centre_section.top_front_station_ratio * F,
        M = s.inputs.template.medial_waist.station_ratio * F,
        A = s.resolved.bend_station,
        q = (M - a) / (A - a),
        alpha =
          s.resolved.bend_angle_rad +
          (s.inputs.pose.seat_inclination_deg * Math.PI) / 180,
        beta = alpha * (1 - q * q * (3 - 2 * q));
      const target: [number, number] = [
        piece[1][0] + 0.5 * Math.sin(beta),
        piece[1][1] + 0.5 * Math.cos(beta),
      ];
      const changed = moveShapeHandle(
          s,
          s.inputs,
          "side:bezier:roof_front_to_waist:1",
          target,
        ),
        v = changed.input.section_handles?.roof_front_to_waist?.control1;
      expect(v?.tangent_ratio).toBeCloseTo(
        ((target[0] - anchor[0]) * Math.cos(beta) -
          (target[1] - anchor[1]) * Math.sin(beta)) /
          F,
        12,
      );
      const p = structuredClone(changed.input);
      p.pose.heel_height = H;
      const next = buildLast2D(p),
        point = native(next, "roof_front_to_waist")[1],
        origin = native(next, "roof_front_to_waist")[0];
      const nextAlpha =
          next.resolved.bend_angle_rad +
          (p.pose.seat_inclination_deg * Math.PI) / 180,
        nextBeta = nextAlpha * (1 - q * q * (3 - 2 * q));
      expect(
        (point[0] - origin[0]) * Math.cos(nextBeta) -
          (point[1] - origin[1]) * Math.sin(nextBeta),
      ).toBeCloseTo((v?.tangent_ratio ?? 0) * F, 9);
      expect(
        (point[0] - origin[0]) * Math.sin(nextBeta) +
          (point[1] - origin[1]) * Math.cos(nextBeta),
      ).toBeCloseTo((v?.normal_ratio ?? 0) * F, 9);
      expect(next.inputs.section_handles?.roof_waist_to_ball).toBeUndefined();
      expect(
        next.reports.section.checks.find(
          (c) => c.name === "instep_shared_waist_C1",
        ),
      ).toBeUndefined();
      if (H === 8)
        expect(native(next, "roof_waist_to_ball")).toEqual(
          native(s, "roof_waist_to_ball"),
        );
    },
  );
  it("reports a manually authored heel departure rather than the automatic beta field", () => {
    const p = parseFootFirstInput(baseline);
    p.section_handles = {
      rear_cap_lower: {
        control2: { tangent_ratio: -0.02, normal_ratio: 0.06 },
      },
    };
    const s = buildLast2D(p),
      check = s.reports.section.checks.find(
        (c) => c.name === "heel_departure_angle_deg",
      );
    expect(check?.actual).toBeCloseTo(
      (Math.atan2(0.06, -0.02) * 180) / Math.PI,
      8,
    );
    expect(check?.expected).toBeCloseTo(check?.actual ?? 0, 8);
    expect(s.inputs.centre_section.heel_leave_outward_deg).toBe(
      baseline.centre_section.heel_leave_outward_deg,
    );
  });
  it("strictly parses optional IDs/vectors and rejects actual last crossings", () => {
    for (const extension of [
      {
        last_outline: {
          anchors: {
            unknown: { station_offset_ratio: 0, side_offset_ratio: 0 },
          },
          handles: {},
        },
      },
      {
        last_outline: {
          anchors: {
            toe_tip: { station_offset_ratio: 0.1, side_offset_ratio: 0 },
          },
          handles: {},
        },
      },
      {
        last_outline: {
          anchors: {},
          handles: {
            toe_tip: { incoming: { forward_ratio: 0, side_ratio: Infinity } },
          },
        },
      },
      {
        last_outline: {
          anchors: {},
          handles: {
            toe_tip: {
              incoming: { forward_ratio: 0, side_ratio: 0, extra: 1 },
            },
          },
        },
      },
      {
        section_handles: {
          roof_ball_to_toe: { control1: { tangent_ratio: 0, normal_ratio: 0 } },
        },
      },
      {
        section_handles: {
          toe_cap: { control3: { tangent_ratio: 0, normal_ratio: 0 } },
        },
      },
      {
        section_handles: {
          toe_cap: { control1: { tangent_ratio: "0", normal_ratio: 0 } },
        },
      },
    ])
      expect(() => parseFootFirstInput({ ...baseline, ...extension })).toThrow(
        InputError,
      );
    const p = parseFootFirstInput(baseline);
    p.last_outline = {
      anchors: {},
      handles: {
        medial_ball: { outgoing: { forward_ratio: -0.08, side_ratio: 3 } },
      },
    };
    expect(() => buildLast2D(p)).toThrow(GeometryValidationError);
  });
  it("edits Foot explicitly while rebasing a shaped Last in millimetres, never on mode switch", () => {
    const generated = initial(),
      changedFoot = moveShapeHandle(
        generated,
        generated.inputs,
        "foot:lateral_ball",
        [168, 49],
      );
    const rebasedDefault = buildLast2D(changedFoot.input);
    sameLast(rebasedDefault, generated);
    const numeric = structuredClone(generated.inputs);
    numeric.template.lateral_waist.side_extent_ratio = 0.34;
    const numericInput = rebaseLastOutline(generated, numeric),
      numericResult = buildLast2D(numericInput);
    sameLast(numericResult, generated);
    expect(numericResult.models.foot.points.lateral_waist?.x).toBe(34);
    expect(rebasedDefault.models.foot.points.lateral_ball).toMatchObject({
      x: 49,
      y: 168,
    });
    const s = initial(),
      first = moveShapeHandle(s, s.inputs, "top:medial_ball", [183, -49]),
      shaped = buildLast2D(first.input),
      manual = moveShapeHandle(
        shaped,
        shaped.inputs,
        "top:medial_ball:out",
        [163, -50],
      ),
      accepted = buildLast2D(manual.input),
      before = structuredClone(accepted);
    const footEdit = moveShapeHandle(
        accepted,
        accepted.inputs,
        "foot:medial_ball",
        [180, -50],
      ),
      next = buildLast2D(footEdit.input);
    expect(next.models.foot.points.medial_ball).toMatchObject({
      y: 180,
      x: -50,
    });
    expect(next.resolved.bend_station).toBe(180);
    sameLast(next, accepted);
    expect(next.inputs.last_outline?.handles.medial_ball?.outgoing).toEqual(
      accepted.inputs.last_outline?.handles.medial_ball?.outgoing,
    );
    expect(next.inputs.foot).toEqual(accepted.inputs.foot);
    expect(next.inputs.reference).toEqual(accepted.inputs.reference);
    expect(accepted).toEqual(before);
    for (const mode of ["last", "foot", "last"]) {
      getShapeHandles(next).filter((h) => h.editTarget === mode);
    }
    sameLast(next, accepted);
  });
});
