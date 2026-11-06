import { useRef, type Dispatch } from "react";
import type { HistoryAction } from "~/lib/curves";
import {
  withParams,
  withUnlocked,
  type StudioDoc,
} from "~/lib/studio/document";
import type {
  Diagnostic,
  Drive,
  SideContext,
  SideParams,
} from "~/lib/studio/side";
import { NumberField, Section } from "../curve/Inspector";
import styles from "./studio.module.css";
import curveStyles from "../curve/curve.module.css";

const HEEL_PRESETS: { label: string; patch: Partial<SideParams> }[] = [
  // DECISION: "Flat" also zeroes the seat offset. H = 0 with a positive offset
  // puts the seat below ground (reported, never auto-repaired), so the preset
  // sets both and the field visibly changes.
  { label: "Flat", patch: { heelHeight: 0, seatOffsetDeg: 0 } },
  { label: "8", patch: { heelHeight: 8 } },
  { label: "25", patch: { heelHeight: 25 } },
  { label: "50", patch: { heelHeight: 50 } },
  { label: "80", patch: { heelHeight: 80 } },
];

type DocDispatch = Dispatch<HistoryAction<StudioDoc>>;

/** Heel height, toe spring, seat length and the pose read-out. */
export function SideParameters(props: {
  doc: StudioDoc;
  ctx: SideContext | { error: string };
  dispatch: DocDispatch;
}) {
  const { doc, ctx, dispatch } = props,
    p = doc.params,
    sliding = useRef(false),
    commit = (patch: Partial<SideParams>) =>
      dispatch({ type: "commit", value: withParams(doc, patch) });
  const valid = !("error" in ctx),
    maxHeel = valid
      ? ctx.ballStation + ctx.params.radiusRatio * ctx.length - 0.5
      : 120,
    deg = (r: number) => ((r * 180) / Math.PI).toFixed(2);
  return (
    <Section title="Pose">
      <div
        className={styles.presets}
        role="group"
        aria-label="Heel height presets"
      >
        <span>Heel</span>
        {HEEL_PRESETS.map((h) => (
          <button
            key={h.label}
            type="button"
            data-active={
              p.heelHeight === (h.patch.heelHeight ?? -1) || undefined
            }
            onClick={() => commit(h.patch)}
          >
            {h.label}
          </button>
        ))}
      </div>
      <label className={curveStyles.slider}>
        <span>
          Heel height {p.heelHeight} mm — drag to sweep flat → elevated
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(maxHeel))}
          step={1}
          value={p.heelHeight}
          onPointerDown={() => (sliding.current = true)}
          onChange={(e) => {
            const value = withParams(doc, {
              heelHeight: Number(e.target.value),
            });
            dispatch({ type: sliding.current ? "preview" : "commit", value });
          }}
          onPointerUp={() => {
            sliding.current = false;
            dispatch({ type: "finish" });
          }}
          onBlur={() => {
            sliding.current = false;
            dispatch({ type: "finish" });
          }}
        />
      </label>
      <div className={styles.paramGrid}>
        <NumberField
          label="Heel"
          unit="mm"
          value={p.heelHeight}
          onCommit={(v) => commit({ heelHeight: Math.max(0, v) })}
        />
        <NumberField
          label="Toe"
          unit="mm"
          value={p.toeSpring}
          onCommit={(v) => commit({ toeSpring: Math.max(0, v) })}
        />
        <NumberField
          label="Seat"
          unit="mm"
          value={p.seatLength}
          onCommit={(v) => commit({ seatLength: Math.max(1, v) })}
        />
        <NumberField
          label="Blend"
          unit="mm"
          value={p.blendLength}
          onCommit={(v) => commit({ blendLength: Math.max(1, v) })}
        />
        <NumberField
          label="Radius"
          unit="%L"
          value={Math.round(p.radiusRatio * 1000) / 10}
          onCommit={(v) => commit({ radiusRatio: Math.max(0, v) / 100 })}
        />
        <NumberField
          label="Offset"
          unit="°"
          value={p.seatOffsetDeg}
          onCommit={(v) => commit({ seatOffsetDeg: v })}
        />
      </div>
      {valid && ctx.pose.ok && (
        <dl className={styles.derived}>
          <div>
            <dt>Length L</dt>
            <dd>{ctx.length.toFixed(1)}</dd>
            <i>from Top</i>
          </div>
          <div>
            <dt>Ball A</dt>
            <dd>{ctx.ballStation.toFixed(1)}</dd>
            <i>from Top · medial ball</i>
          </div>
          <div>
            <dt>Hinge θ</dt>
            <dd>{deg(ctx.pose.theta)}°</dd>
            <i>from H, A, radius</i>
          </div>
          <div>
            <dt>Allowance δ</dt>
            <dd>{ctx.pose.allowance.toFixed(2)}</dd>
            <i>r · θ</i>
          </div>
          <div>
            <dt>Rear angle</dt>
            <dd>{deg(ctx.pose.seatAngle)}°</dd>
            <i>θ + offset</i>
          </div>
        </dl>
      )}
    </Section>
  );
}

export function Diagnostics({ items }: { items: readonly Diagnostic[] }) {
  const icon = { ok: "✓", warn: "!", error: "✕" } as const,
    problems = items.filter((d) => d.level !== "ok").length,
    failed = items.some((d) => d.level === "error");
  return (
    // Opens itself when something needs attention; remounts when that flips.
    <details
      key={problems ? "problem" : "ok"}
      className={styles.checkBox}
      open={problems > 0}
    >
      <summary data-level={failed ? "error" : problems ? "warn" : "ok"}>
        Checks ·{" "}
        {problems
          ? `${problems} need${problems === 1 ? "s" : ""} attention`
          : `all ${items.length} satisfied`}
      </summary>
      <ul className={styles.checks}>
        {items.map((d, i) => (
          <li key={i} data-level={d.level}>
            <b aria-hidden>{icon[d.level]}</b>
            {d.text}
          </li>
        ))}
      </ul>
      {failed && (
        <p className={curveStyles.hint}>
          While a check fails the side geometry keeps its last valid shape.
        </p>
      )}
    </details>
  );
}

/** What drives each axis of the selected point, with an unlock switch. */
export function DriveChips(props: {
  role: string | undefined;
  drives: readonly Drive[];
  doc: StudioDoc;
  dispatch: DocDispatch;
  /** Axis names, [x, y]. */
  axes: readonly [string, string];
}) {
  const mine = props.drives.filter((d) => d.role === props.role);
  if (!mine.length) return null;
  return (
    <ul className={styles.chips}>
      {mine.map((d) => {
        const open = props.doc.unlocked.includes(d.id);
        return (
          <li key={d.id} data-open={open || undefined}>
            <span>
              <b>{props.axes[d.axis]}</b>{" "}
              {open ? "overridden by hand" : d.source}
            </span>
            <button
              type="button"
              onClick={() =>
                props.dispatch({
                  type: "commit",
                  value: withUnlocked(props.doc, d.id, !open),
                })
              }
            >
              {open ? "Lock" : "Unlock"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
