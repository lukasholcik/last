import { describe, it, expect } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import {
  buildLast,
  parseFootFirstInput,
  type FootFirstInput,
  type LastState,
  type Vec2,
} from "../../src/lib/geometry";
import { getShapeHandles, moveShapeHandle } from "../../src/lib/shaping";

const accepted = (H = 8) => {
  const p = parseFootFirstInput(structuredClone(baseline));
  p.pose.heel_height = H;
  if (H === 0)
    Object.assign(p.pose, { seat_inclination_deg: 0, toe_spring: 0 });
  return buildLast(p);
};
const normal = accepted(),
  high = accepted(80),
  flat = accepted(0);
function handle(state: LastState, id: string) {
  const actual =
    id === "side:instep-front"
      ? "side:bezier:roof_front_to_waist:2"
      : id === "side:instep-waist"
        ? "side:bezier:roof_waist_to_ball:2"
        : id;
  const found = getShapeHandles(state).find((h) => h.id === actual);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}
function frame(state: LastState, u: number, v: number): Vec2 {
  const a =
      state.resolved.bend_angle_rad +
      (state.inputs.pose.seat_inclination_deg * Math.PI) / 180,
    B = state.models.bottom.points.bottom_heel_rear!;
  return [
    B.y + u * Math.cos(a) + v * Math.sin(a),
    B.z - u * Math.sin(a) + v * Math.cos(a),
  ];
}
const move = (state: LastState, id: string, p: Vec2) =>
  moveShapeHandle(state, state.inputs, id, p);

describe("pure direct-shaping semantics", () => {
  it("publishes real accepted guides with independent returned coordinate arrays", () => {
    const before = structuredClone(normal),
      handles = getShapeHandles(normal);
    expect(new Set(handles.map((h) => h.id)).size).toBe(57);
    expect(handles.filter((h) => h.editTarget === "last")).toHaveLength(30);
    expect(handles.filter((h) => h.editTarget === "foot")).toHaveLength(8);
    const front = handle(normal, "side:instep-front"),
      piece = normal.models.section.boundary.find(
        (p) => p.name === "roof_front_to_waist",
      );
    if (piece?.kind !== "cubic") throw new Error("native curve missing");
    expect(front.position).toEqual(piece.points[2]);
    expect(front.anchor).toEqual(piece.points[3]);
    handles[0]!.position[0] += 100;
    front.anchor![1] += 100;
    expect(normal).toEqual(before);
  });
  it("clones input and edits only the selected LAST landmark, never the FOOT definition", () => {
    const before = structuredClone(normal.inputs),
      stateBefore = structuredClone(normal);
    const result = move(normal, "top:medial_ball", [180, -50]);
    const expected = structuredClone(before);
    expected.last_outline = {
      anchors: {
        medial_ball: { station_offset_ratio: 0.02, side_offset_ratio: -0.04 },
      },
      handles: {},
    };
    expect(result.input).toEqual(expected);
    expect(result.input).not.toBe(normal.inputs);
    expect(normal.inputs).toEqual(before);
    expect(normal).toEqual(stateBefore);
    expect(result.feedback).toContain("Only this last anchor");
    const rebuilt = buildLast(result.input);
    expect(rebuilt.models.top.points.medial_ball).toMatchObject({
      y: 180,
      x: -50,
    });
    expect(rebuilt.models.foot).toEqual(normal.models.foot);
    expect(result.input.template).toEqual(before.template);
  });
  it("maps lateral side extents without changing medial landmarks or foot width basis", () => {
    const { input } = move(normal, "top:lateral_toe", [225, 34]);
    expect(input.last_outline?.anchors.lateral_toe?.station_offset_ratio).toBe(
      0.02,
    );
    expect(input.last_outline?.anchors.lateral_toe?.side_offset_ratio).toBe(
      0.03,
    );
    expect(input.template.medial_toe).toEqual(
      normal.inputs.template.medial_toe,
    );
    expect(input.foot).toEqual(normal.inputs.foot);
    expect(input.reference).toEqual(normal.inputs.reference);
    const constrained = move(normal, "top:medial_toe", [220, 40]);
    expect(
      -33 +
        (constrained.input.last_outline?.anchors.medial_toe
          ?.side_offset_ratio ?? 0) *
          100,
    ).toBeCloseTo(40, 10);
    expect(constrained.input.template).toEqual(normal.inputs.template);
    expect(() => buildLast(constrained.input)).toThrow(); // Last is free; invalid crossings reject rather than resnap to FOOT.
  });
  it.each([8, 80])(
    "converts heel departure in the accepted local frame at heel %i",
    (H) => {
      const state = H === 8 ? normal : high,
        beta = (20 * Math.PI) / 180;
      const target = frame(state, -30 * Math.sin(beta), 30 * Math.cos(beta));
      const { input, feedback } = move(state, "side:heel-departure", target);
      expect(input.centre_section.heel_leave_outward_deg).toBeCloseTo(20, 10);
      expect(input.centre_section.heel_bulge_ratio).toBe(
        state.inputs.centre_section.heel_bulge_ratio,
      );
      expect(feedback).toContain("fixed 0.20h");
      expect(buildLast(input).reports.section.passed).toBe(true);
    },
  );
  it("projects the middle guide onto outward bulge only and preserves its fixed height", () => {
    const result = move(high, "side:heel-bulge", frame(high, -8, 999));
    expect(result.input.centre_section.heel_bulge_ratio).toBeCloseTo(
      8 / 250,
      12,
    );
    const expected = structuredClone(high.inputs);
    expected.centre_section.heel_bulge_ratio =
      result.input.centre_section.heel_bulge_ratio;
    expect(result.input).toEqual(expected);
    expect(result.feedback).toContain("middle height remains");
  });
  it("edits either cut endpoint using local station and ONE shared depth", () => {
    const rear = move(high, "side:cut-rear", frame(high, 12, 78));
    expect(rear.input.centre_section.top_rear_station_ratio).toBeCloseTo(
      12 / 250,
      12,
    );
    expect(rear.input.centre_section.top_front_height_ratio).toBeCloseTo(
      78 / 250,
      12,
    );
    expect(rear.input.centre_section.top_front_station_ratio).toBe(
      high.inputs.centre_section.top_front_station_ratio,
    );
    const front = move(high, "side:cut-front", frame(high, 72, 78));
    expect(front.input.centre_section.top_front_station_ratio).toBeCloseTo(
      72 / 250,
      12,
    );
    expect(front.input.centre_section.top_front_height_ratio).toBeCloseTo(
      78 / 250,
      12,
    );
  });
  it("maps front and shared waist handle reach/world angle into the existing relative controls", () => {
    const a =
      normal.resolved.bend_angle_rad +
      (normal.inputs.pose.seat_inclination_deg * Math.PI) / 180;
    for (const [role, reach, offset] of [
      ["front", 12, 45],
      ["waist", 8, 0],
    ] as const) {
      const id = `side:instep-${role}`,
        anchor = handle(normal, id).anchor!;
      const target: Vec2 = [
        anchor[0] + reach * Math.cos(a + (offset * Math.PI) / 180),
        anchor[1] - reach * Math.sin(a + (offset * Math.PI) / 180),
      ];
      const result = move(normal, id, target);
      expect(
        result.input.centre_section[`instep_${role}_handle_ratio`],
      ).toBeCloseTo(reach / 250, 12);
      expect(
        result.input.centre_section[`instep_${role}_down_offset_deg`],
      ).toBeCloseTo(offset, 10);
      expect(result.input.reference).toEqual(normal.inputs.reference);
    }
  });
  it("projects arch controls to endpoint tangents and respects the unchanged other reach", () => {
    const start = normal.models.bottom.points.bottom_seat_front!,
      end = normal.models.bottom.points.bottom_forepart_contact!,
      span = end.y - start.y;
    const moved = move(normal, "side:arch-start", [start.y + 0.25 * span, 999]);
    expect(moved.input.design.arch_start_reach_ratio).toBeCloseTo(0.25, 12);
    expect(moved.input.design.arch_contact_reach_ratio).toBe(
      normal.inputs.design.arch_contact_reach_ratio,
    );
    const rebuilt = buildLast(moved.input),
      p = rebuilt.models.bottom.points;
    const delta = p.bottom_forepart_contact!.y - p.bottom_seat_front!.y;
    expect(p.bottom_waist_handle_start!.y - p.bottom_seat_front!.y).toBeCloseTo(
      0.25 * delta,
      8,
    );
    const contact = move(normal, "side:arch-contact", [
      end.y - 0.2 * span,
      999,
    ]);
    expect(contact.input.design.arch_contact_reach_ratio).toBeCloseTo(0.2, 12);
    const limited = move(normal, "side:arch-start", [10000, 0]);
    expect(
      limited.input.design.arch_start_reach_ratio +
        limited.input.design.arch_contact_reach_ratio,
    ).toBeLessThanOrEqual(1);
    expect(limited.feedback).toContain("constrained");
  });
  it("sets seat OFFSET from the requested actual angle, not a zero-is-flat fiction", () => {
    const B = high.models.bottom.points.bottom_heel_rear!,
      angle = (20 * Math.PI) / 180;
    const result = move(high, "side:seat-angle", [
      B.y + 10 * Math.cos(angle),
      B.z - 10 * Math.sin(angle),
    ]);
    expect(result.input.pose.seat_inclination_deg).toBeCloseTo(
      20 - (high.resolved.bend_angle_rad * 180) / Math.PI,
      10,
    );
    expect(result.input.pose.seat_inclination_deg).toBeLessThan(0);
    expect(
      buildLast(result.input).models.bottom.dimensions.seat_inclination_deg!
        .expected,
    ).toBeCloseTo(20, 10);
    const flatResult = move(flat, "side:seat-angle", [10, 0]);
    expect(flatResult.input.pose.seat_inclination_deg).toBe(0);
  });
  it("inverts toe station on the actual ramp with F-based depth, and extension with W", () => {
    const p = high.models.section.points.toe_roof,
      ramp = high.models.bottom.points;
    const a = ramp.bottom_forepart_blend_end!,
      b = ramp.bottom_toe_end!,
      norm = Math.hypot(b.y - a.y, b.z - a.z),
      uy = (b.y - a.y) / norm,
      uz = (b.z - a.z) / norm;
    const target: Vec2 = [p.y + 2 * uy, p.z + 2 * uz + 1];
    const result = move(high, "side:toe-roof", target);
    expect(result.input.centre_section.toe_roof_station_ratio).toBeCloseTo(
      (p.reference_s + 2) / 250,
      10,
    );
    expect(result.input.centre_section.toe_roof_height_ratio).toBeCloseTo(
      (high.inputs.centre_section.toe_roof_height_ratio * 250 + 1) / 250,
      10,
    );
    const actual = buildLast(result.input).models.section.points.toe_roof;
    expect(actual.y).toBeCloseTo(target[0], 6);
    expect(actual.z).toBeCloseTo(target[1], 6);
    const extension = move(high, "top:last-toe", [270, 999]);
    expect(extension.input.design.toe_extension_ratio).toBe(0.2);
    expect(extension.input.foot).toEqual(high.inputs.foot);
  });
  it("inverts waist/ball heights on their existing blend guides rather than world z/F", () => {
    for (const role of ["waist", "ball"] as const) {
      const h = handle(high, `side:${role}-roof`),
        v: Vec2 = [h.position[0] - h.anchor![0], h.position[1] - h.anchor![1]],
        length = Math.hypot(...v);
      const target: Vec2 = [
        h.position[0] + (2 * v[0]) / length,
        h.position[1] + (2 * v[1]) / length,
      ];
      const result = move(high, h.id, target);
      expect(result.input.centre_section[`${role}_height_ratio`]).toBeCloseTo(
        high.inputs.centre_section[`${role}_height_ratio`] + 2 / 250,
        10,
      );
      const expected = structuredClone(high.inputs);
      expected.centre_section[`${role}_height_ratio`] =
        result.input.centre_section[`${role}_height_ratio`];
      expect(result.input).toEqual(expected);
    }
  });
  it("fails clearly for unknown handles, nonfinite targets, zero tangent vectors and stale dimensions", () => {
    expect(() => move(normal, "side:not-real", [0, 0])).toThrow(
      /Unknown shape handle/,
    );
    expect(() => move(normal, "top:not-real", [0, 0])).toThrow(
      /Unknown shape handle/,
    );
    expect(() => move(normal, "side:cut-front", [NaN, 1])).toThrow(/finite/);
    expect(() =>
      move(
        normal,
        "side:instep-front",
        handle(normal, "side:instep-front").anchor!,
      ),
    ).toThrow(/away from the anchor/);
    const stale: FootFirstInput = structuredClone(normal.inputs);
    stale.foot.length = 260;
    expect(() =>
      moveShapeHandle(normal, stale, "top:medial_ball", [180, -50]),
    ).toThrow(/Rebuild changed physical dimensions/);
    const bounded = move(normal, "side:heel-bulge", [
      Number.MAX_VALUE,
      Number.MAX_VALUE,
    ]);
    expect(Number.isFinite(bounded.input.centre_section.heel_bulge_ratio)).toBe(
      true,
    );
    expect(bounded.feedback).toContain("constrained");
  });
});
