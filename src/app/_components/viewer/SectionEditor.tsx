import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  editCrossSection,
  editCrossSectionFrame,
  resolveCrossSections,
  splitMidfoot,
} from "~/lib/geometry/cross-sections";
import type {
  CrossSectionAnchorId,
  CrossSectionId,
  ResolvedCrossSection,
} from "~/lib/geometry/section-types";
import type {
  FootFirstInput,
  Last2DGeometry,
  Vec2,
} from "~/lib/geometry/types";
import type { ShapeGesture } from "./editable-2d";
import type { ShapeEditingProps } from "./ProfileHandles";
import { fmt } from "./state";
import styles from "./SectionEditor.module.css";

type Control = {
  anchor: CrossSectionAnchorId;
  kind: "point" | "incoming" | "outgoing";
};
interface Props extends Pick<
  ShapeEditingProps,
  | "enabled"
  | "version"
  | "dragging"
  | "onBegin"
  | "onPreview"
  | "onFinish"
  | "onCancel"
> {
  geometry: Last2DGeometry | null;
  editable: Last2DGeometry | null;
  selected: CrossSectionId;
  onSelect: (id: CrossSectionId) => void;
  onMessage: (message: string) => void;
}
interface Drag extends ShapeGesture {
  pointerId: number;
  element: SVGCircleElement;
  control: Control;
  section: CrossSectionId;
  inverse: DOMMatrix;
  initial: Vec2;
  start: Vec2;
}

export function SectionEditor(props: Props) {
  const {
    geometry,
    editable,
    selected,
    onSelect,
    enabled,
    dragging,
    version,
    onBegin,
    onPreview,
    onFinish,
    onCancel,
    onMessage,
  } = props;
  const [anchorId, setAnchorId] = useState<CrossSectionAnchorId>("dorsal");
  const drag = useRef<Drag | null>(null);
  const release = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    if (active?.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    return active;
  }, []);
  const cancel = useCallback(() => {
    const active = release();
    if (active) onCancel(active.token);
  }, [onCancel, release]);
  useEffect(() => {
    cancel();
  }, [version, cancel]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        cancel();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      cancel();
    };
  }, [cancel]);
  if (!geometry || !editable) return null;
  const sections = resolveCrossSections(geometry),
    stable = resolveCrossSections(editable);
  const activeSection = sections.find((s) => s.id === selected);
  const report = (error: unknown) =>
    onMessage(
      error instanceof Error ? error.message : "Section edit not applied.",
    );
  function apply(make: (g: Last2DGeometry) => FootFirstInput) {
    if (!enabled || dragging) return;
    const gesture = onBegin();
    if (!gesture) return;
    try {
      onFinish(gesture.token, make(gesture.geometry), "Section updated");
    } catch (error) {
      onCancel(gesture.token);
      report(error);
    }
  }
  function target(event: PointerEvent<SVGCircleElement>, active: Drag): Vec2 {
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      active.inverse,
    );
    const value: Vec2 = [
      active.initial[0] + p.x - active.start[0],
      active.initial[1] - p.y + active.start[1],
    ];
    if (active.control.anchor === "dorsal" && active.control.kind === "point")
      value[0] = 0;
    return value;
  }
  function update(event: PointerEvent<SVGCircleElement>, finish: boolean) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    event.preventDefault();
    try {
      const value = target(event, active);
      if (
        finish &&
        Math.hypot(value[0] - active.initial[0], value[1] - active.initial[1]) <
          0.05
      ) {
        cancel();
        return;
      }
      const input = editCrossSection(
        active.geometry,
        active.section,
        active.control,
        value,
      );
      if (finish) {
        release();
        onFinish(active.token, input, "Section updated");
      } else onPreview(active.token, input);
    } catch (error) {
      if (finish) cancel();
      report(error);
    }
  }
  function controls(section: ResolvedCrossSection, bottom: number) {
    return section.anchors.flatMap((anchor) => {
      const kinds =
        section.id === selected && anchor.id === anchorId
          ? (["point", "incoming", "outgoing"] as const)
          : (["point"] as const);
      return kinds.map((kind) => {
        const p = anchor[kind],
          control: Control = { anchor: anchor.id, kind };
        const locked = kind === "point" && anchor.id === "plantar";
        return (
          <g key={`${anchor.id}-${kind}`}>
            {kind !== "point" && (
              <line
                x1={anchor.point[0]}
                y1={bottom - anchor.point[1]}
                x2={p[0]}
                y2={bottom - p[1]}
                className={styles.link}
              />
            )}
            <circle
              cx={p[0]}
              cy={bottom - p[1]}
              r={kind === "point" ? 2 : 1.6}
              className={`${styles.control} ${kind !== "point" ? styles.handle : ""}`}
              data-section-control={`${section.id}:${anchor.id}:${kind}`}
              role="button"
              tabIndex={enabled ? 0 : -1}
              aria-disabled={!enabled || locked}
              aria-label={`${section.label}, ${anchor.label} ${kind}${locked ? ". Shared bottom constraint; edit profile instead" : ". Drag or use arrow keys"}`}
              onFocus={() => {
                onSelect(section.id);
                setAnchorId(anchor.id);
              }}
              onPointerDown={(event) => {
                onSelect(section.id);
                setAnchorId(anchor.id);
                if (!enabled || locked || event.button !== 0 || drag.current)
                  return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.focus();
                const gesture = onBegin();
                if (!gesture) return;
                const matrix =
                  event.currentTarget.ownerSVGElement?.getScreenCTM();
                if (!matrix) {
                  onCancel(gesture.token);
                  return;
                }
                const inverse = matrix.inverse(),
                  start = new DOMPoint(
                    event.clientX,
                    event.clientY,
                  ).matrixTransform(inverse);
                const fresh = resolveCrossSections(gesture.geometry)
                  .find((s) => s.id === section.id)!
                  .anchors.find((a) => a.id === anchor.id)!;
                drag.current = {
                  ...gesture,
                  pointerId: event.pointerId,
                  element: event.currentTarget,
                  control,
                  section: section.id,
                  inverse,
                  initial: fresh[kind],
                  start: [start.x, start.y],
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => update(event, false)}
              onPointerUp={(event) => update(event, true)}
              onPointerCancel={cancel}
              onLostPointerCapture={cancel}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  cancel();
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(section.id);
                  setAnchorId(anchor.id);
                  return;
                }
                if (
                  !enabled ||
                  dragging ||
                  locked ||
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const step = event.shiftKey ? 5 : event.altKey ? 0.1 : 1;
                apply((g) => {
                  const current = resolveCrossSections(g)
                    .find((s) => s.id === section.id)!
                    .anchors.find((a) => a.id === anchor.id)![kind];
                  const next: Vec2 = [
                    current[0] +
                      (event.key === "ArrowLeft"
                        ? -step
                        : event.key === "ArrowRight"
                          ? step
                          : 0),
                    current[1] +
                      (event.key === "ArrowDown"
                        ? -step
                        : event.key === "ArrowUp"
                          ? step
                          : 0),
                  ];
                  if (kind === "point" && anchor.id === "dorsal") next[0] = 0;
                  return editCrossSection(g, section.id, control, next);
                });
              }}
            >
              <title>
                {locked
                  ? "Shared bottom · edit profile"
                  : `${anchor.label} ${kind}`}
              </title>
            </circle>
          </g>
        );
      });
    });
  }
  return (
    <section
      className={`drawing-panel ${styles.panel}`}
      aria-label="Face-on section editor"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SECTIONS / LIVE 2D</span>
          <h2>Across the last.</h2>
        </div>
        {!geometry.inputs.cross_sections?.split_midfoot && (
          <button
            type="button"
            disabled={!enabled || dragging}
            onClick={() => apply(splitMidfoot)}
          >
            Split midfoot
          </button>
        )}
      </div>
      <div className={styles.strip}>
        {/* eslint-disable-next-line react-hooks/refs -- controls only reads gesture refs inside event callbacks, not during render. */}
        {sections.map((section) => {
          const fixed = stable.find((s) => s.id === section.id) ?? section;
          const span = Math.max(fixed.width, fixed.height, 40) + 22,
            bottom = span - 10;
          return (
            <div
              key={section.id}
              className={styles.card}
              data-selected={section.id === selected}
            >
              <button
                type="button"
                className={styles.name}
                aria-pressed={section.id === selected}
                disabled={dragging}
                onClick={() => onSelect(section.id)}
              >
                {section.label}
              </button>
              <svg
                viewBox={`${-span / 2} 0 ${span} ${span}`}
                aria-label={`${section.label}, equal scale local face-on view`}
              >
                <line
                  x1={-span / 2 + 5}
                  x2={span / 2 - 5}
                  y1={bottom}
                  y2={bottom}
                  className={styles.axis}
                />
                <line
                  x1={0}
                  x2={0}
                  y1={8}
                  y2={bottom + 3}
                  className={styles.axis}
                />
                <text x={-span / 2 + 5} y={7}>
                  M
                </text>
                <text x={span / 2 - 10} y={7}>
                  L
                </text>
                <text x={3} y={15}>
                  ↑ up
                </text>
                {section.cubics.length ? (
                  <path
                    className={styles.curve}
                    d={
                      `M ${section.cubics[0]![0][0]} ${bottom - section.cubics[0]![0][1]} ` +
                      section.cubics
                        .map(
                          (c) =>
                            `C ${c
                              .slice(1)
                              .map((p) => `${p[0]} ${bottom - p[1]}`)
                              .join(" ")}`,
                        )
                        .join(" ") +
                      " Z"
                    }
                  />
                ) : (
                  <circle
                    cx={section.samples[0]![0]}
                    cy={bottom}
                    r={2}
                    fill="currentColor"
                  />
                )}
                {controls(section, bottom)}
              </svg>
              <p>
                {section.id === "toe_end"
                  ? "Endpoint · edit top / profile"
                  : `${fmt(section.width)} × ${fmt(section.height)} mm`}
              </p>
              {section.id !== "toe_end" && (
                <small>Perimeter {fmt(section.perimeter)} mm</small>
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.footer}>
        {activeSection && activeSection.id !== "toe_end" ? (
          <>
            <span>
              {activeSection.label} · s {fmt(activeSection.referenceStation)} mm
            </span>
            <div
              role="group"
              aria-label="Selected section frame"
              className={styles.frame}
            >
              <span>Location</span>
              {[-1, 1].map((direction) => (
                <button
                  key={direction}
                  type="button"
                  disabled={!enabled || dragging}
                  aria-label={`Move section ${direction < 0 ? "rearward" : "forward"} 1 mm`}
                  onClick={() =>
                    apply((g) =>
                      editCrossSectionFrame(g, selected, {
                        stationOffsetRatio:
                          (g.inputs.cross_sections?.sections?.[selected]
                            ?.station_offset_ratio ?? 0) +
                          direction / g.inputs.foot.length,
                      }),
                    )
                  }
                >
                  {direction < 0 ? "−" : "+"}
                </button>
              ))}
              <span>
                Tilt{" "}
                {fmt(
                  geometry.inputs.cross_sections?.sections?.[selected]
                    ?.tilt_deg ?? 0,
                )}
                °
              </span>
              {[-1, 1].map((direction) => (
                <button
                  key={direction}
                  type="button"
                  disabled={!enabled || dragging}
                  aria-label={`Tilt section ${direction > 0 ? "+" : "−"}1 degree`}
                  onClick={() =>
                    apply((g) =>
                      editCrossSectionFrame(g, selected, {
                        tiltDeg:
                          (g.inputs.cross_sections?.sections?.[selected]
                            ?.tilt_deg ?? 0) + direction,
                      }),
                    )
                  }
                >
                  {direction < 0 ? "−" : "+"}
                </button>
              ))}
              <button
                type="button"
                disabled={!enabled || dragging}
                onClick={() =>
                  apply((g) =>
                    editCrossSectionFrame(g, selected, {
                      stationOffsetRatio: 0,
                      tiltDeg: 0,
                    }),
                  )
                }
              >
                Reset frame
              </button>
            </div>
          </>
        ) : (
          <span>Toe termination is a boundary, not a circumference ring.</span>
        )}
        <small>
          Equal axis scale · select a point for independent handles · arrows
          nudge · Esc cancels
        </small>
      </div>
    </section>
  );
}
