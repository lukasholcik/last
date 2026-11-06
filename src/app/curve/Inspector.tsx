"use client";

import { useState, type Dispatch, type ReactNode } from "react";
import {
  POINT_MODES,
  PRESETS,
  canRemove,
  curveLength,
  hasHandle,
  kinkAngle,
  moveAnchor,
  moveHandle,
  parseCurve,
  removePoint,
  segmentCount,
  serializeCurve,
  setClosed,
  setLine,
  setMode,
  MIN_POINTS_CLOSED,
  type EditableCurve,
  type HandleSide,
  type HistoryAction,
  type PointMode,
  type Vec2,
} from "~/lib/curves";
import { len } from "~/lib/curves/vec";
import styles from "./curve.module.css";

export const MODE_INFO: Record<
  PointMode,
  { label: string; key: string; hint: string }
> = {
  auto: {
    label: "Auto",
    key: "1",
    hint: "Handles are computed from the neighbouring points. Just move the anchors; the curve stays smooth.",
  },
  smooth: {
    label: "Smooth",
    key: "2",
    hint: "Handles stay in a straight line through the point, but can have different lengths.",
  },
  symmetric: {
    label: "Symmetric",
    key: "3",
    hint: "Handles stay in a straight line and always have equal length.",
  },
  corner: {
    label: "Corner",
    key: "4",
    hint: "Handles move independently. The only mode that can make a sharp corner.",
  },
};

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function NumberField(props: {
  label: string;
  value: number | null;
  unit?: string;
  /** Shown but not editable (e.g. a driven value). */
  disabled?: boolean;
  title?: string;
  onCommit: (n: number) => void;
}) {
  const { label, value, unit, onCommit } = props;
  return (
    <label
      className={styles.field}
      data-locked={props.disabled ? true : undefined}
      title={props.title}
    >
      <span>{label}</span>
      <input
        key={value === null ? "none" : fmt(value)}
        defaultValue={value === null ? "" : fmt(value)}
        disabled={value === null || props.disabled}
        placeholder="—"
        inputMode="decimal"
        onBlur={(e) => {
          const n = Number(e.currentTarget.value);
          if (
            value !== null &&
            e.currentTarget.value.trim() !== "" &&
            Number.isFinite(n) &&
            n !== Number(fmt(value))
          )
            onCommit(n);
          else e.currentTarget.value = value === null ? "" : fmt(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = value === null ? "" : fmt(value);
            e.currentTarget.blur();
            e.stopPropagation();
          }
        }}
      />
      {unit && <em>{unit}</em>}
    </label>
  );
}

export function Section(props: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header>
        <h3>{props.title}</h3>
        {props.aside}
      </header>
      {props.children}
    </section>
  );
}

/** Mode, position and handle editing for one point; shared by the lab and the studio. */
export function PointProperties(props: {
  curve: EditableCurve;
  selected: number | null;
  dispatch: Dispatch<HistoryAction<EditableCurve>>;
  onSelect: (i: number | null) => void;
  /** Overrides the "Point N" heading, e.g. with a landmark name. */
  title?: string;
  /** Driven axes of point i, [x, y]: their fields are shown but not editable. */
  locks?: (i: number) => readonly [boolean, boolean];
  /** Whether point i may be deleted. */
  canDelete?: (i: number) => boolean;
  /** Names for the two position axes (default X / Y). */
  axisLabels?: readonly [string, string];
  /** Extra content under the position row, e.g. what drives a locked axis. */
  extra?: ReactNode;
}) {
  const { curve, selected, dispatch, onSelect } = props;
  const [lockX, lockY] =
    selected === null
      ? [false, false]
      : (props.locks?.(selected) ?? [false, false]);
  const [axisX, axisY] = props.axisLabels ?? ["X", "Y"];
  const deletable = selected === null || (props.canDelete?.(selected) ?? true);
  const commit = (next: EditableCurve) =>
    dispatch({ type: "commit", value: next });
  const point = selected === null ? null : curve.points[selected]!;
  const handleFields = (side: HandleSide) => {
    if (!point || selected === null) return null;
    const off = side === "in" ? point.handleIn : point.handleOut,
      live = hasHandle(curve, selected, side),
      length = live ? len(off) : null,
      angle = live ? (Math.atan2(off[1], off[0]) * 180) / Math.PI : null,
      apply = (l: number, deg: number) => {
        const rad = (deg * Math.PI) / 180;
        commit(
          moveHandle(curve, selected, side, [
            Math.cos(rad) * l,
            Math.sin(rad) * l,
          ]),
        );
      };
    return (
      <div className={styles.fieldRow}>
        <span className={styles.rowLabel}>
          {side === "in" ? "Handle in" : "Handle out"}
        </span>
        <NumberField
          label="Len"
          value={length}
          onCommit={(l) => apply(Math.max(0, l), angle ?? 0)}
        />
        <NumberField
          label="∠"
          unit="°"
          value={angle}
          onCommit={(a) => apply(length ?? 0, a)}
        />
      </div>
    );
  };

  const kink = selected === null ? 0 : kinkAngle(curve, selected);
  const patchPos = (axis: 0 | 1, v: number) => {
    if (!point || selected === null) return;
    const pos: Vec2 = axis === 0 ? [v, point.pos[1]] : [point.pos[0], v];
    commit(moveAnchor(curve, selected, pos));
  };

  return (
    <Section
      title={props.title ?? (point ? `Point ${selected! + 1}` : "Point")}
      aside={
        point && (
          <button
            type="button"
            className={styles.danger}
            disabled={!canRemove(curve) || !deletable}
            title={
              !deletable
                ? "This landmark is required by the model"
                : canRemove(curve)
                  ? "Delete point (Del)"
                  : "A curve needs at least " +
                    (curve.closed ? MIN_POINTS_CLOSED : 2) +
                    " points"
            }
            onClick={() => {
              commit(removePoint(curve, selected!));
              onSelect(null);
            }}
          >
            Delete
          </button>
        )
      }
    >
      {point && selected !== null ? (
        <>
          <div
            className={styles.modes}
            role="radiogroup"
            aria-label="Handle mode"
          >
            {POINT_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={point.mode === m}
                data-active={point.mode === m || undefined}
                title={`${MODE_INFO[m].label} (${MODE_INFO[m].key})`}
                onClick={() => commit(setMode(curve, selected, m))}
              >
                <kbd>{MODE_INFO[m].key}</kbd>
                {MODE_INFO[m].label}
              </button>
            ))}
          </div>
          <p className={styles.hint}>{MODE_INFO[point.mode].hint}</p>
          <div className={styles.fieldRow}>
            <span className={styles.rowLabel}>Position</span>
            <NumberField
              label={axisX}
              value={point.pos[0]}
              disabled={lockX}
              title={lockX ? "Driven: unlock it to edit" : undefined}
              onCommit={(v) => patchPos(0, v)}
            />
            <NumberField
              label={axisY}
              value={point.pos[1]}
              disabled={lockY}
              title={lockY ? "Driven: unlock it to edit" : undefined}
              onCommit={(v) => patchPos(1, v)}
            />
          </div>
          {props.extra}
          {handleFields("in")}
          {handleFields("out")}
          {hasHandle(curve, selected, "out") && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={!!point.lineToNext}
                onChange={(e) =>
                  commit(setLine(curve, selected, e.target.checked))
                }
              />
              Straight line to next point
            </label>
          )}
          <p className={styles.readout} data-warn={kink > 0.5 || undefined}>
            {hasHandle(curve, selected, "in") &&
            hasHandle(curve, selected, "out")
              ? kink > 0.5
                ? `Tangent break ${kink.toFixed(1)}° — a visible corner`
                : "Tangent continuous — no corner"
              : "Curve end — nothing to blend"}
          </p>
        </>
      ) : (
        <p className={styles.hint}>
          Select a point to change its handle mode and exact values. Press{" "}
          <kbd>P</kbd> to switch to the pen and click to add points; click on
          the curve to insert one.
        </p>
      )}
    </Section>
  );
}

export function Inspector(props: {
  curve: EditableCurve;
  selected: number | null;
  dispatch: Dispatch<HistoryAction<EditableCurve>>;
  onSelect: (i: number | null) => void;
  onLoaded: () => void;
  showComb: boolean;
  setShowComb: (v: boolean) => void;
  combGain: number;
  setCombGain: (v: number) => void;
  showAllHandles: boolean;
  setShowAllHandles: (v: boolean) => void;
  snapOn: boolean;
  setSnapOn: (v: boolean) => void;
  snapSize: number;
  setSnapSize: (v: number) => void;
}) {
  const { curve, selected, dispatch, onSelect, onLoaded } = props;
  const commit = (next: EditableCurve) =>
    dispatch({ type: "commit", value: next });
  const loadCurve = (c: EditableCurve) => {
    commit(c);
    onSelect(null);
    onLoaded();
  };

  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <PointProperties
        curve={curve}
        selected={selected}
        dispatch={dispatch}
        onSelect={onSelect}
      />

      <Section title="Curve">
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={curve.closed}
            disabled={!curve.closed && curve.points.length < MIN_POINTS_CLOSED}
            onChange={(e) => commit(setClosed(curve, e.target.checked))}
          />
          Closed loop
        </label>
        <dl className={styles.stats}>
          <div>
            <dt>Points</dt>
            <dd>{curve.points.length}</dd>
          </div>
          <div>
            <dt>Segments</dt>
            <dd>{segmentCount(curve)}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>{curveLength(curve).toFixed(1)} u</dd>
          </div>
        </dl>
        <label className={styles.select}>
          <span>Start from</span>
          <select
            value=""
            onChange={(e) => {
              const preset = PRESETS.find((p) => p.id === e.target.value);
              if (preset) loadCurve(preset.curve());
            }}
          >
            <option value="" disabled>
              Choose a preset…
            </option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="Display">
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={props.showComb}
            onChange={(e) => props.setShowComb(e.target.checked)}
          />
          Curvature comb
        </label>
        <label
          className={styles.slider}
          data-disabled={!props.showComb || undefined}
        >
          <span>Comb length</span>
          <input
            type="range"
            min={Math.log(50)}
            max={Math.log(4000)}
            step={0.05}
            disabled={!props.showComb}
            value={Math.log(props.combGain)}
            onChange={(e) =>
              props.setCombGain(Math.exp(Number(e.target.value)))
            }
          />
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={props.showAllHandles}
            onChange={(e) => props.setShowAllHandles(e.target.checked)}
          />
          Show all handles
        </label>
        <div className={styles.snapRow}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={props.snapOn}
              onChange={(e) => props.setSnapOn(e.target.checked)}
            />
            Snap to grid
          </label>
          <NumberField
            label="Step"
            value={props.snapSize}
            onCommit={(n) => props.setSnapSize(Math.max(0.1, n))}
          />
        </div>
        <p className={styles.hint}>
          Hold <kbd>Alt</kbd> while dragging to bypass snapping.
        </p>
      </Section>

      <JsonPanel curve={curve} onLoad={loadCurve} />
    </aside>
  );
}

function JsonPanel(props: {
  curve: EditableCurve;
  onLoad: (c: EditableCurve) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={styles.json}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Import / export JSON</summary>
      {open && <JsonBody key={serializeCurve(props.curve)} {...props} />}
    </details>
  );
}

function JsonBody({
  curve,
  onLoad,
}: {
  curve: EditableCurve;
  onLoad: (c: EditableCurve) => void;
}) {
  const initial = serializeCurve(curve);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <textarea
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        rows={10}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.buttonRow}>
        <button
          type="button"
          disabled={text === initial}
          onClick={() => {
            try {
              onLoad(parseCurve(text));
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not load");
            }
          }}
        >
          Load
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(initial)}
        >
          Copy
        </button>
      </div>
    </>
  );
}
