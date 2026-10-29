import type { ShapeHandle } from "~/lib/shaping";

export type OutlineMode = "last" | "foot";
export function shapeHandlesForMode(
  handles: readonly ShapeHandle[],
  mode: OutlineMode,
) {
  return handles.filter(
    (handle) => handle.plane !== "top" || handle.editTarget === mode,
  );
}

/** Ownership comes from the supplied anchor position, never from labels or an ID catalog. */
export function shapeHandleOwner(
  handles: readonly ShapeHandle[],
  handle: ShapeHandle,
): ShapeHandle {
  if (handle.kind === "point" || !handle.anchor) return handle;
  const anchor = handle.anchor;
  return (
    handles.find(
      (point) =>
        point.kind === "point" &&
        point.plane === handle.plane &&
        Math.hypot(
          point.position[0] - anchor[0],
          point.position[1] - anchor[1],
        ) < 1e-6,
    ) ?? handle
  );
}

export function selectedShapeHandle(
  handles: readonly ShapeHandle[],
  selectedId: ShapeHandle["id"] | null,
) {
  const selected = handles.find((handle) => handle.id === selectedId);
  return selected ? shapeHandleOwner(handles, selected) : undefined;
}

/** Points remain discoverable; their incoming/outgoing controls follow immediately in tab order. */
export function visibleShapeHandles(
  handles: readonly ShapeHandle[],
  selectedId: ShapeHandle["id"] | null,
): ShapeHandle[] {
  const selected = selectedShapeHandle(handles, selectedId);
  return handles.flatMap((handle) => {
    if (handle.kind === "point")
      return [
        handle,
        ...(selected?.id === handle.id
          ? handles.filter(
              (control) =>
                control.kind === "tangent" &&
                shapeHandleOwner(handles, control).id === handle.id,
            )
          : []),
      ];
    return shapeHandleOwner(handles, handle).id === handle.id ? [handle] : [];
  });
}
