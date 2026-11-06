import type { Projection } from "../curve/CurveCanvas";
import { sampleCurve, type EditableCurve, type Vec2 } from "~/lib/curves";
import type { PosedContext } from "~/lib/studio/side";
import styles from "./studio.module.css";

const path = (t: Projection, pts: readonly Vec2[]) =>
  pts
    .map((p, i) => {
      const q = t.toScreen(p);
      return `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
    })
    .join("");

/**
 * Side-view construction geometry: ground, stations, dimensions and a soft fill
 * of the closed contour. The contour itself is drawn by the canvas on top.
 */
export function SideGuides(props: {
  t: Projection;
  ctx: PosedContext;
  bottom: EditableCurve;
  /** The closed side contour (sole + posed upper) being edited. */
  contour: EditableCurve | null;
  /** Read-only rails already mapped into the posed side view. */
  rails?: readonly { role: string; posed: readonly Vec2[] }[];
  /** Where the sections meet the rail being edited (posed). */
  marks?: readonly Vec2[];
  /** The top cut as height over the posed station (read-only dashed line), or null. */
  cutLine?: ((y: number) => number) | null;
}) {
  const { t, ctx, bottom, contour, rails, marks, cutLine } = props,
    w = t.size.width,
    pose = ctx.pose,
    H = ctx.params.heelHeight,
    T = ctx.params.toeSpring,
    at = (role: string) => bottom.points.find((p) => p.role === role)?.pos,
    seat = at("seat_front"),
    contact = at("contact"),
    toe = at("toe_end"),
    heel = at("heel_rear"),
    ground = t.toScreen([0, 0])[1],
    stations: { x: number; label: string }[] = [
      ...(seat
        ? [{ x: seat[0], label: `SEAT END · S ${ctx.params.seatLength}` }]
        : []),
      ...(contact ? [{ x: contact[0], label: "CONTACT" }] : []),
    ];
  const dimX = t.toScreen([-14, 0])[0];
  return (
    <g className={styles.guides}>
      <line x1={0} x2={w} y1={ground} y2={ground} className={styles.ground} />
      <text x={10} y={ground + 14} className={styles.guideLabel}>
        GROUND · z 0
      </text>

      {cutLine && (
        <g>
          <line
            x1={t.toScreen([-30, cutLine(-30)])[0]}
            y1={t.toScreen([-30, cutLine(-30)])[1]}
            x2={t.toScreen([ctx.length + 20, cutLine(ctx.length + 20)])[0]}
            y2={t.toScreen([ctx.length + 20, cutLine(ctx.length + 20)])[1]}
            className={styles.ground}
            strokeDasharray="8 5"
          />
          <text
            x={t.toScreen([-30, cutLine(-30)])[0] + 6}
            y={t.toScreen([-30, cutLine(-30)])[1] - 6}
            className={styles.guideLabel}
          >
            TOP CUT · everything above is removed
          </text>
        </g>
      )}
      {rails?.map((r) => (
        <path key={r.role} className={styles.rail} d={path(t, r.posed)} />
      ))}
      {marks?.map((m, i) => {
        const q = t.toScreen(m);
        return (
          <circle
            key={i}
            cx={q[0]}
            cy={q[1]}
            r={3.5}
            className={styles.railDot}
          />
        );
      })}

      {/* Soft fill of the closed contour, under the editable curve. */}
      {contour && (
        <path
          d={path(t, sampleCurve(contour, 24)) + "Z"}
          className={styles.contourFill}
        />
      )}
      {stations.map((s) => {
        const x = t.toScreen([s.x, 0])[0];
        return (
          <g key={s.label}>
            <line
              x1={x}
              x2={x}
              y1={0}
              y2={t.size.height}
              className={styles.station}
            />
            <text x={x + 5} y={38} className={styles.guideLabel}>
              {s.label}
            </text>
          </g>
        );
      })}
      {/* reference (flat) stations the allowance map is anchored to */}
      {[
        {
          x: ctx.ballStation,
          label: `BALL A · ${ctx.ballStation.toFixed(0)} (reference)`,
        },
      ].map((s) => {
        const x = t.toScreen([s.x, 0])[0];
        return (
          <g key={s.label}>
            <line
              x1={x}
              x2={x}
              y1={0}
              y2={t.size.height}
              className={styles.centre}
            />
            <text x={x + 5} y={52} className={styles.guideLabel}>
              {s.label}
            </text>
          </g>
        );
      })}

      {/* dimensions */}
      {heel && (
        <Dimension
          x1={dimX}
          y1={ground}
          y2={t.toScreen([0, H])[1]}
          label={`H ${H}`}
        />
      )}
      {toe && (
        <Dimension
          x1={t.toScreen([toe[0] + 8, 0])[0]}
          y1={ground}
          y2={t.toScreen([0, T])[1]}
          label={`T ${T}`}
        />
      )}
      {pose.ok && (
        <text
          x={w - 12}
          y={t.size.height - 12}
          textAnchor="end"
          className={styles.guideLabel}
        >
          θ {((pose.theta * 180) / Math.PI).toFixed(1)}° · δ +
          {pose.allowance.toFixed(2)} mm
        </text>
      )}
    </g>
  );
}

function Dimension(props: {
  x1: number;
  y1: number;
  y2: number;
  label: string;
}) {
  const { x1, y1, y2 } = props;
  return (
    <g className={styles.dim}>
      <line x1={x1} x2={x1} y1={y1} y2={y2} />
      <line x1={x1 - 4} x2={x1 + 4} y1={y1} y2={y1} />
      <line x1={x1 - 4} x2={x1 + 4} y1={y2} y2={y2} />
      <text x={x1 + 7} y={(y1 + y2) / 2 + 3} className={styles.guideLabel}>
        {props.label}
      </text>
    </g>
  );
}
