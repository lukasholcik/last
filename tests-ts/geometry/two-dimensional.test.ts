import { describe, it, expect, vi } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import {
  buildLast,
  type Last2DGeometry,
  GeometryValidationError,
  InputError,
} from "../../src/lib/geometry";
import {
  previewLast2D,
  buildLast2D,
} from "../../src/lib/geometry/two-dimensional";
import * as section from "../../src/lib/geometry/section";
import { getShapeHandles, moveShapeHandle } from "../../src/lib/shaping";

describe("actual editable 2D entry", () => {
  it.each([8, 80])(
    "shares actual planar geometry and all five checks with Rebuild at H%i, without top samples",
    (H) => {
      const input = structuredClone(baseline);
      input.pose.heel_height = H;
      const before = structuredClone(input),
        preview = previewLast2D(input),
        accepted = buildLast2D(input),
        full = buildLast(input);
      expect(input).toEqual(before);
      expect(preview).not.toHaveProperty("reports");
      expect(preview.display).not.toHaveProperty("top");
      expect(accepted.display).not.toHaveProperty("top");
      expect(Object.keys(preview.display)).toEqual(["bottom", "section"]);
      expect(preview.models).toEqual(full.models);
      expect(accepted.models).toEqual(full.models);
      expect(accepted.reports).toEqual(full.reports);
      expect(accepted.display.bottom).toEqual(full.display.bottom);
      expect(accepted.display.section).toEqual(full.display.section);
      expect(Object.values(accepted.reports).every((r) => r.passed)).toBe(true);
      expect(full.display.top).toHaveLength(10);
    },
  );
  it("posture edits change the actual dependent bottom/section, not either reference outline", () => {
    const input = structuredClone(baseline),
      original = buildLast2D(input);
    input.pose.heel_height = 80;
    const next = previewLast2D(input);
    expect(next.models.bottom).not.toEqual(original.models.bottom);
    expect(next.models.section).not.toEqual(original.models.section);
    expect(next.models.foot).toEqual(original.models.foot);
    expect(next.models.top).toEqual(original.models.top);
    expect(next.inputs.reference).toEqual(original.inputs.reference);
  });
  it("preview makes no section-validation claim; release rejects an actually folded section", () => {
    const input = structuredClone(baseline);
    input.centre_section.instep_front_handle_ratio = 0.8;
    const spy = vi.spyOn(section, "validateSection");
    const candidate = previewLast2D(input);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(candidate).not.toHaveProperty("reports");
    expect(() => buildLast2D(input)).toThrow(GeometryValidationError);
    const bad = structuredClone(baseline);
    bad.pose.seat_inclination_deg = 90;
    expect(() => previewLast2D(bad)).toThrow(InputError);
  });
  it("refreshes handles after each validated edit so independent angle/reach edits accumulate without 3D rebuild", () => {
    const initial = buildLast2D(baseline),
      before = structuredClone(initial);
    const handle = (s: Last2DGeometry, id: string) => {
      const h = getShapeHandles(s).find((h) => h.id === id);
      if (!h) throw new Error("missing handle");
      return h;
    };
    const front = handle(initial, "side:bezier:roof_front_to_waist:2");
    if (!front.anchor) throw new Error("missing tangent origin");
    const alpha =
      initial.resolved.bend_angle_rad +
      (initial.inputs.pose.seat_inclination_deg * Math.PI) / 180;
    const desired = alpha + (45 * Math.PI) / 180,
      reach = 12;
    const first = moveShapeHandle(initial, initial.inputs, front.id, [
      front.anchor[0] + reach * Math.cos(desired),
      front.anchor[1] - reach * Math.sin(desired),
    ]);
    const firstPreview = previewLast2D(first.input),
      accepted = buildLast2D(first.input);
    expect(firstPreview.display.section).toEqual(accepted.display.section);
    const updated = handle(accepted, "side:bezier:roof_front_to_waist:2");
    if (!updated.anchor) throw new Error("missing tangent origin");
    const dy = updated.position[0] - updated.anchor[0],
      dz = updated.position[1] - updated.anchor[1];
    expect(Math.hypot(dy, dz)).toBeCloseTo(12, 9);
    expect(
      (Math.atan2(-dz, dy) * 180) / Math.PI - (alpha * 180) / Math.PI,
    ).toBeCloseTo(45, 9);
    const origin = accepted.models.bottom.points.bottom_heel_rear;
    if (!origin) throw new Error("missing heel");
    const h =
      accepted.inputs.centre_section.top_front_height_ratio *
      accepted.inputs.foot.length;
    const second = moveShapeHandle(
      accepted,
      accepted.inputs,
      "side:heel-bulge",
      [
        origin.y - 7.5 * Math.cos(alpha) + 0.5 * h * Math.sin(alpha),
        origin.z + 7.5 * Math.sin(alpha) + 0.5 * h * Math.cos(alpha),
      ],
    );
    const final = buildLast2D(second.input),
      middle = final.models.section.points.heel_middle;
    expect(
      (middle.y - origin.y) * Math.cos(alpha) -
        (middle.z - origin.z) * Math.sin(alpha),
    ).toBeCloseTo(-7.5, 9);
    expect(
      final.inputs.section_handles?.roof_front_to_waist?.control2
        ?.tangent_ratio,
    ).toBeCloseTo((12 * Math.cos(Math.PI / 4)) / 250, 12);
    expect(
      final.inputs.section_handles?.roof_front_to_waist?.control2?.normal_ratio,
    ).toBeCloseTo((-12 * Math.sin(Math.PI / 4)) / 250, 12);
    expect(final.inputs.centre_section.heel_bulge_ratio).toBeCloseTo(0.03, 12);
    expect(final.display).not.toHaveProperty("top");
    expect(initial).toEqual(before);
  });
});
