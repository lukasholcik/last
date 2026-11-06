import styles from "./curve.module.css";
import { gridStep, toScreen, toWorld, type Size, type View } from "./view";

export const RULER_PX = 20;

/** Top and left rulers; labels every 5th tick of the adaptive grid step. */
export function Rulers({ view, size }: { view: View; size: Size }) {
  const step = gridStep(view.scale, 14),
    [x0, y1] = toWorld(view, size, [0, 0]),
    [x1, y0] = toWorld(view, size, [size.width, size.height]);
  const ticks: { v: number; px: number; major: boolean }[][] = [[], []];
  for (let k = Math.ceil(x0 / step); k * step <= x1; k++)
    ticks[0]!.push({
      v: k * step,
      px: toScreen(view, size, [k * step, 0])[0],
      major: k % 5 === 0,
    });
  for (let k = Math.ceil(y0 / step); k * step <= y1; k++)
    ticks[1]!.push({
      v: k * step,
      px: toScreen(view, size, [0, k * step])[1],
      major: k % 5 === 0,
    });
  const label = (v: number) => String(Math.round(v * 1000) / 1000);
  return (
    <svg
      className={styles.rulers}
      width={size.width}
      height={size.height}
      aria-hidden
    >
      <rect width={size.width} height={RULER_PX} className={styles.rulerBg} />
      <rect width={RULER_PX} height={size.height} className={styles.rulerBg} />
      {ticks[0]!.map((t) => (
        <g key={`x${t.v}`}>
          <line
            x1={t.px}
            x2={t.px}
            y1={t.major ? 6 : 13}
            y2={RULER_PX}
            className={styles.rulerTick}
          />
          {t.major && t.px > RULER_PX + 12 && (
            <text x={t.px + 3} y={11} className={styles.rulerText}>
              {label(t.v)}
            </text>
          )}
        </g>
      ))}
      {ticks[1]!.map((t) => (
        <g key={`y${t.v}`}>
          <line
            y1={t.px}
            y2={t.px}
            x1={t.major ? 6 : 13}
            x2={RULER_PX}
            className={styles.rulerTick}
          />
          {t.major && t.px > RULER_PX + 12 && (
            <text
              transform={`translate(11 ${t.px - 3}) rotate(-90)`}
              className={styles.rulerText}
            >
              {label(t.v)}
            </text>
          )}
        </g>
      ))}
      <rect width={RULER_PX} height={RULER_PX} className={styles.rulerCorner} />
    </svg>
  );
}
