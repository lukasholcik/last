import { ELEV_ROLES, RAIL_LABEL, type ElevRole } from "~/lib/studio/rails";
import { PAIR_LABEL, type PairKind } from "~/lib/studio/rail-loop";
import styles from "./studio.module.css";

/**
 * Pickers shown in the view bar. The Top view edits one outline at a time: the
 * widest outline (medial + lateral, the top outline), the sole edge (medial and
 * lateral bottom) or the upper edge (the shoulders). The Side view edits the
 * centre contour (sole + crown) or one rail's elevation, with the heel height
 * applied. Grouping the rails under the two views they belong to replaces the
 * separate Rails tab (user request).
 */
export function OutlineSelect(props: {
  value: "top" | PairKind;
  onChange: (v: "top" | PairKind) => void;
}) {
  return (
    <select
      className={styles.railSelect}
      aria-label="Outline"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as "top" | PairKind)}
    >
      <option value="top">Widest outline (top outline)</option>
      <option value="bottom">{PAIR_LABEL.bottom}</option>
      <option value="shoulder">{PAIR_LABEL.shoulder}</option>
    </select>
  );
}

export function SideCurveSelect(props: {
  value: "centre" | ElevRole;
  onChange: (v: "centre" | ElevRole) => void;
}) {
  return (
    <select
      className={styles.railSelect}
      aria-label="Curve"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as "centre" | ElevRole)}
    >
      <option value="centre">Centre contour (sole + crown)</option>
      {ELEV_ROLES.map((r) => (
        <option key={r} value={r}>
          {RAIL_LABEL[r]} rail
        </option>
      ))}
    </select>
  );
}

export function RailNote({ text }: { text: string }) {
  return (
    <section className={styles.sectionNote}>
      <p>{text}</p>
    </section>
  );
}
