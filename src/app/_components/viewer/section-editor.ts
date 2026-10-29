import type { Last2DGeometry, Vec2 } from "~/lib/geometry/types";
import type {
  CrossSectionId,
  ResolvedCrossSection,
} from "~/lib/geometry/section-types";

/** Top stays in reference x/s, never in the posed frame's world y. */
export function referenceSectionLine(
  g: Last2DGeometry,
  section: ResolvedCrossSection,
): [Vec2, Vec2] {
  if (section.id === "toe_end")
    return [
      [section.samples[0]![0], section.referenceStation],
      [section.samples[0]![0], section.referenceStation],
    ];
  const region =
    section.id === "heel_width"
      ? "heel"
      : section.id === "ball"
        ? "ball"
        : section.id === "fore_toe"
          ? "toe"
          : "waist";
  const m = g.models.top.points[`medial_${region}`]!,
    l = g.models.top.points[`lateral_${region}`]!;
  const tilt = g.inputs.cross_sections?.sections?.[section.id]?.tilt_deg ?? 0;
  const slope = (l.y - m.y) / (l.x - m.x) + Math.tan((tilt * Math.PI) / 180);
  return [section.anchors[0]!.point, section.anchors[2]!.point].map(
    ([x]) => [x, section.referenceStation + slope * x] as Vec2,
  ) as [Vec2, Vec2];
}

export const sectionName = (id: CrossSectionId) => id.replaceAll("_", " ");
