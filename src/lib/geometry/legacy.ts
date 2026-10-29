/** Explicit schema-1 reference-test entry, never called by the production router. */
import { type LegacyLastState, type Vec2, type Vec3 } from "./types";
import {
  parseContourInput,
  buildContour,
  createStationEvaluator,
} from "./contour";
import { topCurvePoints } from "./top";
import { bottomCurvePoints } from "./bottom";
import { bezier } from "./math";

export class LegacyGeometryValidationError extends Error {
  constructor(public readonly reports: LegacyLastState["reports"]) {
    super("Resulting geometry failed validation");
    this.name = "LegacyGeometryValidationError";
  }
}

export function buildLegacyLast(input: unknown): LegacyLastState {
  const state = buildContour(parseContourInput(input));
  if (!Object.values(state.reports).every((report) => report.passed))
    throw new LegacyGeometryValidationError(state.reports);
  const curves = state.models.bottom.profile.map((name) =>
    bottomCurvePoints(state.models.bottom, name),
  );
  const atStation = createStationEvaluator(
    curves,
    state.inputs.design.last_length,
  );
  const cache = new Map<number, Vec2>();
  const top = state.models.top.outline.map((name) => ({
    name,
    points: Array.from({ length: 65 }, (_, i): Vec3 => {
      const [x, s] = bezier(topCurvePoints(state.models.top, name), i / 64);
      if (!cache.has(s)) cache.set(s, atStation(s));
      const [y, z] = cache.get(s)!;
      return [x, y, z];
    }),
  }));
  const bottom = state.models.bottom.profile.map((name) => ({
    name,
    points: Array.from({ length: 65 }, (_, i): Vec3 => {
      const [y, z] = bezier(
        bottomCurvePoints(state.models.bottom, name),
        i / 64,
      );
      return [0, y, z];
    }),
  }));
  return { ...state, display: { top, bottom } };
}
