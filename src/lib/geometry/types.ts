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
export type TopControls = Record<`${Station}_s` | `${Station}_width`, number>;
export interface BottomControls {
  heel_height: number;
  toe_spring: number;
  seat_arc_length: number;
  seat_inclination_deg: number;
  contact_s: number;
  blend_arc_length: number;
}
export interface ContourInput {
  schema_version: 1;
  kind: "contour_last";
  units: "mm";
  description: string;
  design: { last_length: number; top: TopControls; bottom: BottomControls };
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
export interface LastState {
  inputs: ContourInput;
  models: { top: TopModel; bottom: BottomModel };
  reports: {
    top: ValidationReport;
    bottom: ValidationReport;
    contour: ValidationReport;
  };
  derived: {
    projected_length: number;
    station_map: Record<Station, { s: number; y: number }>;
    bottom_stations: { seat_s: number; contact_s: number; blend_end_s: number };
  };
  display: { top: SampledCurve[]; bottom: SampledCurve[] };
}
export interface ProjectedBottom {
  heel_height: number;
  toe_spring: number;
  seat_projected_length: number;
  seat_inclination_deg: number;
  contact_forward: number;
  forepart_blend_length: number;
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
