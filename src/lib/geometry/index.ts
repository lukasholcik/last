import { GeometryValidationError, type LastState, type Vec3 } from "./types";
import { parseContourInput, buildContour } from "./contour";
import { topCurvePoints } from "./top";
import { bottomCurvePoints } from "./bottom";
import { bezier } from "./math";

export * from "./types";
export { parseContourInput } from "./contour";

/** Pure runtime entry: no transport, filesystem, Python or rendering dependencies. */
export function buildLast(input: unknown): LastState {
  const state = buildContour(parseContourInput(input));
  if (!Object.values(state.reports).every((r) => r.passed))
    throw new GeometryValidationError(state.reports);
  const top = state.models.top.outline.map((name) => ({
    name,
    points: Array.from({ length: 65 }, (_, i): Vec3 => {
      const [x, y] = bezier(topCurvePoints(state.models.top, name), i / 64);
      return [x, y, 0];
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
