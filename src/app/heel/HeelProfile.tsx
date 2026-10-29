"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { curveControlPoints, projectMesh } from "~/lib/heel/loft";
import type {
  HeelBoundary,
  HeelMesh,
  HeelParameters,
  SeatGuide,
  Vec3,
} from "~/lib/heel/model";
import { getHeelEditingBounds, getTipPositionBounds } from "~/lib/heel/model";
import { clientToViewBox, pointerValue, type ScalarDrag } from "./pointer";
import {
  boundaryVertices,
  profileBoundaryVertices,
  projectedTrianglePath,
} from "./projection";
import { placeTip, type TipAxis } from "./tip-placement";
import styles from "./heel.module.css";

export function setHandle(
  parameters: HeelParameters,
  seat: SeatGuide,
  boundary: HeelBoundary,
  index: 0 | 1,
  value: number,
): HeelParameters {
  const next = structuredClone(parameters);
  if (
    parameters.symmetricBody &&
    (boundary === "left" || boundary === "right")
  ) {
    const other = boundary === "left" ? "right" : "left";
    const current = curveControlPoints(parameters, seat, boundary)[
      index + 1
    ]![0];
    const opposite = curveControlPoints(parameters, seat, other)[index + 1]![0];
    next.handles[boundary][index] = value;
    next.handles[other][index] = opposite - (value - current);
  } else next.handles[boundary][index] = value;
  return next;
}

interface Drag extends ScalarDrag {
  target:
    | { kind: "handle"; boundary: HeelBoundary; index: 0 | 1 }
    | { kind: "tip"; axis: TipAxis };
  snapshot: HeelParameters;
  previous: number;
}

export function HeelProfile({
  view,
  mesh,
  parameters,
  seat,
  onEdit,
}: {
  view: "side" | "rear";
  mesh: HeelMesh;
  parameters: HeelParameters;
  seat: SeatGuide;
  onEdit: (parameters: HeelParameters) => void;
}) {
  const drag = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [frozenFrame, setFrozenFrame] = useState<{
    scale: number;
    center: number;
  } | null>(null);
  const box = { x: 0, y: 0, width: 420, height: 285 };
  const coordinate = view === "side" ? 1 : 0;
  const horizontalMin =
    Math.min(view === "side" ? 0 : seat.leftX, mesh.bounds.min[coordinate]) -
    14;
  const horizontalMax =
    Math.max(
      view === "side" ? seat.length : seat.rightX,
      mesh.bounds.max[coordinate],
    ) + 14;
  const maxZ = Math.max(seat.heelHeight, mesh.bounds.max[2], 85);
  const frame = frozenFrame ?? {
    scale: Math.min(340 / (horizontalMax - horizontalMin), 205 / maxZ),
    center: (horizontalMin + horizontalMax) / 2,
  };
  const { scale, center } = frame;
  const ground = 246;
  const screen = (point: Vec3): [number, number] => [
    210 + ((view === "side" ? point[1] : point[0]) - center) * scale,
    ground - point[2] * scale,
  ];
  const filledMesh = useMemo(() => {
    const projected = projectMesh(mesh, view);
    return projectedTrianglePath(projected, ([u, z]) => [
      210 + (u - center) * scale,
      ground - z * scale,
    ]);
  }, [mesh, view, center, scale]);
  const boundaries: HeelBoundary[] =
    view === "side" ? ["back", "front"] : ["left", "right"];
  const local = (event: PointerEvent<SVGElement>) => {
    const svg =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.currentTarget.ownerSVGElement;
    return svg
      ? clientToViewBox(
          event.clientX,
          event.clientY,
          svg.getBoundingClientRect(),
          box,
        )
      : null;
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = drag.current,
      point = local(event);
    if (!gesture || !point) return;
    const value = pointerValue(
      gesture,
      event.pointerId,
      point[0],
      "move",
      gesture.previous,
    );
    if (value === null) return;
    gesture.previous = value;
    onEdit(
      gesture.target.kind === "tip"
        ? placeTip(gesture.snapshot, gesture.target.axis, value)
        : setHandle(
            gesture.snapshot,
            seat,
            gesture.target.boundary,
            gesture.target.index,
            value,
          ),
    );
  };
  const finish = (restore: boolean) => {
    const gesture = drag.current;
    if (!gesture) return;
    drag.current = null;
    setFrozenFrame(null);
    if (restore) onEdit(gesture.snapshot);
    if (svgRef.current?.hasPointerCapture(gesture.pointerId))
      svgRef.current.releasePointerCapture(gesture.pointerId);
  };
  const cancel = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerId === drag.current?.pointerId) finish(true);
  };
  const begin = (
    event: PointerEvent<SVGElement>,
    target: Drag["target"],
    value: number,
    min: number,
    max: number,
  ) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    const position = local(event),
      svg = svgRef.current;
    if (!position || !svg) return;
    event.currentTarget.focus();
    svg.setPointerCapture(event.pointerId);
    setFrozenFrame(frame);
    drag.current = {
      pointerId: event.pointerId,
      startX: position[0],
      initial: value,
      unitsPerPixel: 1 / scale,
      min,
      max,
      target,
      snapshot: structuredClone(parameters),
      previous: value,
    };
  };
  const ringPath = (ring: Vec3[]) =>
    ring.map((v) => screen(v).join(",")).join(" ");
  const editingBounds = getHeelEditingBounds(seat);
  const tipAxis: TipAxis = view === "side" ? "y" : "x";
  const tipBounds = getTipPositionBounds(parameters, seat)[tipAxis];
  const tipPosition =
    parameters.bottom[tipAxis === "x" ? "centerX" : "centerY"];
  const [tipX, tipY] = screen(mesh.positions[mesh.caps.bottom.center]!);

  return (
    <section className={styles.profile} aria-label={`${view} mesh profile`}>
      <div className={styles.profileHeading}>
        <div>
          <span className={styles.kicker}>
            {view === "side" ? "02 / y–z" : "03 / x–z"}
          </span>
          <h2>{view === "side" ? "Side profile" : "Rear profile"}</h2>
        </div>
        <span className={styles.profileUnit}>mm</span>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 420 285"
        className={styles.profileSvg}
        aria-label={`${view} projection of generated mesh with draggable scalar controls`}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (drag.current?.pointerId === event.pointerId) finish(false);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            finish(true);
          }
        }}
      >
        {[0, 20, 40, 60, 80, 100, 120]
          .filter((z) => z <= maxZ)
          .map((z) => (
            <g key={z}>
              <line
                x1="32"
                x2="392"
                y1={ground - z * scale}
                y2={ground - z * scale}
                className={z === 0 ? styles.groundLine : styles.gridLine}
              />
              <text
                x="18"
                y={ground - z * scale + 3}
                className={styles.axisText}
              >
                {z}
              </text>
            </g>
          ))}
        <path
          d={filledMesh}
          className={styles.meshFill}
          data-testid={`${view}-mesh-projection`}
        />
        {[mesh.caps.bottom, mesh.caps.top].map((cap, i) => (
          <polygon
            key={i}
            points={ringPath(boundaryVertices(mesh, cap.boundary))}
            className={i === 0 ? styles.bottomOutline : styles.topOutline}
          />
        ))}
        {boundaries.map((boundary) => {
          const markers = curveControlPoints(parameters, seat, boundary);
          return (
            <g key={boundary}>
              <polyline
                points={profileBoundaryVertices(mesh, boundary)
                  .map((point) => screen(point).join(","))
                  .join(" ")}
                className={styles.boundaryLine}
              />
              {([0, 1] as const).map((index) => {
                const point = markers[index + 1]!,
                  [x, y] = screen(point);
                const value = point[view === "side" ? 1 : 0];
                const min =
                  view === "side" ? editingBounds.backY : editingBounds.leftX;
                const max =
                  view === "side" ? editingBounds.frontY : editingBounds.rightX;
                return (
                  <g key={index}>
                    <line
                      x1={x - 10}
                      x2={x + 10}
                      y1={y}
                      y2={y}
                      className={styles.handleRail}
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r="12"
                      className={styles.handleHit}
                      role="slider"
                      tabIndex={0}
                      aria-label={`${boundary} control ${index + 1}`}
                      aria-valuemin={min}
                      aria-valuemax={max}
                      aria-valuenow={Number(value.toFixed(2))}
                      aria-valuetext={`${value.toFixed(1)} millimetres`}
                      data-testid={`handle-${boundary}-${index + 1}`}
                      onPointerDown={(event) =>
                        begin(
                          event,
                          { kind: "handle", boundary, index },
                          value,
                          min,
                          max,
                        )
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key !== "ArrowLeft" &&
                          event.key !== "ArrowRight"
                        )
                          return;
                        event.preventDefault();
                        const next = Math.max(
                          min,
                          Math.min(
                            max,
                            value +
                              (event.key === "ArrowLeft" ? -1 : 1) *
                                (event.shiftKey ? 1 : 0.2),
                          ),
                        );
                        onEdit(
                          setHandle(parameters, seat, boundary, index, next),
                        );
                      }}
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r="4.5"
                      className={styles.handleDot}
                    />
                    <text
                      x={
                        x +
                        (boundary === "back" || boundary === "left" ? -15 : 15)
                      }
                      y={y + 3}
                      textAnchor={
                        boundary === "back" || boundary === "left"
                          ? "end"
                          : "start"
                      }
                      className={styles.handleLabel}
                    >
                      {index + 1}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <g className={styles.tipGrip}>
          <path
            d={`M${tipX - 16},${tipY}h32m-32,0l4,-3m-4,3l4,3m28,-3l-4,-3m4,3l-4,3`}
            className={styles.tipArrow}
          />
          <circle
            cx={tipX}
            cy={tipY}
            r="16"
            className={styles.tipHit}
            role="slider"
            tabIndex={0}
            aria-label={
              view === "side"
                ? "Move tip fore and aft"
                : "Move tip left and right"
            }
            aria-valuemin={tipBounds[0]}
            aria-valuemax={tipBounds[1]}
            aria-valuenow={Number(tipPosition.toFixed(2))}
            aria-valuetext={`${tipPosition.toFixed(1)} millimetres; top stays fixed`}
            data-testid={`tip-drag-${view}`}
            onPointerDown={(event) =>
              begin(
                event,
                { kind: "tip", axis: tipAxis },
                tipPosition,
                tipBounds[0],
                tipBounds[1],
              )
            }
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                return;
              event.preventDefault();
              const value = Math.max(
                tipBounds[0],
                Math.min(
                  tipBounds[1],
                  tipPosition +
                    (event.key === "ArrowLeft" ? -1 : 1) *
                      (event.shiftKey ? 1 : 0.2),
                ),
              );
              if (value !== tipPosition)
                onEdit(placeTip(parameters, tipAxis, value));
            }}
          />
          <circle cx={tipX} cy={tipY} r="6" className={styles.tipDot} />
          <text
            x="210"
            y="283"
            textAnchor="middle"
            className={styles.tipCaption}
          >
            Drag tip · top stays fixed
          </text>
        </g>
        <text x="42" y="271" className={styles.axisText}>
          {view === "side" ? "BACK" : "LEFT / −x"}
        </text>
        <text x="380" y="271" textAnchor="end" className={styles.axisText}>
          {view === "side" ? "FRONT / +y" : "RIGHT / +x"}
        </text>
      </svg>
    </section>
  );
}
