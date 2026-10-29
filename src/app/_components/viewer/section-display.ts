import type {
  SampledCurve,
  SectionPoint,
  Vec2,
  Vec3,
} from "~/lib/geometry/types";
import { fmt } from "./state";

/** Section samples already contain the lower guide. Draw that shared edge only once. */
export function upperSectionCurves(
  section: readonly SampledCurve[],
  bottom: readonly SampledCurve[],
) {
  const lowerNames = new Set(bottom.map((curve) => curve.name));
  return section.filter((curve) => !lowerNames.has(curve.name));
}

/** Only projects ordered server samples into SVG coordinates; no curve reconstruction. */
export function sampledPath(
  curves: readonly SampledCurve[],
  project: (point: Vec3) => [number, number],
  closed = false,
) {
  const points = curves.flatMap((curve) => curve.points);
  if (!points.length) return "";
  return (
    points
      .map((point, i) => `${i === 0 ? "M" : "L"} ${project(point).join(" ")}`)
      .join(" ") + (closed ? " Z" : "")
  );
}

export function sectionPointLabel(name: string, point: SectionPoint) {
  return `section: ${name} · reference s_ref ${fmt(point.reference_s)} mm · posed y ${fmt(point.y)} mm, z ${fmt(point.z)} mm · vertical offset from reference guide ${fmt(point.height)} mm · ${point.kind}`;
}

export function sectionNativeCurveKind(name: string) {
  return name === "roof_front_to_waist" || name === "roof_waist_to_ball"
    ? "instep Bézier"
    : "cap";
}

export function sectionNativeHandleLabel(
  name: string,
  control: 1 | 2,
  [y, z]: Vec2,
) {
  return `section: ${name}.control${control} · native posed ${sectionNativeCurveKind(name)} handle · y ${fmt(y)} mm, z ${fmt(z)} mm · derived construction, not editable`;
}
