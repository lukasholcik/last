import type {
  BottomModel,
  BottomPoint,
  LastState,
  TopModel,
  TopPoint,
} from "~/lib/geometry/types";
import { fmt } from "./state";

interface Props {
  result: LastState | null;
  construction: boolean;
  onConstruction: (show: boolean) => void;
  selection: string | null;
  onSelect: (label: string) => void;
  viewLabel: string;
}

function Guides({
  result,
  construction,
  onSelect,
}: Pick<Props, "result" | "construction" | "onSelect">) {
  if (!result)
    return <svg id="drawing" role="img" aria-label="No rebuilt guides yet" />;
  const { top, bottom } = result.models;
  const pts = Object.values(top.points),
    bpts = Object.values(bottom.points);
  const yMin = Math.min(0, ...pts.map((p) => p.y), ...bpts.map((p) => p.y)),
    yMax = Math.max(...pts.map((p) => p.y), ...bpts.map((p) => p.y));
  const xMin = Math.min(...pts.map((p) => p.x)),
    xMax = Math.max(...pts.map((p) => p.x));
  const zMin = Math.min(0, ...bpts.map((p) => p.z)),
    zMax = Math.max(0, ...bpts.map((p) => p.z));
  const left = 16 - yMin,
    width = yMax - yMin + 32,
    topBase = 23 - xMin,
    bottomBase = topBase + xMax + 40 + zMax;
  const height = bottomBase - zMin + 19;
  function draw<P extends TopPoint | BottomPoint>(
    model: {
      points: Record<string, P>;
      curves: TopModel["curves"];
      reference_lines: BottomModel["reference_lines"];
    },
    names: string[],
    type: "top" | "bottom",
    transform: (p: P) => [number, number],
  ) {
    const point = (name: string) => transform(model.points[name]!).join(" ");
    const start = model.curves[names[0]!]!.start;
    const d =
      `M ${point(start)} ` +
      names
        .map((n) => {
          const c = model.curves[n]!;
          return `C ${point(c.control1)} ${point(c.control2)} ${point(c.end)}`;
        })
        .join(" ") +
      (type === "top" ? " Z" : "");
    return (
      <g key={type}>
        <path
          d={d}
          className={`guide-${type}`}
          strokeWidth={0.65}
          strokeLinejoin="round"
          data-guide={type}
        />
        {construction && (
          <>
            {Object.entries(model.reference_lines).map(([name, r]) => (
              <path
                key={name}
                d={`M ${point(r.start)} L ${point(r.end)}`}
                className="construction"
              >
                <title>{name}</title>
              </path>
            ))}
            {Object.entries(model.curves).map(([name, c]) => (
              <path
                key={name}
                d={`M ${point(c.start)} L ${point(c.control1)} L ${point(c.control2)} L ${point(c.end)}`}
                className="construction"
              >
                <title>{name} control polygon</title>
              </path>
            ))}
            {Object.entries(model.points).map(([name, p]) => {
              const station = Object.entries(result!.derived.station_map).find(
                ([key]) => key === name,
              )?.[1];
              const coordinate =
                "x" in p
                  ? `x ${fmt(p.x)}, calculated y ${fmt(p.y)}`
                  : `calculated y ${fmt(p.y)}, z ${fmt(p.z)}`;
              const label = `${type}: ${name} · ${coordinate} mm${type === "top" && station ? ` · entered contour s ${fmt(station.s)} mm` : ""} · ${p.kind}`;
              const [cx, cy] = transform(p);
              return (
                <circle
                  key={name}
                  cx={cx}
                  cy={cy}
                  r={p.kind === "landmark" ? 1.1 : 0.7}
                  fill={
                    p.kind === "handle"
                      ? "#af7c4b"
                      : type === "top"
                        ? "#216356"
                        : "#b15d35"
                  }
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                  onClick={() => onSelect(label)}
                  onFocus={() => onSelect(label)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(label);
                    }
                  }}
                >
                  <title>{label}</title>
                </circle>
              );
            })}
          </>
        )}
      </g>
    );
  }
  return (
    <svg
      id="drawing"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Aligned top silhouette and bottom guide, forward to the right"
    >
      <title>
        Aligned outer top silhouette and longitudinal bottom guide. Equal
        millimetre scales; forward y points right.
      </title>
      <text x={16} y={7} fontSize={3.2}>
        TOP / OUTER SILHOUETTE
      </text>
      <text x={left + yMax} y={7} fontSize={3.2} textAnchor="end">
        TOE →
      </text>
      <text x={16} y={topBase + xMax + 23} fontSize={3.2}>
        SIDE / BOTTOM GUIDE
      </text>
      {[0, yMax].map((y) => (
        <g key={y}>
          <line
            x1={left + y}
            y1={12}
            x2={left + y}
            y2={bottomBase + 5}
            stroke="#ccd4c9"
            strokeWidth={0.25}
            strokeDasharray="1 2"
          />
          <text
            x={left + y}
            y={bottomBase + 11}
            fontSize={3.2}
            textAnchor={y === 0 ? "start" : "end"}
          >
            y {fmt(y)} mm
          </text>
        </g>
      ))}
      {[topBase, bottomBase].map((y) => (
        <line
          key={y}
          x1={left + yMin}
          y1={y}
          x2={left + yMax}
          y2={y}
          stroke="#ccd4c9"
          strokeWidth={0.25}
          strokeDasharray="1.5 1.5"
        />
      ))}
      <text x={left + yMax} y={bottomBase + 16} fontSize={3.2} textAnchor="end">
        Ground z = 0
      </text>
      {draw(top, top.outline, "top", (p) => [left + p.y, topBase + p.x])}
      {draw(bottom, bottom.profile, "bottom", (p) => [
        left + p.y,
        bottomBase - p.z,
      ])}
    </svg>
  );
}

export function AlignedGuides({
  result,
  construction,
  onConstruction,
  selection,
  onSelect,
  viewLabel,
}: Props) {
  return (
    <section className="drawing-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">01 / ALIGNED VIEWS</span>
          <h2>One forward direction.</h2>
        </div>
        <label className="toggle">
          <input
            id="construction"
            type="checkbox"
            checked={construction}
            onChange={(e) => onConstruction(e.target.checked)}
          />{" "}
          Show named controls
        </label>
      </div>
      <div className="legend">
        <span className="top-key">Outer top silhouette</span>
        <span className="bottom-key">Longitudinal bottom guide</span>
        <span className="scale-note">
          Equal axis scales · no height exaggeration
        </span>
      </div>
      <p className="view-state" data-view-state>
        {viewLabel}
      </p>
      <div className="drawing-scroll">
        <Guides
          result={result}
          construction={construction}
          onSelect={onSelect}
        />
      </div>
      <div className="drawing-footer">
        <p>
          Rear → toe along calculated y · top: medial −x above, lateral +x below
          · side: z up
        </p>
        <p>
          Width stations follow distance along the bottom guide. This is our
          prototype correspondence—not a physical foot-reshaping rule.
        </p>
        <output id="selection">
          {selection ??
            (construction
              ? "Select a point to inspect its current model name and coordinates."
              : "Show named controls, then select a point to inspect its model name.")}
        </output>
      </div>
    </section>
  );
}
