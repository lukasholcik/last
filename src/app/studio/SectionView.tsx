import { sampleCurve, type EditableCurve } from "~/lib/curves";
import {
  SECTION_IDS,
  SECTION_LABEL,
  sectionGirth,
  type SectionGeometry,
  type SectionId,
} from "~/lib/studio/section";
import type { Projection } from "../curve/CurveCanvas";
import styles from "./studio.module.css";

const poly = (t: Projection, c: EditableCurve) =>
  sampleCurve(c, 24)
    .map((p, i) => {
      const q = t.toScreen(p);
      return `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
    })
    .join("");

/**
 * Section construction geometry: ground, the centre plane the side view shows,
 * the width, and the other sections drawn faint in the same (u, z) frame so
 * their sizes can be compared. The edited section is drawn by the canvas.
 */
export function SectionGuides(props: {
  t: Projection;
  g: SectionGeometry;
  sections: Record<SectionId, EditableCurve>;
}) {
  const { t, g } = props,
    ground = t.toScreen([0, 0])[1],
    xm = t.toScreen([0, 0])[0],
    xl = t.toScreen([g.width, 0])[0],
    xc = g.centreU === null ? null : t.toScreen([g.centreU, 0])[0];
  return (
    <g className={styles.guides}>
      {SECTION_IDS.filter((id) => id !== g.id).map((id) => (
        <path
          key={id}
          d={poly(t, props.sections[id]) + "Z"}
          className={styles.ghostLine}
          fill="none"
        />
      ))}
      <line
        x1={0}
        x2={t.size.width}
        y1={ground}
        y2={ground}
        className={styles.ground}
      />
      <text x={10} y={ground + 14} className={styles.guideLabel}>
        SOLE · z 0
      </text>
      {[xm, xl].map((x, i) => (
        <g key={i}>
          <line
            x1={x}
            x2={x}
            y1={0}
            y2={t.size.height}
            className={styles.station}
          />
          <text x={x + 5} y={38} className={styles.guideLabel}>
            {i ? "LATERAL EDGE" : "MEDIAL EDGE"}
          </text>
        </g>
      ))}
      {xc !== null && (
        <g>
          <line
            x1={xc}
            x2={xc}
            y1={0}
            y2={t.size.height}
            className={styles.centre}
          />
          <text x={xc + 5} y={52} className={styles.guideLabel}>
            CENTRE PLANE
          </text>
        </g>
      )}
    </g>
  );
}

/** Station buttons above the canvas. */
export function SectionTabs(props: {
  value: SectionId;
  onChange: (id: SectionId) => void;
}) {
  return (
    <div className={styles.segment} role="group" aria-label="Section">
      {SECTION_IDS.map((id) => (
        <button
          key={id}
          type="button"
          data-active={id === props.value || undefined}
          onClick={() => props.onChange(id)}
        >
          {SECTION_LABEL[id]}
        </button>
      ))}
    </div>
  );
}

/** Read-only facts about the current section: all derived, none editable here. */
export function SectionInfo(props: {
  g: SectionGeometry | null;
  curve: EditableCurve;
}) {
  const { g } = props;
  if (!g)
    return (
      <p className={styles.sectionNote}>
        This section needs its medial and lateral landmarks on the top outline.
      </p>
    );
  const rows: [string, string, string][] = [
    ["Station", g.station.toFixed(1), "mean y of the two landmarks"],
    ["Width W", g.width.toFixed(1), "along the cut"],
    [
      "Tilt",
      `${g.tiltDeg.toFixed(1)}°`,
      "cut vs the x axis (+ lateral end toward the toe)",
    ],
    [
      "Crown",
      g.crownHeight === null ? "—" : g.crownHeight.toFixed(1),
      "flat upper height at the centre plane",
    ],
    [
      "Girth",
      sectionGirth(props.curve).toFixed(1),
      "perimeter as drawn, a check only",
    ],
  ];
  return (
    <section className={styles.measures}>
      <h3 className={styles.panelHeading}>Section · {SECTION_LABEL[g.id]}</h3>
      <table>
        <tbody>
          {rows.map(([k, v, why]) => (
            <tr key={k} title={why}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {g.centreU === null && (
        <p className={styles.sectionNote}>
          The cut does not cross the centre plane, so the crown is not driven.
        </p>
      )}
    </section>
  );
}
