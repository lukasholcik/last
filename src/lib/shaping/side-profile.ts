import type {
  FootFirstInput,
  Last2DGeometry,
  Vec2,
  SectionPointName,
} from "../geometry/types";
import { nextafter } from "../geometry/math";
import {
  resolveSectionFrame as frame,
  getSectionNativeCurve as curve,
  getSectionLandmark,
  getBottomGuidePoint,
  type BottomGuidePointId,
  sectionControlFrame,
} from "../geometry/section-frame";
import { NATIVE_SECTION_CURVES } from "../geometry/section-handles";
import type { ShapeHandle, SideShapeHandleId } from "./types";

// Stay a few floating-point steps inside the strict limit after rad/deg conversion.
const MAX_ANGLE = 90 - 8 * Number.EPSILON * 90;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const degrees = (v: number) => (v * 180) / Math.PI;
function landmark(state: Last2DGeometry, name: SectionPointName): Vec2 {
  const p = getSectionLandmark(state, name);
  return [p.y, p.z];
}
function bottomPoint(state: Last2DGeometry, name: BottomGuidePointId): Vec2 {
  const p = getBottomGuidePoint(state, name);
  return [p.y, p.z];
}
function depthDirection(state: Last2DGeometry, role: "waist" | "ball"): Vec2 {
  if (role === "ball") return [0, 1];
  const F = state.inputs.foot.length,
    a = state.inputs.centre_section.top_front_station_ratio * F;
  const M = state.inputs.template.medial_waist.station_ratio * F,
    A = state.resolved.bend_station,
    q = (M - a) / (A - a);
  const beta = frame(state).angle * (1 - q * q * (3 - 2 * q));
  return [Math.sin(beta), Math.cos(beta)];
}
function fraction(mm: number, F: number, min = 0.01) {
  let r = clamp(mm, min, 10000) / F;
  if (r * F > 10000) r = nextafter(r, 0);
  return r;
}
function nonzero(v: Vec2) {
  if (Math.hypot(...v) < 1e-12)
    throw new Error("Drag away from the anchor to choose a tangent angle.");
}

export function getSideHandles(state: Last2DGeometry): ShapeHandle[] {
  const rear = curve(state, "rear_cap_lower"),
    front = curve(state, "roof_front_to_waist"),
    waist = curve(state, "roof_waist_to_ball");
  const handles: ShapeHandle[] = [
    {
      id: "side:heel-departure",
      label: "Heel outward departure · angle only, fixed reach",
      plane: "side",
      position: [...rear[2]],
      anchor: [...rear[3]],
      kind: "tangent",
    },
    {
      id: "side:heel-bulge",
      label: "Heel middle · outward bulge only",
      plane: "side",
      position: landmark(state, "heel_middle"),
      kind: "point",
    },
    {
      id: "side:cut-rear",
      label: "Top cut rear · local station and shared depth",
      plane: "side",
      position: landmark(state, "cut_rear"),
      kind: "point",
    },
    {
      id: "side:cut-front",
      label: "Top cut front · local station and shared depth",
      plane: "side",
      position: landmark(state, "cut_front"),
      kind: "point",
    },
    {
      id: "side:instep-front",
      label: "Instep front · reach and relative down angle",
      plane: "side",
      position: [...front[2]],
      anchor: [...front[3]],
      kind: "tangent",
    },
    {
      id: "side:instep-waist",
      label: "Instep waist · one shared tangent/reach",
      plane: "side",
      position: [...waist[2]],
      anchor: [...waist[3]],
      kind: "tangent",
    },
    {
      id: "side:arch-start",
      label: "Arch start reach · projected to seat tangent",
      plane: "side",
      position: bottomPoint(state, "bottom_waist_handle_start"),
      anchor: bottomPoint(state, "bottom_seat_front"),
      kind: "tangent",
    },
    {
      id: "side:arch-contact",
      label: "Arch contact reach · projected to ground tangent",
      plane: "side",
      position: bottomPoint(state, "bottom_waist_handle_end"),
      anchor: bottomPoint(state, "bottom_forepart_contact"),
      kind: "tangent",
    },
    {
      id: "side:toe-roof",
      label: "Toe roof · forefoot station and depth",
      plane: "side",
      position: landmark(state, "toe_roof"),
      kind: "point",
    },
    {
      id: "side:seat-angle",
      label: "Actual rear sole angle · changes relative offset",
      plane: "side",
      position: bottomPoint(state, "bottom_heel_seat_handle_start"),
      anchor: bottomPoint(state, "bottom_heel_rear"),
      kind: "tangent",
    },
  ];
  for (const role of ["waist", "ball"] as const) {
    const position = landmark(
        state,
        role === "waist" ? "waist_roof" : "ball_roof",
      ),
      d = depthDirection(state, role);
    const h =
      state.inputs.centre_section[`${role}_height_ratio`] *
      state.inputs.foot.length;
    handles.push({
      id: `side:${role}-roof`,
      label: `${role} design depth · constrained to its depth guide`,
      plane: "side",
      position,
      anchor: [position[0] - h * d[0], position[1] - h * d[1]],
      kind: "point",
    });
  }
  const visible = handles.filter(
    (h) =>
      h.id !== "side:heel-departure" &&
      h.id !== "side:instep-front" &&
      h.id !== "side:instep-waist",
  );
  for (const id of NATIVE_SECTION_CURVES)
    for (const control of [1, 2] as const) {
      const p = curve(state, id),
        f = sectionControlFrame(state, id, control);
      visible.push({
        id: `side:bezier:${id}:${control}`,
        label: `${id} independent control ${control}`,
        plane: "side",
        position: [...p[control]],
        anchor: [...f.anchor],
        kind: "tangent",
      });
    }
  return visible;
}

/** Accepted state supplies a frozen frame; no geometry construction or live solve. */
export function moveSideHandle(
  state: Last2DGeometry,
  input: FootFirstInput,
  id: SideShapeHandleId,
  target: Vec2,
): string {
  const f = frame(state),
    F = input.foot.length,
    c = input.centre_section;
  if (id.startsWith("side:bezier:")) {
    const parts = id.split(":"),
      curveId = NATIVE_SECTION_CURVES.find((name) => name === parts[2]),
      control = parts[3] === "1" ? 1 : parts[3] === "2" ? 2 : undefined;
    if (!curveId || !control) throw new Error("Unknown native side handle");
    const local = sectionControlFrame(state, curveId, control),
      dy = target[0] - local.anchor[0],
      dz = target[1] - local.anchor[1];
    const overrides = input.section_handles ?? (input.section_handles = {}),
      entry = overrides[curveId] ?? (overrides[curveId] = {});
    entry[control === 1 ? "control1" : "control2"] = {
      tangent_ratio: (dy * local.t[0] + dz * local.t[1]) / F,
      normal_ratio: (dy * local.n[0] + dz * local.n[1]) / F,
    };
    return `${curveId} control ${control}: independent local vector; opposite handle and anchors unchanged. Rebuild checks clearance and folds.`;
  }
  if (id === "side:heel-departure") {
    const v = f.local(target);
    nonzero(v);
    const angle = clamp(degrees(Math.atan2(-v[0], v[1])), 0, MAX_ANGLE);
    c.heel_leave_outward_deg = angle;
    return `Heel outward angle ${angle.toFixed(2)}° (departure ${(90 + angle).toFixed(2)}° from sole); constrained to angle only, fixed 0.20h reach.`;
  }
  if (id === "side:heel-bulge") {
    const u = f.local(target)[0];
    c.heel_bulge_ratio = fraction(-u, F, 0);
    return `Heel bulge ${(c.heel_bulge_ratio * F).toFixed(2)} mm outward; constrained to outward component, middle height remains 0.50h.`;
  }
  if (id === "side:cut-rear" || id === "side:cut-front") {
    const [u, v] = f.local(target),
      station = clamp(u, 0.01, F - 0.01);
    const field =
      id === "side:cut-rear"
        ? "top_rear_station_ratio"
        : "top_front_station_ratio";
    c[field] = station / F;
    c.top_front_height_ratio = fraction(v, F);
    return `Top cut ${id.endsWith("rear") ? "rear" : "front"}: local station ${station.toFixed(2)} mm, shared depth ${(c.top_front_height_ratio * F).toFixed(2)} mm. Constrained to the rear frame; Rebuild checks order/clearance.`;
  }
  if (id === "side:instep-front" || id === "side:instep-waist") {
    const p = curve(
        state,
        id === "side:instep-front"
          ? "roof_front_to_waist"
          : "roof_waist_to_ball",
      ),
      anchor = p[3];
    const v: Vec2 = [target[0] - anchor[0], target[1] - anchor[1]];
    nonzero(v);
    const down = clamp(degrees(Math.atan2(-v[1], v[0])), -MAX_ANGLE, MAX_ANGLE),
      offset = down - degrees(f.angle);
    const role = id === "side:instep-front" ? "front" : "waist";
    c[`instep_${role}_handle_ratio`] = fraction(Math.hypot(...v), F);
    c[`instep_${role}_down_offset_deg`] = offset;
    return `${role} instep reach ${(c[`instep_${role}_handle_ratio`] * F).toFixed(2)} mm, down offset ${offset.toFixed(2)}°; constrained to a forward tangent${role === "waist" ? ", shared by both pieces" : ""}. Rebuild validates the curve.`;
  }
  if (id === "side:arch-start" || id === "side:arch-contact") {
    const a = getBottomGuidePoint(state, "bottom_seat_front"),
      b = getBottomGuidePoint(state, "bottom_forepart_contact"),
      span = b.y - a.y;
    const start = id === "side:arch-start",
      field = start ? "arch_start_reach_ratio" : "arch_contact_reach_ratio",
      other = start
        ? input.design.arch_contact_reach_ratio
        : input.design.arch_start_reach_ratio;
    const max = Math.min(nextafter(1, 0), 1 - other),
      min = Math.min(Number.EPSILON, max / 2);
    input.design[field] = clamp(
      (start ? target[0] - a.y : b.y - target[0]) / span,
      min,
      max,
    );
    return `Arch ${start ? "start" : "contact"} reach ${(100 * input.design[field]).toFixed(2)}% of projected waist span; constrained to the endpoint tangent and remaining reach budget. Vertical pointer movement is projected.`;
  }
  if (id === "side:seat-angle") {
    const v: Vec2 = [target[0] - f.origin[0], target[1] - f.origin[1]];
    nonzero(v);
    const actual = clamp(degrees(Math.atan2(-v[1], v[0])), 0, MAX_ANGLE);
    input.pose.seat_inclination_deg =
      actual - degrees(state.resolved.bend_angle_rad);
    return `Actual rear sole ${actual.toFixed(2)}°, relative offset ${input.pose.seat_inclination_deg.toFixed(2)}°; constrained to [0°,90°). Rebuild moves the whole rear block.`;
  }
  if (id === "side:toe-roof") {
    const old = getSectionLandmark(state, "toe_roof");
    const a = getBottomGuidePoint(state, "bottom_forepart_blend_end"),
      b = getBottomGuidePoint(state, "bottom_toe_end"),
      length = Math.hypot(b.y - a.y, b.z - a.z);
    const uy = (b.y - a.y) / length,
      uz = (b.z - a.z) / length;
    const s = clamp(
      old.reference_s + (target[0] - old.y) / uy,
      state.resolved.bend_station + state.resolved.blend_arc_length + 0.01,
      F - 0.01,
    );
    const oldDepth =
      state.inputs.centre_section.toe_roof_height_ratio *
      state.inputs.foot.length;
    const bottomZ = old.z - oldDepth + (s - old.reference_s) * uz;
    c.toe_roof_station_ratio = s / F;
    c.toe_roof_height_ratio = fraction(target[1] - bottomZ, F);
    return `Toe roof station ${s.toFixed(2)} mm, depth ${(c.toe_roof_height_ratio * F).toFixed(2)} mm; constrained to the actual forefoot ramp and positive depth. Rebuild validates the closure.`;
  }
  if (id === "side:waist-roof" || id === "side:ball-roof") {
    const role = id === "side:waist-roof" ? "waist" : "ball",
      point = landmark(state, role === "waist" ? "waist_roof" : "ball_roof"),
      d = depthDirection(state, role);
    const field = role === "waist" ? "waist_height_ratio" : "ball_height_ratio";
    const old = state.inputs.centre_section[field] * state.inputs.foot.length;
    c[field] = fraction(
      old + (target[0] - point[0]) * d[0] + (target[1] - point[1]) * d[1],
      F,
    );
    return `${role} design depth ${(c[field] * F).toFixed(2)} mm; constrained to its ${role === "waist" ? "tilted blend" : "vertical ball"} depth guide at a fixed reference station.`;
  }
  throw new Error("Unsupported side shape handle.");
}
