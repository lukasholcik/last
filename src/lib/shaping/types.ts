import type {
  TopAnchorId,
  Station,
  NativeSectionCurveId,
  Vec2,
} from "../geometry/types";

export type SideShapeHandleId =
  | `side:${
      | "heel-departure"
      | "heel-bulge"
      | "cut-rear"
      | "cut-front"
      | "instep-front"
      | "instep-waist"
      | "arch-start"
      | "arch-contact"
      | "toe-roof"
      | "seat-angle"
      | "waist-roof"
      | "ball-roof"}`
  | `side:bezier:${NativeSectionCurveId}:${1 | 2}`;
export type TopShapeHandleId =
  `top:${TopAnchorId | "last-toe"}` | `top:${TopAnchorId}:${"in" | "out"}`;
export type FootReferenceHandleId = `foot:${Station}`;
export type ShapeHandleId =
  SideShapeHandleId | TopShapeHandleId | FootReferenceHandleId;

export interface ShapeHandle {
  id: ShapeHandleId;
  label: string;
  plane: "side" | "top";
  position: Vec2;
  anchor?: Vec2;
  kind: "point" | "tangent";
  resetToFoot?: TopAnchorId;
  editTarget?: "foot" | "last";
}
