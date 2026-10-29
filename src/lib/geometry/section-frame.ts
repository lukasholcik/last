import {
  InputError,
  type BaseLastState,
  type LastState,
  type SectionPointName,
  type Cubic,
  type Vec2,
  type NativeSectionCurveId,
} from "./types";

type FrameSource = Pick<BaseLastState, "inputs" | "models" | "resolved">;
export type { NativeSectionCurveId } from "./types";
export type BottomGuidePointId =
  | "bottom_heel_rear"
  | "bottom_heel_seat_handle_start"
  | "bottom_seat_front"
  | "bottom_forepart_contact"
  | "bottom_waist_handle_start"
  | "bottom_waist_handle_end"
  | "bottom_forepart_blend_end"
  | "bottom_toe_end";

export function getBottomGuidePoint(
  state: Pick<BaseLastState, "models">,
  id: BottomGuidePointId,
) {
  const point = state.models.bottom.points[id];
  if (!point)
    throw new InputError(`Accepted bottom guide point is unavailable: ${id}`);
  return point;
}
export function getSectionLandmark(
  state: Pick<LastState, "models">,
  id: SectionPointName,
) {
  return state.models.section.points[id];
}
export function getSectionNativeCurve(
  state: Pick<LastState, "models">,
  id: NativeSectionCurveId,
): Cubic {
  const piece = state.models.section.boundary.find(
    (piece) => piece.name === id,
  );
  if (piece?.kind !== "cubic")
    throw new InputError(`Accepted native section curve is unavailable: ${id}`);
  return piece.points;
}

/** Shared rear pose coordinates; resolution only, with no construction or solver. */
export function resolveSectionFrame(base: FrameSource) {
  const angle =
    base.resolved.bend_angle_rad +
    (base.inputs.pose.seat_inclination_deg * Math.PI) / 180;
  const t: Vec2 = [Math.cos(angle), -Math.sin(angle)],
    n: Vec2 = [Math.sin(angle), Math.cos(angle)];
  const point = getBottomGuidePoint(base, "bottom_heel_rear"),
    origin: Vec2 = [point.y, point.z];
  return {
    angle,
    t,
    n,
    origin,
    point: (u: number, v: number): Vec2 => [
      origin[0] + u * t[0] + v * n[0],
      origin[1] + u * t[1] + v * n[1],
    ],
    local: (p: Vec2): Vec2 => {
      const y = p[0] - origin[0],
        z = p[1] - origin[1];
      return [y * t[0] + z * t[1], y * n[0] + z * n[1]];
    },
  };
}
/** Local frame at the actual OWN endpoint of a serialized native control. */
export function sectionControlFrame(
  state: FrameSource & Pick<LastState, "models">,
  id: NativeSectionCurveId,
  control: 1 | 2,
) {
  const p = getSectionNativeCurve(state, id),
    anchor: Vec2 = [...p[control === 1 ? 0 : 3]];
  const rear = resolveSectionFrame(state);
  let angle = 0;
  if (id === "rear_cap_lower" || id === "rear_cap_upper") angle = rear.angle;
  else if (id === "roof_front_to_waist" && control === 2) angle = rear.angle;
  else if (
    (id === "roof_front_to_waist" && control === 1) ||
    (id === "roof_waist_to_ball" && control === 2)
  ) {
    const F = state.inputs.foot.length,
      a = state.inputs.centre_section.top_front_station_ratio * F,
      M = state.inputs.template.medial_waist.station_ratio * F,
      A = state.resolved.bend_station,
      q = (M - a) / (A - a);
    angle = rear.angle * (1 - q * q * (3 - 2 * q));
  }
  return {
    anchor,
    angle,
    t: [Math.cos(angle), -Math.sin(angle)] as Vec2,
    n: [Math.sin(angle), Math.cos(angle)] as Vec2,
  };
}
