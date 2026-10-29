import { type LastState, type Vec2, type Vec3 } from "./types";
import { createStationEvaluator } from "./contour";
import { referenceToPosed } from "./foot-first";
import { topCurvePoints } from "./top";
import { bottomCurvePoints } from "./bottom";
import { bezier } from "./math";
import { buildLast2D } from "./two-dimensional";
import { resolveCrossSections } from "./cross-sections";
import { buildLastSurface, evaluateHeelWraps } from "./last-surface";

export * from "./types";
export { parseFootFirstInput } from "./foot-first";
export { buildLast2D, previewLast2D } from "./two-dimensional";
export * from "./section-types";
export {
  resolveCrossSections,
  editCrossSection,
  editCrossSectionFrame,
  splitMidfoot,
} from "./cross-sections";

/** Pure runtime entry: no transport, filesystem, Python or rendering dependencies. */
export function buildLast(input: unknown): LastState {
  const state = buildLast2D(input);
  const curves = state.models.bottom.profile.map((name) =>
    bottomCurvePoints(state.models.bottom, name),
  );
  const atStation = createStationEvaluator(
    curves,
    state.resolved.posed_last_length,
  );
  const cache = new Map<number, Vec2>();
  const top = state.models.top.outline.map((name) => ({
    name,
    points: Array.from({ length: 65 }, (_, i): Vec3 => {
      const [x, s] = bezier(topCurvePoints(state.models.top, name), i / 64);
      if (!cache.has(s))
        cache.set(s, atStation(referenceToPosed(s, state.resolved)));
      const [y, z] = cache.get(s)!;
      return [x, y, z];
    }),
  }));
  const crossSections = resolveCrossSections(state);
  return {
    ...state,
    display: {
      top,
      bottom: state.display.bottom,
      section: state.display.section,
      crossSections,
      surface: buildLastSurface(state, crossSections),
      heelWraps: evaluateHeelWraps(state, crossSections),
    },
  };
}
