import type { FootFirstInput, Last2DGeometry, Vec2 } from "../geometry/types";
import type {
  ShapeHandle,
  ShapeHandleId,
  TopShapeHandleId,
  FootReferenceHandleId,
  SideShapeHandleId,
} from "./types";
import { getSideHandles, moveSideHandle } from "./side-profile";
import {
  getFootHandles,
  moveFootHandle,
  getFootReferenceHandles,
  moveFootReferenceHandle,
} from "./foot-outline";

export type {
  ShapeHandle,
  ShapeHandleId,
  SideShapeHandleId,
  TopShapeHandleId,
  FootReferenceHandleId,
} from "./types";
export { resetLastOutlinePoint, rebaseLastOutline } from "./foot-outline";
export { getFootReferenceHandles } from "./foot-outline";
export type { TopAnchorId } from "../geometry/types";
function legacySideId(id: string): SideShapeHandleId | undefined {
  if (
    id === "side:heel-departure" ||
    id === "side:instep-front" ||
    id === "side:instep-waist"
  )
    return id;
  return undefined;
}

function isTopHandle(id: ShapeHandleId): id is TopShapeHandleId {
  return id.startsWith("top:");
}
function isFootHandle(id: ShapeHandleId): id is FootReferenceHandleId {
  return id.startsWith("foot:");
}

export function getShapeHandles(state: Last2DGeometry): ShapeHandle[] {
  return [
    ...getSideHandles(state),
    ...getFootHandles(state),
    ...getFootReferenceHandles(state),
  ];
}

export function moveShapeHandle(
  state: Last2DGeometry,
  input: FootFirstInput,
  id: string,
  target: Vec2,
): { input: FootFirstInput; feedback: string } {
  if (
    !Array.isArray(target) ||
    target.length !== 2 ||
    target.some((v) => !Number.isFinite(v))
  )
    throw new Error(
      "Shape target must contain two finite millimetre coordinates.",
    );
  const handle = getShapeHandles(state).find(
    (handle) => handle.id === (id === "top:toe_tip" ? "top:last-toe" : id),
  );
  const semanticId = handle?.id ?? legacySideId(id);
  if (!semanticId) throw new Error(`Unknown shape handle: ${id}`);
  if (
    input.foot.length !== state.inputs.foot.length ||
    input.foot.width !== state.inputs.foot.width
  )
    throw new Error(
      "Rebuild changed physical dimensions before dragging shape guides.",
    );
  const bounded: Vec2 = [
    Math.max(-10000, Math.min(10000, target[0])),
    Math.max(-10000, Math.min(10000, target[1])),
  ];
  const next = structuredClone(input);
  const feedback = isTopHandle(semanticId)
    ? moveFootHandle(state, next, semanticId, bounded)
    : isFootHandle(semanticId)
      ? moveFootReferenceHandle(state, next, semanticId, bounded)
      : moveSideHandle(state, next, semanticId, bounded);
  return {
    input: next,
    feedback:
      feedback +
      (bounded[0] !== target[0] || bounded[1] !== target[1]
        ? " Target constrained to numeric coordinate bounds."
        : ""),
  };
}
