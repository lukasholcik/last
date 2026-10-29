import { useMemo, useState } from "react";
import { getShapeHandles, type TopAnchorId } from "~/lib/shaping";
import type {
  BottomModel,
  BottomPoint,
  Last2DGeometry,
  TopModel,
  TopPoint,
} from "~/lib/geometry/types";
import { fmt } from "./state";
import { resolveCrossSections } from "~/lib/geometry/cross-sections";
import type { CrossSectionId } from "~/lib/geometry/section-types";
import { referenceSectionLine } from "./section-editor";
import { ProfileHandles, type ShapeEditingProps } from "./ProfileHandles";
import {
  selectedShapeHandle,
  shapeHandlesForMode,
  type OutlineMode,
} from "./shape-selection";
import {
  sampledPath,
  sectionNativeCurveKind,
  sectionNativeHandleLabel,
  sectionPointLabel,
  upperSectionCurves,
} from "./section-display";

interface Props extends ShapeEditingProps {
  selectedSection?: CrossSectionId;
  result: Last2DGeometry | null;
  editable: Last2DGeometry | null;
  previewError: string | null;
  construction: boolean;
  onConstruction: (show: boolean) => void;
  selection: string | null;
  onSelect: (label: string) => void;
  viewLabel: string;
  onResetPoint: (anchor: TopAnchorId) => void;
}

function Guides({
  result,
  editable,
  construction,
  onSelect,
  enabled,
  version,
  dragging,
  onBegin,
  onPreview,
  onFinish,
  onCancel,
  selectedId,
  onChoose,
  outlineMode,
  editing,
  selectedSection = "ball",
}: Pick<
  Props,
  | "result"
  | "editable"
  | "construction"
  | "onSelect"
  | "enabled"
  | "version"
  | "dragging"
  | "onBegin"
  | "onPreview"
  | "onFinish"
  | "onCancel"
  | "selectedId"
  | "onChoose"
  | "selectedSection"
> & { editing: boolean; outlineMode: OutlineMode }) {
  if (!result || !editable)
    return <svg id="drawing" role="img" aria-label="No rebuilt guides yet" />;
  const { foot, top, bottom, section } = result.models;
  const crossSection = resolveCrossSections(result).find(
    (s) => s.id === selectedSection,
  );
  const referenceLine = crossSection
    ? referenceSectionLine(result, crossSection)
    : null;
  const footToe = foot.points.toe_tip!.y,
    topToe = top.points.toe_tip!.y,
    bottomToe = bottom.points.bottom_toe_end!.y,
    contact = bottom.points.bottom_forepart_contact!;
  // Freeze layout and handles on the gesture-start checkpoint; only the paths are live.
  const pts = [
      ...Object.values(editable.models.foot.points),
      ...Object.values(editable.models.top.points),
    ],
    bpts = Object.values(editable.models.bottom.points),
    sideBounds = [
      ...bpts,
      ...Object.values(editable.models.section.points),
      ...editable.display.section.flatMap((curve) =>
        curve.points.map(([, y, z]) => ({ y, z })),
      ),
      ...editable.models.section.boundary.flatMap((piece) =>
        piece.kind === "cubic" ? piece.points.map(([y, z]) => ({ y, z })) : [],
      ),
    ];
  const yMin = Math.min(
      0,
      ...pts.map((p) => p.y),
      ...sideBounds.map((p) => p.y),
    ),
    yMax = Math.max(...pts.map((p) => p.y), ...sideBounds.map((p) => p.y));
  const xMin = Math.min(...pts.map((p) => p.x)),
    xMax = Math.max(...pts.map((p) => p.x));
  const zMin = Math.min(0, ...sideBounds.map((p) => p.z)),
    zMax = Math.max(0, ...sideBounds.map((p) => p.z));
  const left = 16 - yMin,
    width = yMax - yMin + 32,
    topBase = 23 - xMin,
    bottomBase = topBase + xMax + 47 + zMax;
  const height = bottomBase - zMin + 27;
  const inspect = (label: string) => {
    onChoose(null);
    onSelect(label);
  };
  function draw<P extends TopPoint | BottomPoint>(
    model: {
      points: Record<string, P>;
      curves: TopModel["curves"];
      reference_lines: BottomModel["reference_lines"];
    },
    names: string[],
    type: "foot" | "top" | "bottom",
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
      (type !== "bottom" ? " Z" : "");
    return (
      <g key={type}>
        <path
          d={d}
          className={`guide-${type}`}
          strokeWidth={type === "foot" ? 0.4 : 0.65}
          strokeDasharray={type === "foot" ? "2 1.3" : "none"}
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
              const coordinate =
                "x" in p
                  ? `x ${fmt(p.x)} mm, reference y = s_ref ${fmt(p.y)} mm`
                  : `posed y ${fmt(p.y)} mm, z ${fmt(p.z)} mm`;
              const label = `${type === "top" ? "last reference" : type}: ${name} · ${coordinate} · ${p.kind}${type !== "bottom" && p.kind === "handle" ? " · unbent construction only" : ""}`;
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
                      : type !== "bottom"
                        ? "#216356"
                        : "#b15d35"
                  }
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                  onClick={() =>
                    inspect(`${type === "top" ? "Last" : type} · ${name}`)
                  }
                  onFocus={() =>
                    inspect(`${type === "top" ? "Last" : type} · ${name}`)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      inspect(`${type === "top" ? "Last" : type} · ${name}`);
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
      className="last-shape-drawing"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Dashed foot reference, solid editable last, and centre section. Equal millimetre scales; forward right."
    >
      <title>
        Reference foot and extended last in x and s_ref; designed centre section
        in posed y and z at x = 0, closed by the existing bottom lower boundary.
        Equal millimetre scales, not matched forward spans. Reference handles
        remain unbent; the section roof is drawn from server samples. Forward
        points right.
      </title>
      <text x={16} y={7} fontSize={3.2}>
        TOP · s →
      </text>
      <text x={left + topToe} y={7} fontSize={3.2} textAnchor="end">
        TOE →
      </text>
      <text x={16} y={topBase + xMax + 30} fontSize={3.2}>
        PROFILE · y →
      </text>
      {[0, footToe].map((s) => (
        <g key={`top-${s}`}>
          <line
            x1={left + s}
            y1={12}
            x2={left + s}
            y2={topBase + xMax + 3}
            stroke="#ccd4c9"
            strokeWidth={0.25}
            strokeDasharray="1 2"
          />
          <text
            x={left + s}
            y={topBase + xMax + 9}
            fontSize={3.2}
            textAnchor={s === 0 ? "start" : "end"}
          >
            {s === 0 ? "s_ref" : "foot F"} {fmt(s)} mm
          </text>
        </g>
      ))}
      <line
        x1={left + topToe}
        y1={12}
        x2={left + topToe}
        y2={topBase + xMax + 10}
        stroke="#8a9b91"
        strokeWidth={0.25}
        strokeDasharray="1 2"
      />
      <text
        x={left + topToe}
        y={topBase + xMax + 16}
        fontSize={3.2}
        textAnchor="end"
      >
        Last {fmt(topToe)} mm
      </text>
      {[0, bottomToe].map((y) => (
        <g key={`bottom-${y}`}>
          <line
            x1={left + y}
            y1={topBase + xMax + 34}
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
            {y === 0 ? "y" : "posed end y"} {fmt(y)} mm
          </text>
        </g>
      ))}
      {(
        [
          [topBase, topToe],
          [bottomBase, bottomToe],
        ] as const
      ).map(([y, end]) => (
        <line
          key={y}
          x1={left + yMin}
          y1={y}
          x2={left + end}
          y2={y}
          stroke="#ccd4c9"
          strokeWidth={0.25}
          strokeDasharray="1.5 1.5"
        />
      ))}
      <text x={left + yMax} y={bottomBase + 24} fontSize={3.2} textAnchor="end">
        Ground z = 0
      </text>
      <text
        x={left + contact.y}
        y={bottomBase + 18}
        fontSize={3.2}
        textAnchor="middle"
      >
        contact y {fmt(contact.y)} mm
      </text>
      {draw(foot, foot.outline, "foot", (p) => [left + p.y, topBase + p.x])}
      {draw(top, top.outline, "top", (p) => [left + p.y, topBase + p.x])}
      {crossSection && referenceLine && (
        <g
          data-selected-section={crossSection.id}
          fill="none"
          stroke="#6a6680"
          strokeWidth={0.8}
        >
          <path
            d={`M ${referenceLine.map(([x, s]) => `${left + s} ${topBase + x}`).join(" L ")}`}
          />
          <path
            d={crossSection.posedSamples
              .map(
                ([, y, z], i) =>
                  `${i ? "L" : "M"} ${left + y} ${bottomBase - z}`,
              )
              .join(" ")}
            strokeWidth={0.45}
          />
          <path
            d={`M ${left + crossSection.frame.origin[1]} ${bottomBase - crossSection.frame.origin[2]} l ${crossSection.frame.up[1] * 18} ${-crossSection.frame.up[2] * 18}`}
          />
          <text
            x={left + crossSection.referenceStation}
            y={topBase + xMin - 5}
            fill="#6a6680"
            stroke="none"
            fontSize={3}
          >
            {crossSection.label}
          </text>
          <title>
            {crossSection.frame.label}. Top shows reference-domain orientation;
            profile shows the actual transported section.
          </title>
        </g>
      )}
      <path
        data-guide="section"
        className="guide-section"
        d={sampledPath(
          result.display.section,
          ([, y, z]) => [left + y, bottomBase - z],
          true,
        )}
      />
      <path
        className="guide-section-upper"
        d={sampledPath(
          upperSectionCurves(result.display.section, result.display.bottom),
          ([, y, z]) => [left + y, bottomBase - z],
        )}
        strokeWidth={0.65}
        strokeLinejoin="round"
      />
      {draw(bottom, bottom.profile, "bottom", (p) => [
        left + p.y,
        bottomBase - p.z,
      ])}
      <circle
        cx={left + contact.y}
        cy={bottomBase - contact.z}
        r={0.8}
        fill="#b15d35"
      >
        <title>
          Posed contact from medial ball · contour station{" "}
          {fmt(result.resolved.contact_s)} mm
        </title>
      </circle>
      {construction &&
        section.boundary
          .filter((piece) => piece.kind === "cubic")
          .map((piece) => (
            <g key={`section-controls-${piece.name}`}>
              <path
                className="construction"
                d={`M ${piece.points.map(([y, z]) => `${left + y} ${bottomBase - z}`).join(" L ")}`}
              >
                <title>
                  section: {piece.name} · native posed{" "}
                  {sectionNativeCurveKind(piece.name)} control polygon
                </title>
              </path>
              {([1, 2] as const).map((control) => {
                const [y, z] = piece.points[control],
                  label = sectionNativeHandleLabel(
                    piece.name,
                    control,
                    piece.points[control],
                  );
                return (
                  <circle
                    key={control}
                    cx={left + y}
                    cy={bottomBase - z}
                    r={0.7}
                    fill="#af7c4b"
                    tabIndex={0}
                    role="button"
                    aria-label={label}
                    onClick={() =>
                      inspect(`${piece.name} · control ${control}`)
                    }
                    onFocus={() =>
                      inspect(`${piece.name} · control ${control}`)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        inspect(`${piece.name} · control ${control}`);
                      }
                    }}
                  >
                    <title>{label}</title>
                  </circle>
                );
              })}
            </g>
          ))}
      {construction &&
        Object.entries(section.points).map(([name, p]) => {
          const label = sectionPointLabel(name, p);
          return (
            <circle
              key={`section-${name}`}
              cx={left + p.y}
              cy={bottomBase - p.z}
              r={1.1}
              fill="#6a6680"
              tabIndex={0}
              role="button"
              aria-label={label}
              onClick={() => inspect(`Section · ${name}`)}
              onFocus={() => inspect(`Section · ${name}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inspect(`Section · ${name}`);
                }
              }}
            >
              <title>{label}</title>
            </circle>
          );
        })}
      {editing && (
        <ProfileHandles
          result={result}
          frame={{ left, topBase, bottomBase }}
          enabled={enabled}
          version={version}
          dragging={dragging}
          onBegin={onBegin}
          onPreview={onPreview}
          onFinish={onFinish}
          onCancel={onCancel}
          onSelect={onSelect}
          selectedId={selectedId}
          onChoose={onChoose}
          outlineMode={outlineMode}
        />
      )}
    </svg>
  );
}

export function AlignedGuides({
  result,
  editable,
  previewError,
  construction,
  onConstruction,
  selection,
  onSelect,
  viewLabel,
  enabled,
  version,
  dragging,
  onBegin,
  onPreview,
  onFinish,
  onCancel,
  selectedId,
  onChoose,
  onResetPoint,
  selectedSection,
}: Props) {
  const [editing, setEditing] = useState(true);
  const [outlineMode, setOutlineMode] = useState<OutlineMode>("last");
  const handles = useMemo(
    () =>
      editable
        ? shapeHandlesForMode(getShapeHandles(editable), outlineMode)
        : [],
    [editable, outlineMode],
  );
  const selected = selectedShapeHandle(handles, selectedId);
  const resetAnchor = selected?.resetToFoot;
  const selectedName = resetAnchor
    ? `Last · ${resetAnchor.replaceAll("_", " ")}`
    : selected?.label;
  return (
    <section className="drawing-panel last-shape-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">01 / 2D</span>
          <h2>Shape</h2>
        </div>
        <div className="guide-mode-toggles">
          <label className="toggle">
            <input
              id="edit-shape"
              type="checkbox"
              checked={editing}
              onChange={(event) => setEditing(event.target.checked)}
            />
            Edit shape
          </label>
          <label className="toggle">
            <input
              id="construction"
              type="checkbox"
              checked={construction}
              onChange={(e) => onConstruction(e.target.checked)}
            />{" "}
            Construction
          </label>
        </div>
      </div>
      <div className="legend">
        <span className="foot-key">Foot reference</span>
        <span className="last-key">Last</span>
        <span className="bottom-key">Bottom</span>
        <span className="section-key">Centre section</span>
        <span className="scale-note">mm · equal scale</span>
      </div>
      <p className="view-state" data-view-state>
        {viewLabel}
      </p>
      <div className="shape-toolbar">
        <div
          className="outline-mode"
          role="group"
          aria-label="Top view editing target"
        >
          {(["last", "foot"] as const).map((mode) => (
            <button
              key={mode}
              id={`edit-${mode}`}
              type="button"
              aria-pressed={outlineMode === mode}
              onClick={() => {
                if (outlineMode === mode) return;
                setOutlineMode(mode);
                if (selected?.plane === "top") onChoose(null);
              }}
            >
              {mode === "last" ? "Last" : "Foot"}
            </button>
          ))}
        </div>
        <output id="selection" aria-live="polite">
          {selection ??
            (dragging ? "Editing" : selectedName) ??
            (editing ? "Select a point" : "Read only")}
        </output>
        {resetAnchor && (
          <button
            id="reset-point-to-foot"
            type="button"
            disabled={!enabled || dragging}
            aria-label="Reset selected last point and its handles to foot reference"
            onClick={() => onResetPoint(resetAnchor)}
          >
            Reset to foot
          </button>
        )}
      </div>
      <div className="drawing-scroll">
        <Guides
          selectedSection={selectedSection}
          result={result}
          editable={editable}
          construction={construction}
          onSelect={onSelect}
          enabled={enabled}
          version={version}
          dragging={dragging}
          onBegin={onBegin}
          onPreview={onPreview}
          onFinish={onFinish}
          onCancel={onCancel}
          selectedId={selectedId}
          onChoose={onChoose}
          outlineMode={outlineMode}
          editing={editing}
        />
      </div>
      {previewError && (
        <div className="drawing-footer">
          <p className="preview-warning" role="status" title={previewError}>
            Preview retained.
          </p>
        </div>
      )}
    </section>
  );
}
