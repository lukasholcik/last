export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** SVG's default xMidYMid meet, including its letterboxing. */
export function clientToViewBox(
  clientX: number,
  clientY: number,
  rect: Rect,
  box: ViewBox,
): [number, number] | null {
  if (
    ![
      clientX,
      clientY,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      box.x,
      box.y,
      box.width,
      box.height,
    ].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    box.width <= 0 ||
    box.height <= 0
  )
    return null;
  const scale = Math.min(rect.width / box.width, rect.height / box.height);
  return [
    box.x +
      (clientX - rect.left - (rect.width - box.width * scale) / 2) / scale,
    box.y +
      (clientY - rect.top - (rect.height - box.height * scale) / 2) / scale,
  ];
}

export interface ScalarDrag {
  pointerId: number;
  startX: number;
  initial: number;
  unitsPerPixel: number;
  min: number;
  max: number;
}

/** A cancelled gesture restores its start; unrelated pointers and no-ops do nothing. */
export function pointerValue(
  drag: ScalarDrag,
  pointerId: number,
  x: number,
  phase: "move" | "cancel",
  previous: number,
): number | null {
  if (
    pointerId !== drag.pointerId ||
    !Number.isFinite(x) ||
    drag.min > drag.max
  )
    return null;
  const value =
    phase === "cancel"
      ? drag.initial
      : Math.max(
          drag.min,
          Math.min(
            drag.max,
            drag.initial + (x - drag.startX) * drag.unitsPerPixel,
          ),
        );
  return Number.isFinite(value) && value !== previous ? value : null;
}
