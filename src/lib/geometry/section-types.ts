import type { Cubic, Vec2, Vec3 } from "./types";

export const CROSS_SECTION_IDS = [
  "heel_width",
  "midfoot",
  "ball",
  "fore_toe",
  "toe_end",
  "waist",
  "instep",
] as const;
export type CrossSectionId = (typeof CROSS_SECTION_IDS)[number];
export const CROSS_SECTION_ANCHORS = [
  "medial",
  "dorsal",
  "lateral",
  "plantar",
] as const;
export type CrossSectionAnchorId = (typeof CROSS_SECTION_ANCHORS)[number];
export interface CrossSectionDefinition {
  station_offset_ratio?: number;
  tilt_deg?: number;
  side_depth_ratios?: Vec2;
  /** Independent vectors relative to the shared anchor, normalized by W/F. */
  handles?: Partial<
    Record<CrossSectionAnchorId, { incoming?: Vec2; outgoing?: Vec2 }>
  >;
}
export interface HeelWrapRoute {
  protocol: string;
  /** Ordered [longitudinal fraction, circumference fraction], closed explicitly. */
  route: Vec2[];
  target_mm?: number;
  foot?: { value_mm: number; conditions: string };
}
export interface CrossSectionsInput {
  split_midfoot?: boolean;
  sections?: Partial<Record<CrossSectionId, CrossSectionDefinition>>;
  heel_wraps?: Partial<Record<"short_heel" | "long_heel", HeelWrapRoute>>;
}
export interface ResolvedCrossSection {
  id: CrossSectionId;
  label: string;
  referenceStation: number;
  anchors: {
    id: CrossSectionAnchorId;
    label: string;
    point: Vec2;
    incoming: Vec2;
    outgoing: Vec2;
  }[];
  cubics: Cubic[];
  samples: Vec2[];
  posedSamples: Vec3[];
  frame: { origin: Vec3; transverse: Vec3; up: Vec3; label: string };
  width: number;
  height: number;
  perimeter: number;
}
export interface LastSurface {
  positions: number[];
  indices: number[];
}
export interface HeelWrapDiagnostic {
  id: "short_heel" | "long_heel";
  status: "configured" | "unconfigured";
  protocol?: string;
  points: Vec3[];
  computed_mm?: number;
  target_mm?: number;
  foot?: { value_mm: number; conditions: string };
  target_delta_mm?: number;
  foot_delta_mm?: number;
}
