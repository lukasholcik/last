import {
  GeometryValidationError,
  type BaseLastState,
  type Last2DGeometry,
  type Last2DState,
  type SectionModel,
  type Vec3,
} from "./types";
import { parseFootFirstInput, buildFootFirst } from "./foot-first";
import { bottomCurvePoints } from "./bottom";
import { bezier } from "./math";
import {
  buildSection,
  validateSection,
  sampleSection,
  sectionNotEvaluated,
} from "./section";
import { resolveCrossSections } from "./cross-sections";

export type { Last2DGeometry, Last2DState } from "./types";

type BaseGeometry = Pick<
  BaseLastState,
  "inputs" | "models" | "resolved" | "derived"
>;
function planarGeometry(
  base: BaseGeometry,
  section: SectionModel,
): Last2DGeometry {
  const bottom = base.models.bottom.profile.map((name) => ({
    name,
    points: Array.from({ length: 65 }, (_, i): Vec3 => {
      const [y, z] = bezier(
        bottomCurvePoints(base.models.bottom, name),
        i / 64,
      );
      return [0, y, z];
    }),
  }));
  return {
    inputs: base.inputs,
    models: { ...base.models, section },
    resolved: base.resolved,
    derived: base.derived,
    display: { bottom, section: sampleSection(base, section, bottom) },
  };
}

/** Construct actual dependent planar geometry without claiming validation or rebuilding 3D. */
export function previewLast2D(input: unknown): Last2DGeometry {
  const base = buildFootFirst(parseFootFirstInput(input));
  const geometry = planarGeometry(base, buildSection(base));
  resolveCrossSections(geometry);
  return geometry;
}

/** Validate the complete current 2D geometry; no 3D outline sampling or HTTP calls. */
export function buildLast2D(input: unknown): Last2DState {
  const base = buildFootFirst(parseFootFirstInput(input));
  if (!Object.values(base.reports).every((report) => report.passed))
    throw new GeometryValidationError({
      ...base.reports,
      section: sectionNotEvaluated(),
    });
  const section = buildSection(base),
    report = validateSection(base, section);
  const reports = { ...base.reports, section: report };
  if (!report.passed) throw new GeometryValidationError(reports);
  const geometry = planarGeometry(base, section);
  resolveCrossSections(geometry);
  return { ...geometry, reports };
}
