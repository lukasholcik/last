import type {
  CrossSectionsInput,
  ResolvedCrossSection,
  LastSurface,
  HeelWrapDiagnostic,
} from "./section-types";
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Cubic = [Vec2, Vec2, Vec2, Vec2];
export type PointKind = "landmark" | "handle" | "reference";
export interface Curve {
  start: string;
  control1: string;
  control2: string;
  end: string;
}
export interface ReferenceLine {
  start: string;
  end: string;
}
export interface TopPoint {
  x: number;
  y: number;
  kind: PointKind;
}
export interface BottomPoint {
  y: number;
  z: number;
  kind: PointKind;
}
export interface TopDimension {
  kind: "length" | "side_extent";
  axis: "x" | "y";
  expected: number;
  reference_line: string;
  side?: string;
  station_y?: number;
  start_y?: number;
  end_y?: number;
  definition?: string;
}
export interface BottomDimension {
  expected: number;
  units: "mm" | "deg";
  reference_line: string;
  definition: string;
}
export interface TopModel {
  schema_version: 1;
  units: "mm";
  points: Record<string, TopPoint>;
  curves: Record<string, Curve>;
  reference_lines: Record<string, ReferenceLine>;
  outline: string[];
  dimensions: Record<string, TopDimension>;
  design: Record<string, number>;
  source: string;
}
export interface BottomModel {
  schema_version: 2;
  kind: "bottom_profile";
  units: "mm";
  axes: ["y", "z"];
  closed: false;
  points: Record<string, BottomPoint>;
  curves: Record<string, Curve>;
  profile: string[];
  reference_lines: Record<string, ReferenceLine>;
  construction_lines: Record<string, ReferenceLine>;
  dimensions: Record<string, BottomDimension>;
  source: string;
}
export const SIDES = ["medial", "lateral"] as const;
export const REGIONS = ["heel", "waist", "ball", "toe"] as const;
export type Station = `${(typeof SIDES)[number]}_${(typeof REGIONS)[number]}`;
export type TopAnchorId = Station | "heel_tip" | "toe_tip";
export interface LastOutlineVector {
  forward_ratio: number;
  side_ratio: number;
}
export interface LastOutlineInput {
  anchors: Partial<
    Record<
      TopAnchorId,
      { station_offset_ratio: number; side_offset_ratio: number }
    >
  >;
  handles: Partial<
    Record<
      TopAnchorId,
      { incoming?: LastOutlineVector; outgoing?: LastOutlineVector }
    >
  >;
}
export type NativeSectionCurveId =
  | "rear_cap_lower"
  | "rear_cap_upper"
  | "toe_cap"
  | "roof_front_to_waist"
  | "roof_waist_to_ball";
export interface SectionHandleVector {
  tangent_ratio: number;
  normal_ratio: number;
}
export type SectionHandleInput = Partial<
  Record<
    NativeSectionCurveId,
    { control1?: SectionHandleVector; control2?: SectionHandleVector }
  >
>;
export type TopControls = Record<`${Station}_s` | `${Station}_width`, number>;
export interface BottomControls {
  heel_height: number;
  toe_spring: number;
  seat_arc_length: number;
  seat_inclination_deg: number;
  contact_s: number;
  blend_arc_length: number;
  arch_start_reach_ratio?: number;
  arch_contact_reach_ratio?: number;
}
export interface ContourInput {
  schema_version: 1;
  kind: "contour_last";
  units: "mm";
  description: string;
  design: { last_length: number; top: TopControls; bottom: BottomControls };
}
/** Authored foot-first rules and immutable source provenance; ratios are fractions. */
export interface FootFirstInput {
  schema_version: 4;
  kind: "foot_first_last";
  units: "mm";
  description: string;
  reference: {
    provenance: "synthetic" | "measured";
    description: string;
    width_definition: string;
    foot_length: number;
    foot_width: number;
  };
  foot: { length: number; width: number };
  template: Record<
    Station,
    { station_ratio: number; side_extent_ratio: number }
  >;
  design: {
    toe_extension_ratio: number;
    seat_arc_ratio: number;
    blend_arc_ratio: number;
    bend_radius_ratio: number;
    arch_start_reach_ratio: number;
    arch_contact_reach_ratio: number;
  };
  pose: {
    heel_height: number;
    toe_spring: number;
    seat_inclination_deg: number;
  };
  /** F-based anchor/depth/reach fractions and explicit degree-valued shape angles. */
  centre_section: CentreSectionInput;
  last_outline?: LastOutlineInput;
  section_handles?: SectionHandleInput;
  cross_sections?: CrossSectionsInput;
}
export interface CentreSectionInput {
  top_rear_station_ratio: number;
  top_front_station_ratio: number;
  toe_roof_station_ratio: number;
  top_front_height_ratio: number;
  waist_height_ratio: number;
  ball_height_ratio: number;
  toe_roof_height_ratio: number;
  heel_leave_outward_deg: number;
  heel_bulge_ratio: number;
  instep_front_handle_ratio: number;
  instep_waist_handle_ratio: number;
  instep_front_down_offset_deg: number;
  instep_waist_down_offset_deg: number;
}
export type SectionPointName =
  | "heel_bottom"
  | "heel_middle"
  | "toe_bottom"
  | "cut_rear"
  | "cut_front"
  | "waist_roof"
  | "ball_roof"
  | "toe_roof";
export type HeightCurveName =
  "front_to_waist" | "waist_to_ball" | "ball_to_toe";
export interface SectionPoint {
  y: number;
  z: number;
  reference_s: number;
  /** Actual vertical offset from B(reference_s), not the authored local depth. */
  height: number;
  kind: "landmark";
}
export type SectionPiece =
  | { name: string; kind: "bottom"; source_curve: string }
  | { name: string; kind: "roof"; height_curve: string; reverse: true }
  | { name: string; kind: "cubic"; points: Cubic }
  | { name: "top_cut"; kind: "line"; points: [Vec2, Vec2] };
export interface SectionModel {
  schema_version: 1;
  axes: ["y", "z"];
  plane_x: 0;
  closed: true;
  points: Record<SectionPointName, SectionPoint>;
  /** Reference (s, local depth) anchor recipe, not the native posed instep handles. */
  height_curves: Record<HeightCurveName, Cubic>;
  boundary: SectionPiece[];
}
export interface Check {
  name: string;
  actual: number;
  expected: number;
  tolerance: number;
  passed: boolean;
  units?: string;
  uncertainty_mm?: number;
}
export interface ValidationReport {
  passed: boolean;
  units: "mm";
  checks: Check[];
  limits: string[];
  sections?: {
    name: string;
    y: number;
    medial_x: number;
    lateral_x: number;
    width: number;
  }[];
  ground_contact?: {
    intervals: { curve: string; start_y: number; end_y: number }[];
    isolated_y: number[];
  };
  bottom_arc_length?: {
    actual: number;
    lower_bound: number;
    upper_bound: number;
    uncertainty_mm: number;
    units: "mm";
    derived: true;
  };
  last_length_bounds?: { lower: number; upper: number };
}
export interface SampledCurve {
  name: string;
  points: Vec3[];
}
/** Schema-1 reference-test result, not a production buildLast input/output. */
export interface LegacyLastState {
  inputs: ContourInput;
  /** Top is unbent: its y coordinate is intrinsic contour station s, not posed y. */
  models: { top: TopModel; bottom: BottomModel };
  reports: {
    top: ValidationReport;
    bottom: ValidationReport;
    contour: ValidationReport;
  };
  derived: {
    /** Posed bottom's forward span; independent of the unbent top model length. */
    projected_length: number;
    /** Input s mapped to the actual bottom guide's posed forward coordinate y. */
    station_map: Record<Station, { s: number; y: number }>;
    bottom_stations: { seat_s: number; contact_s: number; blend_end_s: number };
  };
  /** Top samples bend [x,s] to [x,bottom_y(s),bottom_z(s)] without scaling x.
   * Prototype display placement only, not an anatomical surface. */
  display: { top: SampledCurve[]; bottom: SampledCurve[] };
}
/** Internal completed foot-first result, before centre-section assembly. */
export interface BaseLastState {
  inputs: FootFirstInput;
  /** Both silhouettes remain unbent (x,reference_s); only display.top is posed. */
  models: { foot: TopModel; top: TopModel; bottom: BottomModel };
  reports: {
    foot: ValidationReport;
    top: ValidationReport;
    bottom: ValidationReport;
    contour: ValidationReport;
  };
  resolved: {
    foot_length: number;
    foot_width: number;
    toe_extension: number;
    reference_last_length: number;
    bend_station: number;
    effective_radius: number;
    bend_angle_rad: number;
    posture_allowance: number;
    posed_last_length: number;
    seat_arc_length: number;
    waist_arc_length: number;
    blend_arc_length: number;
    ramp_arc_length: number;
    contact_s: number;
  };
  derived: {
    projected_length: number;
    station_map: Record<
      Station,
      { reference_s: number; posed_s: number; y: number; z: number }
    >;
    bottom_stations: { seat_s: number; contact_s: number; blend_end_s: number };
  };
  /** Whole reference-last cubics are sampled then placed along bottom arc g(s).
   * Radius is an allowance heuristic, not rendered curvature or an anatomical surface. */
  display: { top: SampledCurve[]; bottom: SampledCurve[] };
}
export interface LastState extends BaseLastState {
  models: BaseLastState["models"] & { section: SectionModel };
  reports: BaseLastState["reports"] & { section: ValidationReport };
  display: BaseLastState["display"] & {
    section: SampledCurve[];
    surface?: LastSurface;
    crossSections?: ResolvedCrossSection[];
    heelWraps?: HeelWrapDiagnostic[];
  };
}
/** Actual editable planar geometry; preview carries no validation claim or posed outline samples. */
export type Last2DGeometry = {
  inputs: FootFirstInput;
  models: LastState["models"];
  resolved: LastState["resolved"];
  derived: LastState["derived"];
  display: Pick<LastState["display"], "bottom" | "section">;
};
/** Accepted two-dimensional geometry checks only, not a rebuilt 3D outline. */
export type Last2DState = Last2DGeometry & { reports: LastState["reports"] };
export interface ProjectedBottom {
  heel_height: number;
  toe_spring: number;
  seat_projected_length: number;
  seat_inclination_deg: number;
  contact_forward: number;
  forepart_blend_length: number;
  arch_start_reach_ratio?: number;
  arch_contact_reach_ratio?: number;
}
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
export class GeometryValidationError extends Error {
  constructor(public readonly reports: LastState["reports"]) {
    super("Resulting geometry failed validation");
    this.name = "GeometryValidationError";
  }
}
