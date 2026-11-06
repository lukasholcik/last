"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { Loft, Vec3 } from "~/lib/studio/loft";
import type { Marker } from "~/lib/studio/space-edit";
import styles from "./studio.module.css";

export interface ViewerOptions {
  surface: boolean;
  wire: boolean;
  rails: boolean;
  sections: boolean;
  /** Apply the heel height to the surface (same frame rule as the side view). */
  pose: boolean;
  /** Flatten the top along the side view's cut line (see loft.ts). */
  topCut: boolean;
  /** Show the control points of the rails and the top outline, draggable. */
  edit: boolean;
  /** Orthographic camera (like Blender's numpad views). */
  ortho: boolean;
}
export const DEFAULT_VIEWER: ViewerOptions = {
  surface: true,
  wire: false,
  rails: true,
  sections: true,
  pose: true,
  topCut: true,
  edit: true,
  ortho: false,
};

/**
 * Standard views, Blender style. Model axes: x across (lateral +), y along
 * from the heel to the toe, z up. Top and Bottom have +y up the screen.
 */
export type ViewName =
  "top" | "bottom" | "lateral" | "medial" | "toe" | "heel" | "frame";
const VIEW_DIR: Record<Exclude<ViewName, "frame">, [number, number, number]> = {
  top: [0, -1e-3, 1],
  bottom: [0, 1e-3, -1],
  lateral: [1, 0, 0],
  medial: [-1, 0, 0],
  toe: [0, 1, 0],
  heel: [0, -1, 0],
};
export interface ViewCommand {
  name: ViewName;
  n: number;
}

/** Keys: numpad 7/1/3 (+Ctrl opposite), 5 persp/ortho, . or Home frame; the
 *  digit row works too, with Shift for the opposite side (Ctrl+digit is the
 *  browser's tab switch). */
function keyView(e: KeyboardEvent): ViewName | "ortho" | null {
  const opposite = e.ctrlKey || e.shiftKey,
    code = e.code.replace("Numpad", "Digit");
  if (e.altKey || e.metaKey) return null;
  switch (code) {
    case "Digit7":
      return opposite ? "bottom" : "top";
    case "Digit1":
      return opposite ? "heel" : "toe";
    case "Digit3":
      return opposite ? "medial" : "lateral";
    case "Digit5":
      return "ortho";
    case "DecimalPoint":
    case "Home":
      return "frame";
  }
  return e.code === "NumpadDecimal" ? "frame" : null;
}

interface Callbacks {
  onPick: (id: string | null) => void;
  /** A click on a rail or section line itself (`rail:<role>` / `section:<id>`). */
  onPickLine: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrag: (id: string, hit: Vec3, shift: boolean) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
  onOrtho: (v: boolean) => void;
}

interface Live {
  persp: THREE.PerspectiveCamera;
  orthoCam: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  content: THREE.Group;
  markers: THREE.Group;
  size: { w: number; h: number };
  hh: number;
  fitted: boolean;
  setOrtho: (v: boolean) => void;
  view: (name: ViewName) => void;
  bounds: THREE.Box3;
}

/**
 * Palette (designed, not measured). Surface: a sage-teal plastic like a real
 * last blank, on a pale cool background so the dark rails and the points read.
 * The control points copy the 2D views (same shapes and colours, see
 * CurveCanvas.tsx and curve.module.css): white anchors with a dark outline
 * whose SHAPE shows the point mode (diamond auto, square corner, ring+dot
 * symmetric, circle smooth), amber when selected, handles as pale knobs on a
 * thin line. Only the handle line/outline colour tells the curves apart: rail
 * = the 2D handle blue, section = the 2D accent orange (the colour of the
 * section lines), top outline = slate.
 */
const INK = "#1c242c",
  SELECT_FILL = "#f2b84b",
  KNOB_FILL = "#dbeaf5",
  HANDLE_COLOUR = {
    rail: "#2f6f9f",
    section: "#d2601f",
    outline: "#5b6b7a",
  } as const;
const LINE_LIT = 0xf2a900,
  SURFACE_COLOUR = 0x86b9a8,
  SECTION_COLOUR = 0xe8791c,
  RAIL_COLOUR = 0x233a73,
  SOLE_COLOUR = 0x1f2937;

type HandleStyle = keyof typeof HANDLE_COLOUR;
const handleStyle = (curve: string): HandleStyle =>
  curve === "top"
    ? "outline"
    : curve.startsWith("section:")
      ? "section"
      : "rail";

/**
 * LINES (decision): rails, sections and handle lines are drawn like the 2D
 * canvas draws its curves (curve.module.css: a 2.25 px stroke over a 6 px halo
 * in the canvas colour), as screen-width lines (`Line2`; a WebGL line is always
 * 1 px wide). The halo is what keeps a dark line readable over the teal surface.
 * Every line is drawn twice: solid where the surface does not cover it, and a
 * faint copy that ignores depth. The faint copy is needed because a rail is not
 * always ON the mesh: inside an end cap the surface is interpolated between the
 * boundary slice and the tip, so a rail can sit a few mm under it (documented
 * in the spec, "End caps"); without it the toe box showed almost no lines. The
 * widths are designed, not measured.
 */
const LINE_PX = 2.5,
  LINE_LIT_PX = 3.5,
  HALO_EXTRA_PX = 3.5,
  HALO_COLOUR = 0xfffefb,
  HALO_OPACITY = 0.9,
  GHOST_LINE = 0.5,
  HANDLE_LINE_PX = 1.5;

interface LineSpec {
  colour: number;
  width: number;
  /** Close the loop (sections). */
  loop?: boolean;
  /** Draw the halo under the line. */
  halo?: boolean;
  /** Added to the render order, so handle lines sit above the rails. */
  base?: number;
}
/**
 * One line as a group of three passes (see LINES). `size` is the canvas size in
 * CSS pixels, the unit of the widths; `resize` below keeps it current.
 */
function strokes(
  size: { w: number; h: number },
  pts: readonly (readonly number[])[],
  spec: LineSpec,
): THREE.Group {
  const flat: number[] = [];
  for (const p of pts) flat.push(p[0]!, p[1]!, p[2]!);
  if (spec.loop && pts[0]) flat.push(pts[0][0]!, pts[0][1]!, pts[0][2]!);
  const geometry = new LineGeometry();
  geometry.setPositions(flat);
  const g = new THREE.Group(),
    pass = (
      colour: number,
      width: number,
      opacity: number,
      depthTest: boolean,
      order: number,
    ) => {
      const m = new LineMaterial({
        color: colour,
        linewidth: width,
        transparent: true,
        opacity,
        depthTest,
        depthWrite: false,
      });
      m.resolution.set(size.w, size.h);
      const l = new Line2(geometry, m);
      l.renderOrder = (spec.base ?? 0) + order;
      g.add(l);
    };
  pass(spec.colour, spec.width, GHOST_LINE, false, 1);
  if (spec.halo !== false)
    pass(HALO_COLOUR, spec.width + HALO_EXTRA_PX, HALO_OPACITY, true, 2);
  pass(spec.colour, spec.width, 1, true, 3);
  return g;
}
/** Keep the pixel widths of every `Line2` below `root` right after a resize. */
function resizeLines(root: THREE.Object3D, w: number, h: number) {
  root.traverse((o) => {
    if (o instanceof Line2) o.material.resolution.set(w, h);
  });
}

/** Marker size on screen in CSS pixels (the sprite square, shape inside). */
const SPRITE_PX = 40;

/**
 * Marker textures drawn with the 2D views' shapes (units are the SVG pixels
 * of CurveCanvas.tsx, drawn 4x and mapped so the 128 px texture spans 32 of
 * them). A thin white outline under the dark one keeps them readable over
 * the dark rails and the surface, where the 2D canvas is plain white.
 */
const textures = new Map<string, THREE.CanvasTexture>();
function texture(key: string, draw: (g: CanvasRenderingContext2D) => void) {
  let t = textures.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.translate(64, 64);
    g.scale(4, 4);
    draw(g);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, t);
  }
  return t;
}
const outlined = (g: CanvasRenderingContext2D, stroke: string, w: number) => {
  g.lineJoin = "round";
  g.strokeStyle = "#ffffff";
  g.lineWidth = w + 2.5;
  g.stroke();
  g.strokeStyle = stroke;
  g.lineWidth = w;
  g.stroke();
};
const anchorTexture = (mode: string, selected: boolean) =>
  texture(`a:${mode}:${selected}`, (g) => {
    g.fillStyle = selected ? SELECT_FILL : "#ffffff";
    g.beginPath();
    if (mode === "auto") {
      g.rotate(Math.PI / 4);
      g.rect(-5.5, -5.5, 11, 11);
    } else if (mode === "corner") g.rect(-5, -5, 10, 10);
    else g.arc(0, 0, mode === "symmetric" ? 7 : 6, 0, Math.PI * 2);
    g.fill();
    outlined(g, INK, 1.75);
    if (mode === "symmetric") {
      g.fillStyle = INK;
      g.beginPath();
      g.arc(0, 0, 2.2, 0, Math.PI * 2);
      g.fill();
    }
  });
const knobTexture = (style: HandleStyle, dashed: boolean) =>
  texture(`k:${style}:${dashed}`, (g) => {
    g.fillStyle = KNOB_FILL;
    g.beginPath();
    g.arc(0, 0, 4.5, 0, Math.PI * 2);
    g.fill();
    if (dashed) g.setLineDash([2, 2]);
    outlined(g, HANDLE_COLOUR[style], 1.5);
  });

export function Viewer3D(
  props: {
    loft: Loft;
    opts: ViewerOptions;
    markers: readonly Marker[];
    selectedId: string | null;
    /** The selected line (lit amber): `rail:<role>`, `section:<id>` or `top`. */
    highlight: string | null;
    viewCmd: ViewCommand;
  } & Callbacks,
) {
  const { loft, opts, markers, selectedId, highlight, viewCmd } = props,
    host = useRef<HTMLDivElement>(null),
    live = useRef<Live | null>(null),
    cb = useRef<Callbacks>(props),
    markerRef = useRef<readonly Marker[]>(markers),
    lineRef = useRef({ loft, opts });
  useEffect(() => {
    cb.current = props;
    markerRef.current = markers;
    lineRef.current = { loft, opts };
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }),
      scene = new THREE.Scene(),
      persp = new THREE.PerspectiveCamera(35, 1, 1, 5000),
      orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000),
      content = new THREE.Group(),
      markerGroup = new THREE.Group(),
      dom = renderer.domElement;
    persp.up.set(0, 0, 1);
    orthoCam.up.set(0, 0, 1);
    scene.add(content, markerGroup);
    scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x7a8a8f, 1.7));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
    key.position.set(-200, -300, 400);
    scene.add(key);
    // cool rim light from behind-right so the silhouette separates from the ground
    const rim = new THREE.DirectionalLight(0xbcd8ff, 0.9);
    rim.position.set(300, 250, 150);
    scene.add(rim);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(dom);

    const l = {
      persp,
      orthoCam,
      camera: persp as Live["camera"],
      controls: new OrbitControls(persp, dom),
      content,
      markers: markerGroup,
      size: { w: 1, h: 1 },
      hh: 200,
      fitted: false,
      bounds: new THREE.Box3(),
    } as unknown as Live;
    l.controls.enableDamping = true;
    live.current = l;

    const fov = Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
    const layoutOrtho = () => {
      const a = l.size.w / l.size.h;
      orthoCam.left = -l.hh * a;
      orthoCam.right = l.hh * a;
      orthoCam.top = l.hh;
      orthoCam.bottom = -l.hh;
      orthoCam.updateProjectionMatrix();
    };
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      l.size = { w, h };
      resizeLines(content, w, h);
      resizeLines(markerGroup, w, h);
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
      layoutOrtho();
    };
    l.setOrtho = (v) => {
      if ((l.camera === orthoCam) === v) return;
      const target = l.controls.target.clone(),
        dist = l.camera.position.distanceTo(target),
        next = v ? orthoCam : persp;
      next.position.copy(l.camera.position);
      next.quaternion.copy(l.camera.quaternion);
      if (v) {
        l.hh = dist * fov;
        orthoCam.zoom = 1;
        layoutOrtho();
      } else {
        // keep the apparent size: distance follows the ortho zoom
        const d = l.hh / orthoCam.zoom / fov,
          dir = new THREE.Vector3()
            .subVectors(orthoCam.position, target)
            .normalize();
        persp.position.copy(target).addScaledVector(dir, d);
      }
      l.controls.dispose();
      l.camera = next;
      l.controls = new OrbitControls(next, dom);
      l.controls.enableDamping = true;
      l.controls.target.copy(target);
      l.controls.update();
    };
    l.view = (name) => {
      const c = l.bounds.getCenter(new THREE.Vector3()),
        r = Math.max(l.bounds.getSize(new THREE.Vector3()).length() / 2, 50);
      if (name === "frame") {
        l.controls.target.copy(c);
        if (l.camera === orthoCam) {
          l.hh = r * 1.1;
          orthoCam.zoom = 1;
          layoutOrtho();
        } else {
          const dir = new THREE.Vector3()
            .subVectors(persp.position, l.controls.target)
            .normalize();
          persp.position.copy(c).addScaledVector(dir, (r * 1.1) / fov);
        }
        l.controls.update();
        return;
      }
      l.setOrtho(true);
      cb.current.onOrtho(true);
      l.controls.target.copy(c);
      l.hh = r * 1.1;
      orthoCam.zoom = 1;
      layoutOrtho();
      const d = new THREE.Vector3(...VIEW_DIR[name]).normalize();
      orthoCam.position.copy(c).addScaledVector(d, r * 4);
      l.controls.update();
    };
    // Debug hook (development only, see docs/debugging.md): read and set the
    // camera so a tool can reproduce a view exactly.
    const w = window as unknown as { __viewer3d?: unknown };
    if (process.env.NODE_ENV !== "production")
      w.__viewer3d = {
        camera: () => ({
          ortho: l.camera === orthoCam,
          position: l.camera.position.toArray(),
          target: l.controls.target.toArray(),
          // ortho: half the visible height is hh / zoom; persp: the fov in degrees
          halfHeight: l.hh / orthoCam.zoom,
          fov: persp.fov,
        }),
        setCamera: (c: {
          ortho?: boolean;
          position: number[];
          target: number[];
          halfHeight?: number;
        }) => {
          l.setOrtho(!!c.ortho);
          l.controls.target.set(c.target[0]!, c.target[1]!, c.target[2]);
          l.camera.position.set(c.position[0]!, c.position[1]!, c.position[2]);
          if (c.ortho && c.halfHeight) {
            l.hh = c.halfHeight;
            orthoCam.zoom = 1;
            layoutOrtho();
          }
          l.controls.update();
          cb.current.onOrtho(!!c.ortho);
        },
        view: (name: ViewName) => l.view(name),
        /** Client (page) pixel of a world point, to aim a click(). */
        screen: (p: number[]) => {
          const r = dom.getBoundingClientRect(),
            v = new THREE.Vector3(p[0], p[1], p[2]).project(l.camera);
          return [
            r.left + ((v.x + 1) / 2) * r.width,
            r.top + ((1 - v.y) / 2) * r.height,
          ];
        },
        /** World point at fraction f (0 heel .. 1 toe) along a rail or section. */
        linePoint: (id: string, f: number) => {
          const { loft: lf } = lineRef.current,
            pts =
              lf.rails.find((r) => `rail:${r.role}` === id)?.pts ??
              lf.sections.find((x) => `section:${x.id}` === id)?.pts;
          return pts?.[Math.round(f * (pts.length - 1))] ?? null;
        },
        /** A left click at a client pixel, as the pointer events a user makes. */
        click: (x: number, y: number) => {
          const init = {
            clientX: x,
            clientY: y,
            button: 0,
            bubbles: true,
            pointerId: 1,
          };
          dom.dispatchEvent(new PointerEvent("pointerdown", init));
          dom.dispatchEvent(new PointerEvent("pointerup", init));
        },
      };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    // Markers keep a constant on-screen size.
    const unit = () =>
      l.camera === orthoCam
        ? (l.hh / orthoCam.zoom) * 0.03
        : l.camera.position.distanceTo(l.controls.target) * fov * 0.03;
    let raf = 0;
    const tick = () => {
      l.controls.update();
      const u = unit();
      // constant size in pixels, like the 2D canvas
      const px = u / (0.03 * l.size.h);
      for (const m of markerGroup.children)
        if (m.userData.marker) m.scale.setScalar(px * SPRITE_PX);
      renderer.render(scene, l.camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    // ---- picking and dragging markers --------------------------------
    const ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2();
    const setRay = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, l.camera);
    };
    // PICKING (decision): in SCREEN space, not by ray. The nearest marker whose
    // centre is within a fixed number of pixels of the pointer wins, so the
    // click target has the same size at every zoom and depth (the sprites are
    // drawn at constant pixel size, and a ray test against them was only as big
    // as the small glyph). Anchors get a larger reach than handle knobs, and
    // an anchor wins a near tie so it is never hidden by its own handle.
    const PICK_ANCHOR_PX = 16,
      PICK_HANDLE_PX = 12,
      proj = new THREE.Vector3();
    const pickMarker = (e: PointerEvent): Marker | null => {
      setRay(e);
      const r = dom.getBoundingClientRect(),
        d = ray.ray.direction;
      let best: Marker | null = null,
        bestScore = Infinity;
      for (const m of markerRef.current) {
        proj.set(...m.pos).project(l.camera);
        if (proj.z < -1 || proj.z > 1) continue;
        const dx = e.clientX - (r.left + ((proj.x + 1) / 2) * r.width),
          dy = e.clientY - (r.top + ((1 - proj.y) / 2) * r.height),
          dist = Math.hypot(dx, dy),
          reach = m.part === "anchor" ? PICK_ANCHOR_PX : PICK_HANDLE_PX;
        if (dist > reach) continue;
        // A marker whose drag plane is edge-on to the view cannot be moved
        // from here (an elevation point in the top view): skip it so a plan
        // point under it can be picked.
        if (
          m.kind !== "both" &&
          Math.abs(d.x * m.normal[0] + d.y * m.normal[1] + d.z * m.normal[2]) <
            0.08
        )
          continue;
        const score = dist - (m.part === "anchor" ? 4 : 0);
        if (score < bestScore) {
          best = m;
          bestScore = score;
        }
      }
      return best;
    };
    // LINE PICKING (decision): also in screen space. A click that misses every
    // marker selects the nearest rail or section line within LINE_PICK_PX, so a
    // whole curve can be selected and worked with (shown in the 2D views).
    const LINE_PICK_PX = 7,
      a3 = new THREE.Vector3(),
      b3 = new THREE.Vector3();
    const pickLine = (e: PointerEvent): string | null => {
      const r = dom.getBoundingClientRect(),
        { loft: lf, opts: op } = lineRef.current,
        px = (v: THREE.Vector3) =>
          [
            r.left + ((v.x + 1) / 2) * r.width,
            r.top + ((1 - v.y) / 2) * r.height,
          ] as const;
      let best: string | null = null,
        bestD = LINE_PICK_PX;
      const test = (
        id: string,
        pts: readonly (readonly number[])[],
        closed: boolean,
      ) => {
        const n = pts.length;
        for (let i = 0; i < (closed ? n : n - 1); i++) {
          const p = pts[i]!,
            q = pts[(i + 1) % n]!;
          a3.set(p[0]!, p[1]!, p[2]).project(l.camera);
          b3.set(q[0]!, q[1]!, q[2]).project(l.camera);
          const [ax, ay] = px(a3),
            [bx, by] = px(b3),
            vx = bx - ax,
            vy = by - ay,
            len2 = vx * vx + vy * vy,
            t =
              len2 === 0
                ? 0
                : Math.max(
                    0,
                    Math.min(
                      1,
                      ((e.clientX - ax) * vx + (e.clientY - ay) * vy) / len2,
                    ),
                  ),
            d = Math.hypot(
              e.clientX - (ax + t * vx),
              e.clientY - (ay + t * vy),
            );
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
      };
      if (op.rails)
        for (const rl of lf.rails) test(`rail:${rl.role}`, rl.pts, false);
      if (op.sections)
        for (const sc of lf.sections) test(`section:${sc.id}`, sc.pts, true);
      return best;
    };
    const planeHit = (m: Marker): THREE.Vector3 | null => {
      const n =
          m.kind === "both"
            ? l.camera.getWorldDirection(new THREE.Vector3())
            : new THREE.Vector3(...m.normal),
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          n,
          new THREE.Vector3(...m.pos),
        );
      // a ray nearly parallel to the plane would fling the point away
      if (Math.abs(ray.ray.direction.dot(n)) < 0.08) return null;
      return ray.ray.intersectPlane(plane, new THREE.Vector3());
    };
    let drag: { m: Marker; off: THREE.Vector3 } | null = null,
      down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const hit = pickMarker(e);
      if (!hit) {
        down = { x: e.clientX, y: e.clientY };
        return;
      }
      e.stopImmediatePropagation();
      const m = hit;
      setRay(e);
      const p = planeHit(m);
      drag = {
        m,
        off: p ? p.sub(new THREE.Vector3(...m.pos)) : new THREE.Vector3(),
      };
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer (debug click) has nothing to capture */
      }
      cb.current.onPick(m.id);
      cb.current.onDragStart(m.id);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) {
        dom.style.cursor = pickMarker(e) ? "pointer" : "";
        return;
      }
      setRay(e);
      const p = planeHit(drag.m);
      if (p) {
        p.sub(drag.off);
        cb.current.onDrag(drag.m.id, [p.x, p.y, p.z], e.shiftKey);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (drag) {
        drag = null;
        cb.current.onDragEnd();
      } else if (
        down &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4
      ) {
        const id = pickLine(e);
        if (id) cb.current.onPickLine(id);
        else cb.current.onPick(null);
      }
      down = null;
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
      )
        return;
      if (e.key === "Escape" && drag) {
        drag = null;
        cb.current.onDragCancel();
        return;
      }
      const k = keyView(e);
      if (!k) return;
      e.preventDefault();
      if (k === "ortho") {
        const v = l.camera !== orthoCam;
        l.setOrtho(v);
        cb.current.onOrtho(v);
      } else l.view(k);
    };
    dom.addEventListener("pointerdown", onDown, { capture: true });
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);

    return () => {
      delete w.__viewer3d;
      cancelAnimationFrame(raf);
      observer.disconnect();
      dom.removeEventListener("pointerdown", onDown, { capture: true });
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      l.controls.dispose();
      clear(content);
      clear(markerGroup);
      renderer.dispose();
      dom.remove();
      live.current = null;
    };
  }, []);

  // Surface, rails, sections.
  useEffect(() => {
    const l = live.current;
    if (!l) return;
    clear(l.content);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(loft.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(loft.indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    l.bounds.copy(geo.boundingBox ?? new THREE.Box3());
    if (opts.surface)
      l.content.add(
        new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: SURFACE_COLOUR,
            roughness: 0.48,
            metalness: 0.08,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 2,
            polygonOffsetUnits: 2,
          }),
        ),
      );
    if (opts.wire)
      l.content.add(
        new THREE.LineSegments(
          new THREE.WireframeGeometry(geo),
          new THREE.LineBasicMaterial({
            color: 0x2c4a47,
            transparent: true,
            opacity: 0.3,
          }),
        ),
      );
    // the selected line is drawn amber and a little thicker
    const lit = (id: string) =>
      highlight === id ||
      (highlight === "top" && (id === "rail:lateral" || id === "rail:medial"));
    const stroke = (
      id: string,
      pts: readonly (readonly number[])[],
      colour: number,
      loop = false,
    ) =>
      l.content.add(
        strokes(l.size, pts, {
          colour: lit(id) ? LINE_LIT : colour,
          width: lit(id) ? LINE_LIT_PX : LINE_PX,
          loop,
        }),
      );
    if (opts.rails)
      for (const r of loft.rails)
        stroke(
          `rail:${r.role}`,
          r.pts,
          r.role === "sole"
            ? SOLE_COLOUR
            : r.role === "crown"
              ? SECTION_COLOUR
              : RAIL_COLOUR,
        );
    if (opts.sections)
      for (const s of loft.sections)
        stroke(`section:${s.id}`, s.pts, SECTION_COLOUR, true);
    const grid = new THREE.GridHelper(400, 40, 0xa9b6c9, 0xd0d9e6);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 135, 0);
    l.content.add(grid);
    if (!l.fitted) {
      l.controls.target.set(0, 135, 30);
      l.persp.position.set(-330, -150, 220);
      l.controls.update();
      l.fitted = true;
    }
  }, [loft, opts, highlight]);

  useEffect(() => {
    live.current?.setOrtho(opts.ortho);
  }, [opts.ortho]);

  useEffect(() => {
    if (viewCmd.n) live.current?.view(viewCmd.name);
  }, [viewCmd]);

  // Control-point markers (rebuilt on every change; ids keep a drag alive).
  useEffect(() => {
    const l = live.current;
    if (!l) return;
    clear(l.markers);
    if (!opts.edit) return;
    // Every marker is drawn twice (decision): a faint copy that ignores depth,
    // so points behind the surface stay findable, and a solid copy that the
    // surface hides, so the points on the visible side stand out.
    const GHOST = 0.28;
    const sprite = (map: THREE.Texture, ghost: boolean, id: string) => {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map,
          depthTest: !ghost,
          depthWrite: false,
          transparent: true,
          opacity: ghost ? GHOST : 1,
        }),
      );
      sp.renderOrder = ghost ? 10 : 15;
      sp.userData = { id };
      return sp;
    };
    for (const m of markers) {
      if (m.part === "anchor") {
        const g = new THREE.Group(),
          map = anchorTexture(m.mode, m.id === selectedId);
        for (const ghost of [true, false]) g.add(sprite(map, ghost, m.id));
        g.position.set(...m.pos);
        g.userData = { marker: true, id: m.id };
        l.markers.add(g);
        continue;
      }
      if (!m.from || m.owner !== selectedId) continue;
      const style = handleStyle(m.curve),
        map = knobTexture(style, m.mode === "auto"),
        h = new THREE.Group();
      for (const ghost of [true, false]) h.add(sprite(map, ghost, m.id));
      // the handle's line (one solid and one faint pass, see LINES), drawn once
      l.markers.add(
        strokes(l.size, [m.from, m.pos], {
          colour: Number.parseInt(HANDLE_COLOUR[style].slice(1), 16),
          width: HANDLE_LINE_PX,
          base: 5,
        }),
      );
      h.position.set(...m.pos);
      h.userData = { marker: true, id: m.id };
      l.markers.add(h);
    }
  }, [markers, selectedId, opts.edit]);

  return <div ref={host} className={styles.viewer3d} />;
}

function clear(g: THREE.Group) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      const x = o as THREE.Mesh | THREE.Line | THREE.LineSegments;
      // Sprites share one geometry and the cached marker textures: keep both.
      if (!(o instanceof THREE.Sprite)) x.geometry?.dispose();
      const m = x.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((y) => y.dispose());
      else m?.dispose();
    });
  }
}
