"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  appendPoint,
  curvature,
  derivative,
  hasHandle,
  insertPoint,
  moveAnchor,
  moveHandle,
  nearestOnCurve,
  removePoint,
  sampleCurve,
  segmentCount,
  segmentCubic,
  evalCubic,
  type EditableCurve,
  type HandleSide,
  type HistoryAction,
  type PointMode,
  type Vec2,
} from "~/lib/curves";
import { add, dist, len, sub } from "~/lib/curves/vec";
import {
  imageContains,
  imageCorners,
  imageHeight,
  localToWorld,
  rotateImageTo,
  scaleImageAbout,
  scaleImageFromCorner,
  type RefImage,
} from "~/lib/studio/reference-image";
import styles from "./curve.module.css";
import { Rulers } from "./Rulers";
import {
  MAX_SCALE,
  MIN_SCALE,
  fitView,
  gridStep,
  toScreen,
  toWorld,
  zoomAt,
  type Size,
  type View,
} from "./view";

/** Points the view should frame: the curve plus any ghost geometry. */
function fitSet(c: EditableCurve, extra?: readonly Vec2[]): Vec2[] {
  return [...sampleCurve(c), ...(extra ?? [])];
}

/**
 * `image` moves/scales/rotates the reference image instead of editing the
 * curve (decision: a separate tool, so a stray drag can never nudge the image
 * while modelling, and a stray drag never moves a point while placing it).
 */
export type Tool = "select" | "pen" | "image";
export interface Projection {
  view: View;
  size: Size;
  toScreen: (p: Vec2) => Vec2;
}

interface Props {
  curve: EditableCurve;
  selected: number | null;
  tool: Tool;
  snap: number | null;
  showComb: boolean;
  combGain: number;
  showAllHandles: boolean;
  /** Bump to re-fit the view (preset or import loaded). */
  fitSignal: number;
  /** SVG drawn under the curve, in screen space via the supplied projection. */
  underlay?: (t: Projection) => ReactNode;
  /** Text next to an anchor; defaults to its 1-based index. */
  label?: (i: number) => string;
  /** Cursor position in world units (null when it leaves the canvas). */
  onCursor?: (p: Vec2 | null) => void;
  rulers?: boolean;
  /** Axes of point i that are driven and cannot be dragged: [x, y]. */
  locks?: (i: number) => readonly [boolean, boolean];
  /** Whether point i may be deleted (driven landmarks may not). */
  canDelete?: (i: number) => boolean;
  /** Extra points to include when fitting the view (e.g. ghost geometry). */
  fitPoints?: readonly Vec2[];
  /** Reference image drawn behind the grid (workspace aid, not model data). */
  image?: RefImage | null;
  /** Called continuously while the image tool drags it. Not part of undo. */
  onImageChange?: (image: RefImage) => void;
  onSelect: (i: number | null) => void;
  dispatch: Dispatch<HistoryAction<EditableCurve>>;
}

type Drag =
  | {
      kind: "anchor" | HandleSide;
      index: number;
      base: EditableCurve;
      grab: Vec2;
    }
  | { kind: "img-move"; base: RefImage; start: Vec2 }
  | { kind: "img-rotate"; base: RefImage }
  | { kind: "img-corner"; corner: 0 | 1 | 2 | 3; base: RefImage }
  | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean };

const HIT_PX = 10;
const ANCHOR_HIT_PX = 12;

export function CurveCanvas(props: Props) {
  const { curve, selected, tool, snap, showComb, combGain, showAllHandles } =
    props;
  const { onSelect, dispatch } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 3 });
  const [panning, setPanning] = useState(false);
  const fitted = useRef(false);
  // Set once the user pans or zooms: until then a resize re-fits the view, so
  // a canvas that settles into its final size (a workspace pane) shows the curve.
  const touched = useRef(false);
  const latest = useRef({
    curve,
    size,
    view,
    extra: props.fitPoints,
    image: props.image,
    onImage: props.onImageChange,
  });
  useEffect(() => {
    latest.current = {
      curve,
      size,
      view,
      extra: props.fitPoints,
      image: props.image,
      onImage: props.onImageChange,
    };
  });

  useEffect(() => {
    if (!fitted.current) return;
    touched.current = false;
    setView(
      fitView(
        fitSet(latest.current.curve, latest.current.extra),
        latest.current.size,
      ),
    );
  }, [props.fitSignal]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      setSize(next);
      if (next.width > 0 && (!fitted.current || !touched.current)) {
        fitted.current = true;
        setView(
          fitView(fitSet(latest.current.curve, latest.current.extra), next),
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(),
        k = e.ctrlKey ? 0.01 : 0.0015,
        img = latest.current.image;
      // Alt + wheel scales the reference image about the cursor instead of the view.
      if (e.altKey && img && !img.locked && latest.current.onImage) {
        const w = toWorld(latest.current.view, latest.current.size, [
          e.clientX - r.left,
          e.clientY - r.top,
        ]);
        latest.current.onImage(
          scaleImageAbout(img, w, Math.exp(-e.deltaY * k)),
        );
        return;
      }
      touched.current = true;
      setView((v) =>
        zoomAt(
          v,
          latest.current.size,
          [e.clientX - r.left, e.clientY - r.top],
          Math.exp(-e.deltaY * k),
        ),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Escape during a drag cancels it (and is not seen by the page shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !drag.current) return;
      const k = drag.current.kind;
      if (k === "img-move" || k === "img-rotate" || k === "img-corner")
        props.onImageChange?.(drag.current.base);
      else if (k !== "pan") dispatch({ type: "cancel" });
      drag.current = null;
      setPanning(false);
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svg.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const world = (e: { clientX: number; clientY: number }) =>
    toWorld(view, size, local(e));
  const snapped = (p: Vec2, alt: boolean): Vec2 =>
    snap && !alt
      ? [Math.round(p[0] / snap) * snap, Math.round(p[1] / snap) * snap]
      : p;

  const startPointDrag = (
    e: ReactPointerEvent,
    kind: "anchor" | HandleSide,
    index: number,
  ) => {
    if (e.button !== 0 || tool === "image") return;
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    const p = curve.points[index]!,
      target =
        kind === "anchor"
          ? p.pos
          : add(p.pos, kind === "in" ? p.handleIn : p.handleOut),
      w = world(e);
    onSelect(index);
    drag.current = { kind, index, base: curve, grab: sub(target, w) };
  };

  const onBackgroundDown = (e: ReactPointerEvent) => {
    const panButton = e.button === 1;
    if (e.button !== 0 && !panButton) return;
    svg.current!.setPointerCapture(e.pointerId);
    const img = props.image;
    if (
      tool === "image" &&
      !panButton &&
      img &&
      img.visible &&
      !img.locked &&
      imageContains(img, world(e))
    ) {
      drag.current = { kind: "img-move", base: img, start: world(e) };
      return;
    }
    if (tool === "pen" && !panButton) {
      const w = world(e),
        hit = nearestOnCurve(curve, w);
      const res =
        hit && hit.distance * view.scale <= HIT_PX
          ? insertPoint(curve, hit.segment, hit.t)
          : appendPoint(curve, snapped(w, e.altKey));
      dispatch({ type: "preview", value: res.curve });
      onSelect(res.index);
      drag.current = {
        kind: "anchor",
        index: res.index,
        base: res.curve,
        grab: [0, 0],
      };
      return;
    }
    drag.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      view,
      moved: false,
    };
    setPanning(true);
  };

  const onMove = (e: ReactPointerEvent) => {
    props.onCursor?.(world(e));
    const d = drag.current;
    if (!d) return;
    if (d.kind === "img-move") {
      const w = world(e);
      props.onImageChange?.({
        ...d.base,
        cx: d.base.cx + w[0] - d.start[0],
        cy: d.base.cy + w[1] - d.start[1],
      });
      return;
    }
    if (d.kind === "img-corner") {
      props.onImageChange?.(scaleImageFromCorner(d.base, d.corner, world(e)));
      return;
    }
    if (d.kind === "img-rotate") {
      props.onImageChange?.(
        rotateImageTo(d.base, world(e), e.shiftKey ? 15 : undefined),
      );
      return;
    }
    if (d.kind === "pan") {
      const dx = e.clientX - d.startX,
        dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) > 3) d.moved = true;
      touched.current = true;
      setView({
        ...d.view,
        cx: d.view.cx - dx / d.view.scale,
        cy: d.view.cy + dy / d.view.scale,
      });
      return;
    }
    let target = snapped(add(world(e), d.grab), e.altKey);
    if (d.kind === "anchor") {
      // Driven axes stay where they are; only the free axis follows the pointer.
      const [lx, ly] = props.locks?.(d.index) ?? [false, false],
        at = d.base.points[d.index]!.pos;
      target = [lx ? at[0] : target[0], ly ? at[1] : target[1]];
    }
    const next =
      d.kind === "anchor"
        ? moveAnchor(d.base, d.index, target)
        : moveHandle(
            d.base,
            d.index,
            d.kind,
            sub(target, d.base.points[d.index]!.pos),
          );
    dispatch({ type: "preview", value: next });
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (!d) return;
    if (
      d.kind === "img-move" ||
      d.kind === "img-corner" ||
      d.kind === "img-rotate"
    )
      return;
    if (d.kind === "pan") {
      if (!d.moved) onSelect(null);
      return;
    }
    dispatch({ type: "finish" });
  };

  const onDouble = (e: ReactPointerEvent | React.MouseEvent) => {
    if (tool === "image") return;
    // Pointer capture retargets the dblclick to the svg, so hit-test anchors here.
    const px = local(e),
      onAnchor = curve.points.findIndex(
        (p) => dist(toScreen(view, size, p.pos), px) <= ANCHOR_HIT_PX,
      );
    if (onAnchor >= 0) {
      if (props.canDelete && !props.canDelete(onAnchor)) return;
      dispatch({ type: "commit", value: removePoint(curve, onAnchor) });
      onSelect(null);
      return;
    }
    const w = world(e),
      hit = nearestOnCurve(curve, w);
    if (hit && hit.distance * view.scale <= HIT_PX) {
      const res = insertPoint(curve, hit.segment, hit.t);
      dispatch({ type: "commit", value: res.curve });
      onSelect(res.index);
    }
  };

  const zoomBy = (factor: number) => {
    touched.current = true;
    setView((v) => zoomAt(v, size, [size.width / 2, size.height / 2], factor));
  };
  const fit = () => {
    touched.current = false;
    setView(fitView(fitSet(curve, props.fitPoints), size));
  };

  const grid = useMemo(() => buildGrid(view, size), [view, size]);
  const path = useMemo(() => buildPath(curve, view, size), [curve, view, size]);
  const comb = useMemo(
    () => (showComb ? buildComb(curve, view, size, combGain) : null),
    [showComb, curve, view, size, combGain],
  );

  const handleKnobs: { i: number; side: HandleSide; a: Vec2; b: Vec2 }[] = [];
  curve.points.forEach((p, i) => {
    if (!showAllHandles && i !== selected) return;
    for (const side of ["in", "out"] as const) {
      const off = side === "in" ? p.handleIn : p.handleOut;
      if (!hasHandle(curve, i, side) || len(off) < 1e-9) continue;
      handleKnobs.push({
        i,
        side,
        a: toScreen(view, size, p.pos),
        b: toScreen(view, size, add(p.pos, off)),
      });
    }
  });

  return (
    <div ref={wrap} className={styles.canvasWrap}>
      <svg
        ref={svg}
        width={size.width}
        height={size.height}
        className={styles.canvas}
        data-tool={tool}
        data-panning={panning || undefined}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => props.onCursor?.(null)}
        onDoubleClick={onDouble}
        role="application"
        aria-label="Curve canvas"
      >
        {props.image?.visible && (
          <ImageLayer img={props.image} view={view} size={size} />
        )}
        <path d={grid.minor} className={styles.gridMinor} />
        <path d={grid.major} className={styles.gridMajor} />
        <path d={grid.axes} className={styles.gridAxes} />
        {props.underlay?.({
          view,
          size,
          toScreen: (p) => toScreen(view, size, p),
        })}
        {comb && (
          <g className={styles.comb}>
            <path d={comb.hairs} />
            <path d={comb.envelope} fill="none" />
          </g>
        )}
        <path d={path} className={styles.curveHalo} />
        <path d={path} className={styles.curveLine} />
        {handleKnobs.map((h) => (
          <line
            key={`l${h.i}${h.side}`}
            x1={h.a[0]}
            y1={h.a[1]}
            x2={h.b[0]}
            y2={h.b[1]}
            className={styles.handleLine}
            data-selected={h.i === selected || undefined}
          />
        ))}
        {handleKnobs.map((h) => (
          <g
            key={`k${h.i}${h.side}`}
            transform={`translate(${h.b[0]} ${h.b[1]})`}
            className={styles.knob}
            data-auto={curve.points[h.i]!.mode === "auto" || undefined}
            data-selected={h.i === selected || undefined}
            onPointerDown={(e) => startPointDrag(e, h.side, h.i)}
          >
            <circle r={13} className={styles.hit} />
            <circle r={4.5} className={styles.knobDot} />
          </g>
        ))}
        {curve.points.map((p, i) => {
          const s = toScreen(view, size, p.pos);
          return (
            <g
              key={i}
              transform={`translate(${s[0]} ${s[1]})`}
              className={styles.anchor}
              data-selected={i === selected || undefined}
              onPointerDown={(e) => startPointDrag(e, "anchor", i)}
            >
              <circle r={15} className={styles.hit} />
              <AnchorShape mode={p.mode} />
              <text className={styles.anchorIndex} x={11} y={-9}>
                {props.label ? props.label(i) : i + 1}
              </text>
            </g>
          );
        })}
        {tool === "image" && props.image?.visible && !props.image.locked && (
          <ImageHandles
            img={props.image}
            view={view}
            size={size}
            onCorner={(e, corner) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              svg.current!.setPointerCapture(e.pointerId);
              drag.current = { kind: "img-corner", corner, base: props.image! };
            }}
            onRotate={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              svg.current!.setPointerCapture(e.pointerId);
              drag.current = {
                kind: "img-rotate",
                base: props.image!,
              };
            }}
          />
        )}
      </svg>
      {props.rulers && <Rulers view={view} size={size} />}
      <div className={styles.zoomBar}>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.3)}
          aria-label="Zoom out"
          disabled={view.scale <= MIN_SCALE}
        >
          −
        </button>
        <span>{view.scale.toFixed(1)} px/u</span>
        <button
          type="button"
          onClick={() => zoomBy(1.3)}
          aria-label="Zoom in"
          disabled={view.scale >= MAX_SCALE}
        >
          +
        </button>
        <button type="button" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}

function ImageLayer({
  img,
  view,
  size,
}: {
  img: RefImage;
  view: View;
  size: Size;
}) {
  const c = toScreen(view, size, [img.cx, img.cy]),
    w = img.width * view.scale,
    h = imageHeight(img) * view.scale;
  return (
    <g
      transform={`translate(${c[0]} ${c[1]}) rotate(${-img.rotationDeg}) scale(${img.flipX ? -1 : 1} 1)`}
      opacity={img.opacity}
      pointerEvents="none"
    >
      <image
        href={img.src}
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        preserveAspectRatio="none"
      />
    </g>
  );
}

const ROTATE_ARM_PX = 28;

function ImageHandles({
  img,
  view,
  size,
  onCorner,
  onRotate,
}: {
  img: RefImage;
  view: View;
  size: Size;
  onCorner: (e: ReactPointerEvent, corner: 0 | 1 | 2 | 3) => void;
  onRotate: (e: ReactPointerEvent) => void;
}) {
  const corners = imageCorners(img).map((p) => toScreen(view, size, p)),
    topMid = toScreen(view, size, localToWorld(img, [0, imageHeight(img) / 2])),
    knob = toScreen(
      view,
      size,
      localToWorld(img, [0, imageHeight(img) / 2 + ROTATE_ARM_PX / view.scale]),
    ),
    outline = `M${corners.map((c) => `${c[0]} ${c[1]}`).join("L")}Z`;
  return (
    <g className={styles.imageHandles}>
      <path d={outline} className={styles.imageFrame} pointerEvents="none" />
      <line
        x1={topMid[0]}
        y1={topMid[1]}
        x2={knob[0]}
        y2={knob[1]}
        className={styles.imageFrame}
        pointerEvents="none"
      />
      {corners.map((c, i) => (
        <rect
          key={i}
          x={c[0] - 5}
          y={c[1] - 5}
          width={10}
          height={10}
          className={styles.imageCorner}
          onPointerDown={(e) => onCorner(e, i as 0 | 1 | 2 | 3)}
        />
      ))}
      <circle
        cx={knob[0]}
        cy={knob[1]}
        r={6}
        className={styles.imageCorner}
        onPointerDown={onRotate}
      />
    </g>
  );
}

function AnchorShape({ mode }: { mode: PointMode }) {
  switch (mode) {
    case "auto":
      return (
        <rect
          x={-5.5}
          y={-5.5}
          width={11}
          height={11}
          transform="rotate(45)"
          className={styles.anchorShape}
        />
      );
    case "corner":
      return (
        <rect
          x={-5}
          y={-5}
          width={10}
          height={10}
          className={styles.anchorShape}
        />
      );
    case "symmetric":
      return (
        <>
          <circle r={7} className={styles.anchorShape} />
          <circle r={2.2} className={styles.anchorInner} />
        </>
      );
    default:
      return <circle r={6} className={styles.anchorShape} />;
  }
}

function buildGrid(v: View, s: Size) {
  const step = gridStep(v.scale),
    [x0, y1] = toWorld(v, s, [0, 0]),
    [x1, y0] = toWorld(v, s, [s.width, s.height]);
  let minor = "",
    major = "";
  const lines = (a: number, b: number, vertical: boolean) => {
    for (let k = Math.ceil(a / step); k * step <= b; k++) {
      if (k === 0) continue;
      const w = k * step,
        px = vertical ? toScreen(v, s, [w, 0])[0] : toScreen(v, s, [0, w])[1],
        d = vertical
          ? `M${px.toFixed(1)} 0V${s.height}`
          : `M0 ${px.toFixed(1)}H${s.width}`;
      if (k % 5 === 0) major += d;
      else minor += d;
    }
  };
  lines(x0, x1, true);
  lines(y0, y1, false);
  const o = toScreen(v, s, [0, 0]);
  return {
    minor,
    major,
    axes: `M${o[0].toFixed(1)} 0V${s.height}M0 ${o[1].toFixed(1)}H${s.width}`,
  };
}

function buildPath(c: EditableCurve, v: View, s: Size): string {
  if (segmentCount(c) === 0) return "";
  const f = (p: Vec2) => {
    const q = toScreen(v, s, p);
    return `${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
  };
  let d = `M${f(segmentCubic(c, 0)[0])}`;
  for (let i = 0; i < segmentCount(c); i++) {
    const q = segmentCubic(c, i);
    d += `C${f(q[1])} ${f(q[2])} ${f(q[3])}`;
  }
  return c.closed ? d + "Z" : d;
}

/** Curvature comb: hairs point away from the centre of curvature. */
function buildComb(c: EditableCurve, v: View, s: Size, gain: number) {
  const N = 28;
  let hairs = "",
    envelope = "";
  for (let i = 0; i < segmentCount(c); i++) {
    const q = segmentCubic(c, i);
    let env = "";
    for (let k = 0; k <= N; k++) {
      const t = k / N,
        p = evalCubic(q, t),
        d = derivative(q, t),
        speed = Math.hypot(d[0], d[1]);
      if (speed < 1e-9) continue;
      const n: Vec2 = [-d[1] / speed, d[0] / speed],
        h = Math.max(
          -220 / v.scale,
          Math.min(220 / v.scale, curvature(q, t) * gain),
        ),
        tip: Vec2 = [p[0] - n[0] * h, p[1] - n[1] * h],
        a = toScreen(v, s, p),
        b = toScreen(v, s, tip);
      hairs += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
      env += `${env ? "L" : "M"}${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    envelope += env;
  }
  return { hairs, envelope };
}
