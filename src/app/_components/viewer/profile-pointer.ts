import type { Vec2 } from "~/lib/geometry/types";
import type { ShapeHandle } from "~/lib/shaping";

export interface GuideFrame {
  left: number;
  topBase: number;
  bottomBase: number;
}

export function modelToSvg(
  [forward, transverse]: Vec2,
  plane: ShapeHandle["plane"],
  frame: GuideFrame,
): Vec2 {
  return [
    frame.left + forward,
    plane === "side"
      ? frame.bottomBase - transverse
      : frame.topBase + transverse,
  ];
}

export function svgToModel(
  [x, y]: Vec2,
  plane: ShapeHandle["plane"],
  frame: GuideFrame,
): Vec2 {
  return [
    x - frame.left,
    plane === "side" ? frame.bottomBase - y : y - frame.topBase,
  ];
}

export function clientToModel(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  plane: ShapeHandle["plane"],
  frame: GuideFrame,
): Vec2 {
  const matrix = svg.getScreenCTM();
  if (!matrix)
    throw new Error(
      "The drawing frame is unavailable. Try again after it is visible.",
    );
  const point = new DOMPoint(clientX, clientY).matrixTransform(
    matrix.inverse(),
  );
  return svgToModel([point.x, point.y], plane, frame);
}

export function nudgeTarget(
  position: Vec2,
  plane: ShapeHandle["plane"],
  key: string,
  step: number,
): Vec2 | null {
  const [forward, transverse] = position;
  if (key === "ArrowLeft") return [forward - step, transverse];
  if (key === "ArrowRight") return [forward + step, transverse];
  if (key === "ArrowUp")
    return [forward, transverse + (plane === "side" ? step : -step)];
  if (key === "ArrowDown")
    return [forward, transverse + (plane === "side" ? -step : step)];
  return null;
}
