import type { ReactNode } from "react";
import type { EditableCurve } from "~/lib/curves";
import type { TopMeasures } from "~/lib/studio/top-outline";
import styles from "./studio.module.css";

const MODE_GLYPH = { auto: "◇", smooth: "○", symmetric: "◎", corner: "□" };

function PanelHeading({ children }: { children: string }) {
  return <h3 className={styles.panelHeading}>{children}</h3>;
}

/** Document tree: pick points by name (useful when several overlap). */
export function Browser(props: {
  title: string;
  curve: EditableCurve;
  selected: number | null;
  onSelect: (i: number) => void;
  labelOf: (i: number) => string;
  toggles: readonly { label: string; on: boolean; set: (v: boolean) => void }[];
  resetLabel: string;
  onReset: () => void;
  /** Extra section (reference image) shown after Display. */
  extra?: ReactNode;
}) {
  const { curve, selected, onSelect, labelOf } = props;
  return (
    <>
      <PanelHeading>Browser</PanelHeading>
      <div className={styles.tree}>
        <div className={styles.treeGroup}>
          <span>▾ {props.title}</span>
          <em>{curve.points.length} pts</em>
        </div>
        <ul>
          {curve.points.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                data-active={i === selected || undefined}
                onClick={() => onSelect(i)}
              >
                <span className={styles.glyph} aria-hidden>
                  {MODE_GLYPH[p.mode]}
                </span>
                {labelOf(i)}
                {p.lineToNext && <em className={styles.lineTag}>line</em>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <PanelHeading>Display</PanelHeading>
      <div className={styles.toggles}>
        {props.toggles.map((t) => (
          <label key={t.label}>
            <input
              type="checkbox"
              checked={t.on}
              onChange={(e) => t.set(e.target.checked)}
            />
            {t.label}
          </label>
        ))}
      </div>
      {props.extra && (
        <>
          <PanelHeading>Reference image</PanelHeading>
          {props.extra}
        </>
      )}
      <div className={styles.treeFooter}>
        <button type="button" onClick={props.onReset}>
          {props.resetLabel}
        </button>
      </div>
    </>
  );
}

/** Live dimensions read from the curve, not stored separately. */
export function Measures({ m }: { m: TopMeasures }) {
  return (
    <section className={styles.measures}>
      <PanelHeading>Measures</PanelHeading>
      <table>
        <thead>
          <tr>
            <th />
            <th>Station</th>
            <th>Width</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Overall</th>
            <td>{m.length.toFixed(1)}</td>
            <td>{m.width.toFixed(1)}</td>
          </tr>
          {m.stations.map((s) => (
            <tr key={s.id}>
              <th>{s.label}</th>
              <td>
                {s.y.toFixed(1)} <i>{(s.ratio * 100).toFixed(0)}%</i>
              </td>
              <td>{s.width === null ? "—" : s.width.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        mm from the heel back. Stations are the mean of each medial/lateral
        landmark pair, so dragging a landmark moves its station.
      </p>
    </section>
  );
}
