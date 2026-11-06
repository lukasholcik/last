import type { Projection } from "../curve/CurveCanvas";
import type { Vec2 } from "~/lib/curves";
import type { TopMeasures } from "~/lib/studio/top-outline";
import styles from "./studio.module.css";

/** Plan-view construction geometry: centreline, extents and landmark stations. */
export function TopGuides({
  t,
  m,
  cuts,
  active,
  rails,
}: {
  t: Projection;
  m: TopMeasures;
  /** Section cut lines (medial landmark → lateral landmark). */
  cuts?: readonly { id: string; a: Vec2; b: Vec2 }[];
  active?: string;
  /** Read-only rails (plan samples) drawn as guides. */
  rails?: readonly { role: string; plan: readonly Vec2[] }[];
}) {
  const { size } = t,
    top = t.toScreen([0, m.yMax])[1],
    bottom = t.toScreen([0, m.yMin])[1],
    cx = t.toScreen([0, 0])[0],
    labelX = size.width - 12;
  return (
    <g className={styles.guides}>
      <line x1={cx} x2={cx} y1={0} y2={size.height} className={styles.centre} />
      {rails?.map((r) => (
        <path
          key={r.role}
          className={styles.rail}
          d={r.plan
            .map((p, i) => {
              const q = t.toScreen(p);
              return `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
            })
            .join("")}
        />
      ))}
      {cuts?.map((c) => {
        const a = t.toScreen(c.a),
          b = t.toScreen(c.b);
        return (
          <line
            key={c.id}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            className={styles.cutLine}
            data-active={c.id === active || undefined}
          />
        );
      })}
      {[m.yMin, m.yMax].map((y) => {
        const py = t.toScreen([0, y])[1];
        return (
          <line
            key={y}
            x1={0}
            x2={size.width}
            y1={py}
            y2={py}
            className={styles.extent}
          />
        );
      })}
      <text
        x={labelX}
        y={top - 6}
        className={styles.guideLabel}
        textAnchor="end"
      >
        TOE · {m.length.toFixed(1)} mm
      </text>
      <text
        x={labelX}
        y={bottom - 6}
        className={styles.guideLabel}
        textAnchor="end"
      >
        HEEL · 0
      </text>
      {m.stations.map((s) => {
        const py = t.toScreen([0, s.y])[1];
        return (
          <g key={s.id}>
            <line
              x1={0}
              x2={size.width}
              y1={py}
              y2={py}
              className={styles.station}
            />
            <text
              x={labelX}
              y={py - 6}
              className={styles.guideLabel}
              textAnchor="end"
            >
              {s.label.toUpperCase()} · {(s.ratio * 100).toFixed(0)}% ·{" "}
              {s.y.toFixed(0)} mm
            </text>
          </g>
        );
      })}
    </g>
  );
}
