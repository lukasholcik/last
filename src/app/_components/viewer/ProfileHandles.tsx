import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type {
  FootFirstInput,
  Last2DGeometry,
  Vec2,
} from "~/lib/geometry/types";
import {
  getShapeHandles,
  moveShapeHandle,
  type ShapeHandle,
} from "~/lib/shaping";
import type { ShapeGesture } from "./editable-2d";
import {
  clientToModel,
  modelToSvg,
  nudgeTarget,
  type GuideFrame,
} from "./profile-pointer";
import {
  selectedShapeHandle,
  shapeHandleOwner,
  visibleShapeHandles,
  shapeHandlesForMode,
  type OutlineMode,
} from "./shape-selection";

export interface ShapeEditingProps {
  enabled: boolean;
  version: number;
  dragging: boolean;
  selectedId: ShapeHandle["id"] | null;
  onChoose: (id: ShapeHandle["id"] | null) => void;
  onBegin: () => ShapeGesture | null;
  onPreview: (token: number, input: FootFirstInput) => void;
  onFinish: (token: number, input: FootFirstInput, feedback: string) => boolean;
  onCancel: (token: number) => void;
}
interface Props extends ShapeEditingProps {
  result: Last2DGeometry;
  frame: GuideFrame;
  outlineMode: OutlineMode;
  onSelect: (message: string) => void;
}
interface Drag extends ShapeGesture {
  pointerId: number;
  element: SVGGElement;
  handle: ShapeHandle;
  frame: GuideFrame;
}
interface Target {
  target: Vec2;
  feedback: string;
  input?: FootFirstInput;
}

export function ProfileHandles({
  result,
  frame,
  enabled,
  version,
  dragging,
  selectedId,
  onChoose,
  outlineMode,
  onBegin,
  onPreview,
  onFinish,
  onCancel,
  onSelect,
}: Props) {
  const group = useRef<SVGGElement>(null),
    drag = useRef<Drag | null>(null);
  const [scale, setScale] = useState(1);
  const handles = useMemo(
    () => shapeHandlesForMode(getShapeHandles(result), outlineMode),
    [result, outlineMode],
  );
  const visible = useMemo(
    () => visibleShapeHandles(handles, selectedId),
    [handles, selectedId],
  );
  const selected = selectedShapeHandle(handles, selectedId);
  const releasePointer = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    if (active?.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    return active;
  }, []);
  const cancel = useCallback(() => {
    const active = releasePointer();
    if (active) onCancel(active.token);
  }, [onCancel, releasePointer]);
  useLayoutEffect(() => {
    const svg = group.current?.ownerSVGElement;
    if (!svg) return;
    const resize = () => {
      const matrix = svg.getScreenCTM();
      if (matrix) setScale(Math.max(Math.hypot(matrix.a, matrix.b), 0.001));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(svg);
    return () => {
      observer.disconnect();
      const active = releasePointer();
      if (active) onCancel(active.token);
    };
  }, [onCancel, releasePointer]);
  useLayoutEffect(() => {
    const active = releasePointer();
    if (active) onCancel(active.token);
  }, [version, onCancel, releasePointer]);
  useLayoutEffect(() => {
    const active = releasePointer();
    if (active) onCancel(active.token);
  }, [outlineMode, onCancel, releasePointer]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        cancel();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [cancel]);

  function update(event: PointerEvent<SVGGElement>, active: Drag): Target {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) throw new Error("Drawing unavailable.");
    const target = clientToModel(
      svg,
      event.clientX,
      event.clientY,
      active.handle.plane,
      active.frame,
    );
    try {
      return {
        target,
        ...moveShapeHandle(
          active.geometry,
          active.input,
          active.handle.id,
          target,
        ),
      };
    } catch (error) {
      return {
        target,
        feedback:
          error instanceof Error ? error.message : "Target not applied.",
      };
    }
  }
  function start(event: PointerEvent<SVGGElement>, handle: ShapeHandle) {
    if (!enabled || drag.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const gesture = onBegin();
    if (!gesture) return;
    const freshHandles = shapeHandlesForMode(
        getShapeHandles(gesture.geometry),
        outlineMode,
      ),
      freshHandle = freshHandles.find((entry) => entry.id === handle.id);
    if (!freshHandle) {
      onCancel(gesture.token);
      return;
    }
    event.currentTarget.focus();
    onChoose(shapeHandleOwner(freshHandles, freshHandle).id);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic events have no native active pointer. */
    }
    drag.current = {
      ...gesture,
      pointerId: event.pointerId,
      element: event.currentTarget,
      handle: freshHandle,
      frame: { ...frame },
    };
  }
  function move(event: PointerEvent<SVGGElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const next = update(event, active);
      if (next.input) onPreview(active.token, next.input);
    } catch (error) {
      cancel();
      onSelect(error instanceof Error ? error.message : "Edit not applied.");
    }
  }
  function finish(event: PointerEvent<SVGGElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const next = update(event, active),
        moved =
          Math.hypot(
            next.target[0] - active.handle.position[0],
            next.target[1] - active.handle.position[1],
          ) *
            scale >=
          2;
      releasePointer();
      if (moved && next.input)
        onFinish(active.token, next.input, next.feedback);
      else {
        onCancel(active.token);
        if (!next.input) onSelect(next.feedback);
      }
    } catch (error) {
      cancel();
      onSelect(error instanceof Error ? error.message : "Edit not applied.");
    }
  }

  return (
    <g
      ref={group}
      className="profile-handles"
      data-edit-enabled={enabled}
      data-dragging={dragging}
    >
      {visible.map((handle) => {
        const [x, y] = modelToSvg(handle.position, handle.plane, frame),
          anchor = handle.anchor
            ? modelToSvg(handle.anchor, handle.plane, frame)
            : null,
          size = 5 / scale;
        return (
          <g key={handle.id}>
            {anchor && (
              <line
                x1={anchor[0]}
                y1={anchor[1]}
                x2={x}
                y2={y}
                className="profile-link"
              />
            )}
            <g
              className={`profile-handle ${handle.kind}${selected?.id === shapeHandleOwner(handles, handle).id ? "is-selected" : ""}`}
              transform={`translate(${x} ${y})`}
              data-shape-handle={handle.id}
              data-shape-plane={handle.plane}
              data-model-forward={handle.position[0]}
              data-model-transverse={handle.position[1]}
              data-shape-target={handle.editTarget ?? "section"}
              role="button"
              tabIndex={enabled ? 0 : -1}
              aria-disabled={!enabled}
              aria-label={`${handle.label}. ${enabled ? "Enter selects handles. Drag or use arrow keys." : "Editing unavailable."}`}
              onPointerDown={(event) => start(event, handle)}
              onFocus={() => onChoose(shapeHandleOwner(handles, handle).id)}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={cancel}
              onLostPointerCapture={() => {
                if (drag.current?.handle.id === handle.id) cancel();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancel();
                  onSelect("Cancelled");
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onChoose(shapeHandleOwner(handles, handle).id);
                  return;
                }
                if (
                  !enabled ||
                  drag.current ||
                  !nudgeTarget(handle.position, handle.plane, event.key, 1)
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                const gesture = onBegin();
                if (!gesture) return;
                try {
                  const current = getShapeHandles(gesture.geometry).find(
                    (entry) => entry.id === handle.id,
                  );
                  if (!current) {
                    onCancel(gesture.token);
                    return;
                  }
                  const target = nudgeTarget(
                    current.position,
                    current.plane,
                    event.key,
                    event.shiftKey ? 5 : event.altKey ? 0.1 : 1,
                  );
                  if (!target) {
                    onCancel(gesture.token);
                    return;
                  }
                  const next = moveShapeHandle(
                    gesture.geometry,
                    gesture.input,
                    current.id,
                    target,
                  );
                  onFinish(gesture.token, next.input, next.feedback);
                } catch (error) {
                  onCancel(gesture.token);
                  onSelect(
                    error instanceof Error
                      ? error.message
                      : "Edit not applied.",
                  );
                }
              }}
            >
              <circle r={12 / scale} className="profile-hit" />
              {handle.kind === "tangent" ? (
                <path
                  d={`M 0 ${-size} L ${size} 0 L 0 ${size} L ${-size} 0 Z`}
                  className="profile-handle-visible"
                />
              ) : (
                <circle r={size} className="profile-handle-visible" />
              )}
              <title>{handle.label}</title>
            </g>
          </g>
        );
      })}
    </g>
  );
}
