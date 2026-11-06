"use client";

import Link from "next/link";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  historyReducer,
  initHistory,
  parseCurve,
  type EditableCurve,
  type HistoryAction,
  type Vec2,
  sampleCurve,
} from "~/lib/curves";
import {
  defaultDoc,
  docFromTop,
  parseDoc,
  reconcileDoc,
  serializeDoc,
  upgradeDoc,
  withCurve,
  withPlanLoop,
  withRail,
  withCut,
  withSection,
  type StudioDoc,
} from "~/lib/studio/document";
import {
  bottomDrives,
  dorsalDrives,
  sideContext,
  sideDiagnostics,
  validContext,
  type Drive,
} from "~/lib/studio/side";
import {
  buildContour,
  flatToPosed,
  splitContour,
  upperFrame,
  upperFromPosed,
  upperToPosed,
} from "~/lib/studio/contour";
import {
  ELEV_ROLES,
  RAIL_LABEL,
  type ElevRole,
  cutCrossing,
  hasPlan,
  railValues,
} from "~/lib/studio/rails";
import {
  PAIR_LABEL,
  joinLoop,
  loopDrives,
  pairRoles,
  type PairKind,
} from "~/lib/studio/rail-loop";
import { buildLoft } from "~/lib/studio/loft";
import {
  linesOf,
  railLine,
  sectionLine,
  type Focus,
  type Line,
  type LineId,
} from "~/lib/studio/focus";
import { OutlineSelect, RailNote, SideCurveSelect } from "./RailView";
import { cutZ, type TopCut } from "~/lib/studio/cut";
import {
  DEFAULT_VIEWER,
  Viewer3D,
  type ViewCommand,
  type ViewName,
  type ViewerOptions,
} from "./Viewer3D";
import { dragMarker, editMarkers, type Marker } from "~/lib/studio/space-edit";
import {
  SECTION_IDS,
  SECTION_LABEL,
  heightAtStation,
  sectionDrives,
  sectionGeometry,
  type SectionId,
} from "~/lib/studio/section";
import { SectionGuides, SectionInfo, SectionTabs } from "./SectionView";
import { TOP_ROLES, roleLabel, topMeasures } from "~/lib/studio/top-outline";
import { CurveCanvas, type Tool } from "../curve/CurveCanvas";
import { NumberField, PointProperties } from "../curve/Inspector";
import { useCurveShortcuts } from "../curve/useCurveShortcuts";
import {
  parseRefImage,
  newRefImage,
  serializeRefImage,
  type RefImage,
} from "~/lib/studio/reference-image";
import { readImageFile } from "~/lib/studio/image-file";
import { ImagePanel } from "./ImagePanel";
import { Browser, Measures } from "./Panels";
import { SideGuides } from "./SideGuides";
import { Diagnostics, DriveChips, SideParameters } from "./SidePanel";
import { TopGuides } from "./TopGuides";
import styles from "./studio.module.css";

const STORAGE_KEY = "last-studio.document.v2";
// Version 1 saved only the top outline as a bare curve; it is migrated, not dropped.
const LEGACY_KEY = "last-studio.top-outline.v1";

/** Studio only renders on the client, so storage is safe to read during init. */
function loadSaved(): StudioDoc | null {
  try {
    const v2 = localStorage.getItem(STORAGE_KEY);
    if (v2) return reconcileDoc(upgradeDoc(parseDoc(v2)));
    const v1 = localStorage.getItem(LEGACY_KEY);
    return v1 ? docFromTop(parseCurve(v1)) : null;
  } catch {
    return null; // unavailable or corrupt: fall back to the default document
  }
}

/**
 * Reference images live outside the document and undo history (workspace aid,
 * see reference-image.ts): one per edit space, in their own storage keys so a
 * large image can fail to save without losing the model.
 */
type Slot = "top" | "side" | `section-${SectionId}`;
const IMAGE_KEY = (t: Slot) => `last-studio.image.v1.${t}`;
// One image per section: each is a separate contour-gauge tracing.
const TARGETS: readonly Slot[] = [
  "top",
  "side",
  ...SECTION_IDS.map((id): Slot => `section-${id}`),
];
type Images = Record<Slot, RefImage | null>;
function loadImages(): Images {
  const out = Object.fromEntries(TARGETS.map((t) => [t, null])) as Images;
  for (const t of TARGETS)
    try {
      const raw = localStorage.getItem(IMAGE_KEY(t));
      if (raw) out[t] = parseRefImage(raw);
    } catch {
      out[t] = null;
    }
  return out;
}

type Space = "top" | "side" | "section";
type Pane = "top" | "side" | "section" | "3d";
type View = Space | "3d" | "work";
const VIEWS: readonly {
  id: View;
  label: string;
  ready: boolean;
  /** Shown before the first tab of a group. Outlines are longitudinal curves
   *  (top, side); sections are cuts across the last. */
  group?: string;
}[] = [
  { id: "work", label: "Workspace", ready: true, group: "Workspace" },
  { id: "top", label: "Top", ready: true, group: "Outlines" },
  { id: "side", label: "Side", ready: true },
  { id: "section", label: "Section", ready: true, group: "Sections" },
  { id: "3d", label: "3D", ready: true, group: "Model" },
];

const EMPTY: readonly Drive[] = [];
const PANELS_KEY = "last-studio.panels.v1";

// Dragging an image updates state every move; it is persisted when the drag
// settles (one timer: only the last image written counts).
let imageTimer: number | undefined;
function saveImageSoon(slot: Slot, img: RefImage, onError: () => void) {
  window.clearTimeout(imageTimer);
  imageTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(IMAGE_KEY(slot), serializeRefImage(img));
    } catch {
      onError();
    }
  }, 300);
}

export function Studio() {
  const [history, dispatch] = useReducer(
    historyReducer<StudioDoc>,
    undefined,
    () => initHistory(loadSaved() ?? defaultDoc()),
  );
  const doc = history.present;
  const [images, setImages] = useState<Images>(loadImages);
  const [imageError, setImageError] = useState<string | null>(null);
  const [view, setView] = useState<View>("work");
  // In the workspace: the pane that owns the browser, inspector and shortcuts.
  const [activePane, setActivePane] = useState<Pane>("3d");
  // The line (rail, outline, section) the 2D panes were last pointed at.
  const [lineId, setLineId] = useState<LineId | null>(null);
  const [sectionId, setSectionId] = useState<SectionId>("ball");
  // Which outline the Top view edits, and which curve the Side view edits.
  const [outline, setOutline] = useState<"top" | PairKind>("top");
  const [sideCurve, setSideCurve] = useState<"centre" | ElevRole>("centre");
  const [viewer, setViewer] = useState<ViewerOptions>(DEFAULT_VIEWER);
  const [viewCmd, setViewCmd] = useState<ViewCommand>({ name: "frame", n: 0 });
  const [sel3d, setSel3d] = useState<string | null>(null);
  const drag3 = useRef<{ base: StudioDoc; m: Marker } | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [cursor, setCursor] = useState<{ sp: Space; p: Vec2 } | null>(null);
  const [snapOn, setSnapOn] = useState(false);
  const [snapSize, setSnapSize] = useState(5);
  const [showComb, setShowComb] = useState(false);
  const [showHandles, setShowHandles] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [saved, setSaved] = useState<"idle" | "saved">("idle");
  // Side panels can be collapsed to give the model the room (remembered).
  const [panels, setPanels] = useState<{ left: boolean; right: boolean }>(
    () => {
      try {
        const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "null") as {
          left?: unknown;
          right?: unknown;
        } | null;
        return { left: v?.left !== false, right: v?.right !== false };
      } catch {
        return { left: true, right: true };
      }
    },
  );
  useEffect(() => {
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
    } catch {
      /* not remembered */
    }
  }, [panels]);

  const ctx = useMemo(
    () => sideContext(doc.top, doc.params),
    [doc.top, doc.params],
  );
  const valid = useMemo(() => validContext(ctx), [ctx]);
  const geom = useMemo(
    () => sectionGeometry(doc.top, doc.dorsal, sectionId),
    [doc.top, doc.dorsal, sectionId],
  );
  const secDrives = useMemo(
    () => (geom ? sectionDrives(geom, railValues(geom, doc.rails)) : EMPTY),
    [geom, doc.rails],
  );
  // The upper is posed through a reference sole (see contour.ts); the contour
  // is the sole plus the posed upper as one closed loop.
  const frame = useMemo(() => (valid ? upperFrame(valid) : null), [valid]);
  const contour = useMemo(
    () => (frame ? buildContour(frame, doc.bottom, doc.dorsal) : null),
    [frame, doc.bottom, doc.dorsal],
  );
  // A sole-edge / upper-edge outline: the pair of plan rails as one closed loop.
  const loop = useMemo(
    () =>
      outline === "top"
        ? null
        : joinLoop(
            doc.rails.plan[pairRoles(outline).medial],
            doc.rails.plan[pairRoles(outline).lateral],
          ),
    [outline, doc.rails],
  );
  // The rail picked in the Side view, shown with the heel height applied.
  const sideRail = useMemo(
    () =>
      sideCurve === "centre"
        ? null
        : frame
          ? upperToPosed(frame, doc.rails.elev[sideCurve])
          : doc.rails.elev[sideCurve],
    [sideCurve, doc.rails, frame],
  );
  const sc: SpaceCtx = {
    doc,
    dispatch,
    ctx,
    valid,
    frame,
    contour,
    geom,
    secDrives,
    loop,
    sideRail,
    outline,
    sideCurve,
    sectionId,
  };
  // One model per 2D edit space, always computed: the workspace shows the top
  // and side panes at once, and each edits its own curve with its own selection.
  const topSpace = useSpace("top", sc),
    sideSpace = useSpace("side", sc),
    sectionSpace = useSpace("section", sc),
    spaces = { top: topSpace, side: sideSpace, section: sectionSpace };
  // The space that owns the browser, inspector, shortcuts and image panel. The
  // 3D view has no curve of its own: it keeps the top outline's, as before.
  const space: Space | "3d" =
    view === "work" ? (activePane === "3d" ? "3d" : activePane) : view;
  const A = space === "3d" ? topSpace : spaces[space];
  const { slot, curve, activeDrives, selected, setSelected, curveDispatch } = A;
  const in3d = view === "3d" || view === "work";
  const docRef = useRef(doc);
  const frameRef = useRef(frame);
  useEffect(() => {
    docRef.current = doc;
    frameRef.current = frame;
  });

  const image = images[slot];
  const setImage = (img: RefImage | null, at: Slot = slot) => {
    setImages((m) => ({ ...m, [at]: img }));
    setImageError(null);
    try {
      if (img) localStorage.setItem(IMAGE_KEY(at), serializeRefImage(img));
      else localStorage.removeItem(IMAGE_KEY(at));
    } catch {
      setImageError("Image shown, but too large to keep after reload.");
    }
  };
  const uploadImage = (file: File) => {
    readImageFile(file)
      .then(({ src, aspect }) =>
        setImage(newRefImage(src, file.name, aspect, sampleCurve(curve, 12))),
      )
      .catch((e: unknown) =>
        setImageError(
          e instanceof Error ? e.message : "Could not read the image.",
        ),
      );
  };

  useEffect(() => {
    if (history.base) return;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeDoc(doc));
        setSaved("saved");
      } catch {
        /* ignore */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [doc, history.base]);

  const diagnostics = useMemo(
    () => sideDiagnostics(ctx, doc.bottom),
    [ctx, doc.bottom],
  );
  const measures = useMemo(() => topMeasures(doc.top), [doc.top]);
  // Other outlines as faint guides in the Top view.
  const outlineGuides = useMemo(() => {
    const closed = (c: EditableCurve, n: number) => {
      const pts = sampleCurve(c, n);
      return pts.length ? [...pts, pts[0]!] : pts;
    };
    return [
      ...(["bottom", "shoulder"] as const)
        .filter((k) => k !== outline)
        .map((k) => ({
          role: k,
          plan: closed(
            joinLoop(
              doc.rails.plan[pairRoles(k).medial],
              doc.rails.plan[pairRoles(k).lateral],
            ),
            16,
          ),
        })),
      ...(outline === "top"
        ? []
        : [{ role: "top", plan: closed(doc.top, 24) }]),
    ];
  }, [doc.rails, doc.top, outline]);
  // Rails seen from the side, with the heel height applied, as faint guides.
  const railsPosed = useMemo(
    () =>
      frame
        ? ELEV_ROLES.filter((r) => r !== sideCurve).map((r) => ({
            role: r,
            posed: sampleCurve(doc.rails.elev[r], 16).map((p) =>
              flatToPosed(frame, p),
            ),
          }))
        : [],
    [doc.rails, frame, sideCurve],
  );
  // Where each section meets the rail being edited in the Side view.
  const railMarks = useMemo<Vec2[]>(() => {
    if (!frame || sideCurve === "centre") return [];
    return SECTION_IDS.flatMap((id) => {
      const g = sectionGeometry(doc.top, doc.dorsal, id);
      if (!g) return [];
      const y = hasPlan(sideCurve)
        ? cutCrossing(
            g,
            doc.rails.plan[sideCurve],
            sideCurve.startsWith("medial") ? "medial" : "lateral",
          )?.y
        : sideCurve === "medial"
          ? g.medial[1]
          : g.lateral[1];
      const z =
        y === undefined ? null : heightAtStation(doc.rails.elev[sideCurve], y);
      return y === undefined || z === null ? [] : [flatToPosed(frame, [y, z])];
    });
  }, [frame, sideCurve, doc.top, doc.dorsal, doc.rails]);
  const loft = useMemo(
    () =>
      in3d
        ? buildLoft(doc, viewer.pose ? frame : null, { topCut: viewer.topCut })
        : null,
    [in3d, doc, viewer.pose, viewer.topCut, frame],
  );
  // Debug hook (development only, see docs/debugging.md): lets a tool read the
  // live model and view state and load another model, without any UI.
  const live = useRef({ doc, view, viewer, sel3d });
  useEffect(() => {
    live.current = { doc, view, viewer, sel3d };
  });
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __studio?: unknown };
    w.__studio = {
      /** The live document as the same JSON that is saved and shared. */
      doc: () => serializeDoc(live.current.doc),
      /** Load a document (one undo step, so Ctrl+Z restores the old one). */
      setDoc: (text: string) =>
        dispatch({
          type: "commit",
          value: reconcileDoc(upgradeDoc(parseDoc(text))),
        }),
      state: () => ({
        view: live.current.view,
        viewer: live.current.viewer,
        selected3d: live.current.sel3d,
      }),
      setView: (v: View) => setView(v),
      setViewer: (o: Partial<ViewerOptions>) =>
        setViewer((x) => ({ ...x, ...o })),
    };
    return () => {
      delete w.__studio;
    };
  }, []);
  // Control points editable in 3D (handles only for the selected one).
  const markers = useMemo(
    () =>
      in3d && viewer.edit
        ? editMarkers(doc, viewer.pose ? frame : null, sel3d)
        : [],
    [in3d, viewer.edit, viewer.pose, doc, frame, sel3d],
  );
  // Cut lines drawn in the top view, one per section.
  const cuts = useMemo(
    () =>
      SECTION_IDS.flatMap((id) => {
        const g = sectionGeometry(doc.top, doc.dorsal, id);
        return g ? [{ id, a: g.medial, b: g.lateral }] : [];
      }),
    [doc.top, doc.dorsal],
  );

  useCurveShortcuts({
    curve,
    // In 3D the 2D selection must not react to mode/delete/nudge keys.
    selected: space === "3d" ? null : selected,
    tool,
    setTool,
    setSelected,
    dispatch: curveDispatch,
    canDelete: A.canDelete,
    locks: A.locks,
    hasImage: !!image,
  });

  const { labelOf, locks, canDelete, axes, fieldAxes } = A;
  const selRole = selected === null ? undefined : curve.points[selected]?.role;
  const go = (v: View) => {
    setView(v);
    if (v !== "work" && v !== "3d") spaces[v].setSelected(null);
    setTool("select");
    setFitSignal((n) => n + 1);
  };

  // ---- selection, shared by the panes --------------------------------
  const changeOutline = (o: "top" | PairKind) => {
    setOutline(o);
    topSpace.setSelected(null);
    setTool("select");
    setFitSignal((n) => n + 1);
  };
  const changeSideCurve = (c: "centre" | ElevRole) => {
    setSideCurve(c);
    sideSpace.setSelected(null);
    setTool("select");
    setFitSignal((n) => n + 1);
  };
  const changeSection = (id: SectionId) => {
    setSectionId(id);
    sectionSpace.setSelected(null);
    setTool("select");
    setFitSignal((n) => n + 1);
  };
  // Point the 2D panes at a line (see focus.ts): each pane named by the focus
  // switches to that curve, and the selected point, if any, is selected there.
  const applyFocus = (f: Focus) => {
    if (f.outline) setOutline(f.outline);
    if (f.sideCurve) setSideCurve(f.sideCurve);
    if (f.section) {
      setSectionId(f.section);
      sectionSpace.setSelected(f.sectionIndex ?? null);
    }
    if (f.outline) topSpace.setSelected(f.topIndex ?? null);
    if (f.sideCurve) sideSpace.setSelected(f.sideIndex ?? null);
    setFitSignal((n) => n + 1);
  };
  const showLine = (l: Line) => {
    setLineId(l.id);
    applyFocus(l.focus);
  };
  const planCounts = (k: PairKind) =>
    [
      doc.rails.plan[pairRoles(k).medial].points.length,
      doc.rails.plan[pairRoles(k).lateral].points.length,
    ] as const;
  // The lines through the selected 3D point; the first is shown by default.
  const selMarker = sel3d
    ? markers.find((m) => m.id === sel3d && m.part === "anchor")
    : undefined;
  const selLines = selMarker ? linesOf(selMarker.members, planCounts) : [];
  const pick3d = (id: string | null) => {
    setSel3d(id);
    const m = id ? markers.find((x) => x.id === id) : undefined;
    if (m?.part === "anchor") {
      const first = linesOf(m.members, planCounts)[0];
      if (first) showLine(first);
    }
  };
  const pickLine3d = (id: string) => {
    setSel3d(null);
    const [kind, name] = id.split(":") as ["rail" | "section", string];
    showLine(
      kind === "section"
        ? sectionLine(name as SectionId)
        : railLine(name as Parameters<typeof railLine>[0]),
    );
  };
  // A point picked in a 2D pane is selected in 3D too, where the curves agree.
  const pick2d = (sp: Space, i: number | null) => {
    spaces[sp].setSelected(i);
    if (i === null || !in3d) return;
    const key =
      sp === "top" && outline === "top"
        ? "top"
        : sp === "side" && sideCurve !== "centre"
          ? `elev:${sideCurve}`
          : sp === "section"
            ? `section:${sectionId}`
            : null;
    const m = markers.find(
      (x) =>
        x.part === "anchor" &&
        x.members.some((mm) => mm.curve === key && mm.index === i),
    );
    if (m) setSel3d(m.id);
  };

  const setImageIn = (sl: Slot, img: RefImage) => {
    setImages((m) => ({ ...m, [sl]: img }));
    saveImageSoon(sl, img, () =>
      setImageError("Image shown, but too large to keep after reload."),
    );
  };
  const canvasFor = (sp: Space) => {
    const M = spaces[sp];
    return (
      <CurveCanvas
        curve={M.curve}
        selected={M.selected}
        tool={sp === space ? tool : "select"}
        snap={snapOn ? snapSize : null}
        showComb={showComb}
        combGain={600}
        showAllHandles={showHandles}
        fitSignal={fitSignal}
        fitPoints={M.fitPoints}
        image={images[M.slot]}
        onImageChange={(img) => setImageIn(M.slot, img)}
        rulers
        label={M.labelOf}
        locks={M.locks}
        canDelete={M.canDelete}
        onCursor={(p) => setCursor(p && { sp, p })}
        onSelect={(i) => pick2d(sp, i)}
        dispatch={M.curveDispatch}
        underlay={(t) =>
          !showGuides ? null : sp === "top" ? (
            <TopGuides
              t={t}
              m={measures}
              cuts={cuts}
              active={sectionId}
              rails={outlineGuides}
            />
          ) : sp === "section" ? (
            geom ? (
              <SectionGuides t={t} g={geom} sections={doc.sections} />
            ) : null
          ) : valid ? (
            <SideGuides
              t={t}
              ctx={valid}
              contour={contour}
              bottom={doc.bottom}
              rails={railsPosed}
              marks={railMarks}
              cutLine={viewer.topCut && frame ? cutZ(doc.cut, frame) : null}
            />
          ) : null
        }
      />
    );
  };
  const viewer3d = loft && (
    <Viewer3D
      loft={loft}
      opts={viewer}
      markers={markers}
      selectedId={sel3d}
      highlight={lineId}
      viewCmd={viewCmd}
      onPick={pick3d}
      onPickLine={pickLine3d}
      onOrtho={(v) => setViewer((o) => ({ ...o, ortho: v }))}
      onDragStart={(id) => {
        const m = markers.find((x) => x.id === id);
        if (m) drag3.current = { base: docRef.current, m };
      }}
      onDrag={(_id, hit, shift) => {
        const d = drag3.current;
        if (d)
          dispatch({
            type: "preview",
            value: dragMarker(
              d.base,
              viewer.pose ? frameRef.current : null,
              d.m,
              hit,
              shift,
            ),
          });
      }}
      onDragEnd={() => {
        drag3.current = null;
        dispatch({ type: "finish" });
      }}
      onDragCancel={() => {
        drag3.current = null;
        dispatch({ type: "cancel" });
      }}
    />
  );
  // A workspace pane (see `Pane`): clicking inside makes it the active one.
  const pane = (
    id: Pane,
    title: string,
    children: ReactNode,
    bar?: ReactNode,
  ) => (
    <Pane
      id={id}
      title={title}
      active={activePane === id}
      onActivate={() => setActivePane(id)}
      onOpen={id === "3d" ? undefined : () => go(id)}
      bar={bar}
    >
      {children}
    </Pane>
  );

  return (
    <div
      className={`${styles.shell} ${styles.theme}`}
      style={{
        gridTemplateColumns: `44px ${panels.left ? "224px" : "0px"} minmax(0, 1fr) ${panels.right ? "296px" : "0px"}`,
      }}
    >
      <header className={styles.titlebar}>
        <Link href="/" className={styles.brand}>
          Last<span>studio</span>
        </Link>
        <span className={styles.docName}>Untitled last</span>
        <span className={styles.unit}>mm</span>
        <div className={styles.titleActions}>
          <button
            type="button"
            disabled={!history.past.length}
            onClick={() => dispatch({ type: "undo" })}
            title="Undo (⌘Z)"
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!history.future.length}
            onClick={() => dispatch({ type: "redo" })}
            title="Redo (⇧⌘Z)"
          >
            Redo
          </button>
        </div>
      </header>

      <nav className={styles.tools} aria-label="Tools">
        <button
          type="button"
          data-active={tool === "select" || undefined}
          onClick={() => setTool("select")}
          title="Select (V)"
          aria-pressed={tool === "select"}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M4 2l11 8-5 1.2L12.5 17l-2.2 1-2.5-5.8L4 15z" />
          </svg>
        </button>
        <button
          type="button"
          data-active={tool === "image" || undefined}
          onClick={() => setTool("image")}
          disabled={!image}
          title={
            image
              ? "Move / scale reference image (I)"
              : "Upload a reference image first"
          }
          aria-pressed={tool === "image"}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M3 4h14v12H3zM3 13l4-4 3 3 3-2 4 4M13 7.5h.01" />
          </svg>
        </button>
        <button
          type="button"
          data-active={tool === "pen" || undefined}
          onClick={() => setTool("pen")}
          title="Pen: add and insert points (P)"
          aria-pressed={tool === "pen"}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M3 17l1-4 9-9 3 3-9 9zM12 5l3 3" />
          </svg>
        </button>
      </nav>

      <aside className={styles.browser} aria-label="Browser">
        {space === "3d" ? (
          <ViewerPanel
            opts={viewer}
            set={setViewer}
            cut={doc.cut}
            onCut={(patch) =>
              dispatch({ type: "commit", value: withCut(doc, patch) })
            }
            onView={(name) => setViewCmd((c) => ({ name, n: c.n + 1 }))}
          />
        ) : (
          <Browser
            title={
              space === "top"
                ? outline === "top"
                  ? "Top outline"
                  : PAIR_LABEL[outline]
                : space === "section"
                  ? `Section · ${SECTION_LABEL[sectionId]}`
                  : sideCurve === "centre"
                    ? "Side · contour (elevated)"
                    : `Side · ${RAIL_LABEL[sideCurve]} rail`
            }
            curve={curve}
            selected={selected}
            onSelect={setSelected}
            labelOf={labelOf}
            toggles={[
              {
                label: "Construction guides",
                on: showGuides,
                set: setShowGuides,
              },
              { label: "Handles", on: showHandles, set: setShowHandles },
              { label: "Curvature comb", on: showComb, set: setShowComb },
            ]}
            extra={
              <ImagePanel
                image={image}
                around={sampleCurve(curve, 12)}
                active={tool === "image"}
                error={imageError}
                onUpload={uploadImage}
                onChange={setImage}
                onToggleTool={() =>
                  setTool(tool === "image" ? "select" : "image")
                }
              />
            }
            resetLabel={
              space === "top"
                ? "Reset outline"
                : space === "section"
                  ? "Reset section"
                  : sideCurve !== "centre"
                    ? "Reset rail"
                    : "Reset side view"
            }
            onReset={() => {
              const fresh = defaultDoc();
              dispatch({
                type: "commit",
                value:
                  space === "top"
                    ? outline === "top"
                      ? reconcileDoc({ ...doc, top: fresh.top })
                      : withPlanLoop(
                          doc,
                          outline,
                          joinLoop(
                            fresh.rails.plan[pairRoles(outline).medial],
                            fresh.rails.plan[pairRoles(outline).lateral],
                          ),
                        )
                    : space === "section"
                      ? withSection(doc, sectionId, fresh.sections[sectionId])
                      : sideCurve !== "centre"
                        ? withRail(
                            doc,
                            "elev",
                            sideCurve,
                            fresh.rails.elev[sideCurve],
                          )
                        : reconcileDoc({
                            ...doc,
                            params: fresh.params,
                            bottom: fresh.bottom,
                            dorsal: fresh.dorsal,
                            unlocked: [],
                          }),
              });
              setSelected(null);
              setFitSignal((n) => n + 1);
            }}
          />
        )}
      </aside>

      <main className={styles.viewport}>
        <div className={styles.viewTabs} role="tablist" aria-label="Views">
          {VIEWS.map((v) => (
            <Fragment key={v.id}>
              {v.group && <span className={styles.tabGroup}>{v.group}</span>}
              <button
                type="button"
                role="tab"
                aria-selected={v.id === view}
                disabled={!v.ready}
                data-active={v.id === view || undefined}
                title={v.ready ? undefined : "Coming in a later step"}
                onClick={() => go(v.id)}
              >
                {v.label}
                {!v.ready && <em>soon</em>}
              </button>
            </Fragment>
          ))}
          {view === "section" && (
            <SectionTabs value={sectionId} onChange={changeSection} />
          )}
          {view === "top" && (
            <OutlineSelect value={outline} onChange={changeOutline} />
          )}
          {view === "side" && (
            <SideCurveSelect value={sideCurve} onChange={changeSideCurve} />
          )}
          <span className={styles.panelToggles}>
            <button
              type="button"
              data-active={panels.left || undefined}
              aria-pressed={panels.left}
              title="Show or hide the left panel (browser)"
              onClick={() => setPanels((p) => ({ ...p, left: !p.left }))}
            >
              ◧
            </button>
            <button
              type="button"
              data-active={panels.right || undefined}
              aria-pressed={panels.right}
              title="Show or hide the right panel (properties)"
              onClick={() => setPanels((p) => ({ ...p, right: !p.right }))}
            >
              ◨
            </button>
          </span>
        </div>
        {view === "work" ? (
          <div className={styles.workspace}>
            {pane("3d", "3D", viewer3d)}
            {pane(
              "top",
              "Top",
              canvasFor("top"),
              <OutlineSelect value={outline} onChange={changeOutline} />,
            )}
            {pane(
              "side",
              "Side",
              canvasFor("side"),
              <SideCurveSelect value={sideCurve} onChange={changeSideCurve} />,
            )}
            {pane(
              "section",
              "Section",
              canvasFor("section"),
              <SectionTabs value={sectionId} onChange={changeSection} />,
            )}
          </div>
        ) : (
          <div className={styles.canvasHost}>
            {view === "3d" ? viewer3d : canvasFor(view)}
          </div>
        )}
      </main>

      <aside className={styles.properties} aria-label="Properties">
        {space === "side" && (
          <>
            <SideParameters doc={doc} ctx={ctx} dispatch={dispatch} />
            <Diagnostics items={diagnostics} />
          </>
        )}
        {space === "3d" ? (
          <section className={styles.sectionNote}>
            <p>
              <b>Lofted surface</b>
            </p>
            <p>
              Built from the eight rails and the four sections (see
              docs/specs/studio-parametric-model.md). Drag to orbit, scroll to
              zoom, right-drag to pan.
            </p>
            <p>
              <b>Edit points:</b> one marker per place, in the style of the 2D
              views (diamond auto, circle smooth, ring symmetric, square
              corner). Click one to select it (amber): its handles appear, one
              pair per curve through it, blue for a rail (plan and elevation
              together), orange for the section, grey for the top outline. Drag
              to move (a point on several curves moves in the plane facing the
              camera), Shift keeps the larger move, Esc cancels. Points behind
              the surface are faint. Adding and deleting points and the centre
              contour are edited in the 2D views.
            </p>
            <p>
              <b>Lines:</b> click a rail or section line to select the whole
              curve, or select a point to get the lines through it. The selected
              line is lit amber and opens in the Top and Side panes of the
              Workspace. Selecting a point in those panes selects it here.
            </p>
            <p>
              {sel3d
                ? (markers.find((m) => m.id === sel3d)?.label ?? "")
                : lineId
                  ? "Line selected."
                  : "Nothing selected."}
            </p>
            {selLines.length > 1 && (
              <div className={styles.lineChoice}>
                <span>Show in the 2D views:</span>
                {selLines.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    data-active={l.id === lineId || undefined}
                    onClick={() => showLine(l)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <PointProperties
            curve={curve}
            selected={selected}
            dispatch={curveDispatch}
            onSelect={setSelected}
            title={selected === null ? undefined : labelOf(selected)}
            locks={locks}
            canDelete={canDelete}
            axisLabels={fieldAxes}
            extra={
              view !== "top" || outline !== "top" ? (
                <DriveChips
                  role={selRole}
                  drives={activeDrives}
                  doc={doc}
                  dispatch={dispatch}
                  axes={axes}
                />
              ) : null
            }
          />
        )}
        {space === "top" && outline !== "top" && (
          <RailNote text="The two plan rails of this pair as one closed outline: each section's point sits where its cutting line crosses it. Heel back and toe tip follow the top outline." />
        )}
        {space === "side" && sideCurve !== "centre" && (
          <RailNote text="A rail seen from the side with the heel height applied (stored flat, like the upper). Each section's point of this role takes its height from this curve; the dots show where the sections meet it. Its ends follow the outline and are re-applied after an edit." />
        )}
        {space === "top" && outline === "top" && <Measures m={measures} />}
        {space === "section" && <SectionInfo g={geom} curve={curve} />}
      </aside>

      <footer className={styles.status}>
        <span className={styles.coords}>
          {cursor ? (
            <>
              {spaces[cursor.sp].fieldAxes[0]} <b>{cursor.p[0].toFixed(1)}</b>{" "}
              {spaces[cursor.sp].fieldAxes[1]} <b>{cursor.p[1].toFixed(1)}</b>
            </>
          ) : (
            `${fieldAxes[0]} — ${fieldAxes[1]} —`
          )}
        </span>
        <button
          type="button"
          data-active={snapOn || undefined}
          onClick={() => setSnapOn(!snapOn)}
          aria-pressed={snapOn}
          title="Snap to grid (hold Alt to bypass)"
        >
          Snap {snapOn ? `${snapSize} mm` : "off"}
        </button>
        {snapOn && (
          <select
            aria-label="Snap step"
            value={snapSize}
            onChange={(e) => setSnapSize(Number(e.target.value))}
          >
            {[1, 2, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} mm
              </option>
            ))}
          </select>
        )}
        <span className={styles.hint}>
          {tool === "image"
            ? "Image — drag to move · corners scale · top knob rotates (Shift snaps) · Alt+wheel scales"
            : tool === "pen"
              ? "Pen — click to add · click the curve to insert · Esc to stop"
              : "Drag points and handles · double-click curve to insert, point to delete · 1–4 handle mode"}
        </span>
        <span className={styles.saved}>
          {saved === "saved" ? "Autosaved locally" : ""}
        </span>
      </footer>
    </div>
  );
}

/**
 * A workspace pane. It MUST be a module-level component: defined inside
 * `Studio` it would be a new component type on every render, React would
 * remount the canvas on each pointer move (the status bar's cursor readout
 * re-renders the studio) and the 2D panes blinked and could not be used.
 */
function Pane(p: {
  id: Pane;
  title: string;
  active: boolean;
  onActivate: () => void;
  onOpen?: () => void;
  bar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={styles.pane}
      data-active={p.active || undefined}
      onPointerDownCapture={p.onActivate}
    >
      <div className={styles.paneBar}>
        <b>{p.title}</b>
        {p.bar}
        {p.onOpen && (
          <button
            type="button"
            title={`Open ${p.title} full size`}
            onClick={p.onOpen}
          >
            ⤢
          </button>
        )}
      </div>
      <div className={styles.paneBody}>{p.children}</div>
    </section>
  );
}

/** What `useSpace` reads from the studio (everything is derived from `doc`). */
interface SpaceCtx {
  doc: StudioDoc;
  dispatch: (a: HistoryAction<StudioDoc>) => void;
  ctx: ReturnType<typeof sideContext>;
  valid: ReturnType<typeof validContext>;
  frame: ReturnType<typeof upperFrame> | null;
  contour: EditableCurve | null;
  geom: ReturnType<typeof sectionGeometry>;
  secDrives: readonly Drive[];
  loop: EditableCurve | null;
  sideRail: EditableCurve | null;
  outline: "top" | PairKind;
  sideCurve: "centre" | ElevRole;
  sectionId: SectionId;
}

/**
 * One 2D EDIT SPACE (top, side or section): the curve it edits, its drives, its
 * own point selection and the mapping of its edits back onto the document.
 * Decision: the studio computes all three at once instead of one for the
 * current tab, because the workspace shows the top and side panes together and
 * each must keep its own curve, selection and drives; the single-view tabs and
 * the sidebars simply read the model of the space they show.
 */
function useSpace(space: Space, c: SpaceCtx) {
  const { doc, ctx, valid, frame, contour, geom, outline, sideCurve } = c,
    { sectionId, loop, sideRail, secDrives } = c;
  const [selectedRaw, setSelected] = useState<number | null>(null);
  // Drives exist even while the pose is invalid (their values are "pending"),
  // so locks and landmark protection never lapse when a parameter goes bad.
  const drives = useMemo<readonly Drive[]>(() => {
    if ("error" in ctx) return EMPTY;
    // The side contour holds both curves, so both sets of drives apply to it.
    // A rail edited in the posed side view has no drives shown there: its ends
    // are re-applied in the flat frame by the document anyway.
    return space === "side" && sideCurve === "centre"
      ? [...bottomDrives(ctx), ...dorsalDrives(ctx)]
      : space === "top" && outline !== "top"
        ? loopDrives(outline, doc.top)
        : EMPTY;
  }, [ctx, space, sideCurve, outline, doc.top]);
  const activeDrives = space === "section" ? secDrives : drives,
    slot: Slot = space === "section" ? `section-${sectionId}` : space,
    // Without a valid pose there is no upper to place, so only the sole is edited.
    curve =
      space === "top"
        ? (loop ?? doc.top)
        : space === "section"
          ? doc.sections[sectionId]
          : (sideRail ?? contour ?? doc.bottom),
    selected =
      selectedRaw !== null && selectedRaw < curve.points.length
        ? selectedRaw
        : null;

  const docRef = useRef(doc),
    frameRef = useRef(frame);
  useEffect(() => {
    docRef.current = doc;
    frameRef.current = frame;
  });
  // Map an edited curve back onto the document. The side contour is split into
  // the sole and the (flat-stored) upper; see contour.ts.
  const nextDoc = useCallback(
    (value: EditableCurve): StudioDoc => {
      const d = docRef.current,
        f = frameRef.current;
      if (space === "top")
        return outline === "top"
          ? withCurve(d, "top", value)
          : withPlanLoop(d, outline, value);
      if (space === "section") return withSection(d, sectionId, value);
      if (sideCurve !== "centre")
        return withRail(
          d,
          "elev",
          sideCurve,
          f ? upperFromPosed(f, value, d.rails.elev[sideCurve]) : value,
        );
      if (!f) return withCurve(d, "bottom", value);
      const { bottom, dorsal } = splitContour(f, value, d);
      return reconcileDoc({ ...d, bottom, dorsal });
    },
    [space, sectionId, outline, sideCurve],
  );
  const { dispatch } = c,
    curveDispatch = useCallback(
      (a: HistoryAction<EditableCurve>) => {
        if (a.type === "commit" || a.type === "preview" || a.type === "reset")
          dispatch({ type: a.type, value: nextDoc(a.value) });
        else dispatch(a);
      },
      [nextDoc, dispatch],
    );

  const roleOf = (i: number) => curve.points[i]?.role;
  const locks = (i: number): readonly [boolean, boolean] => {
    const role = roleOf(i);
    const on = (axis: 0 | 1) =>
      activeDrives.some(
        (d) =>
          d.role === role && d.axis === axis && !doc.unlocked.includes(d.id),
      );
    return [on(0), on(1)];
  };
  // Named landmarks are what the other views and the checks are built on.
  const canDelete = (i: number) => {
    const role = roleOf(i);
    if (!role) return true;
    if (space === "side" && sideCurve !== "centre")
      return role !== "start" && role !== "end";
    return space === "top"
      ? !(role in TOP_ROLES)
      : !activeDrives.some((d) => d.role === role);
  };
  // Role names for the top view's landmarks differ from the side's, so the
  // friendly top labels are used only there.
  const labelOf = (i: number) =>
    (space === "top" ? roleLabel(roleOf(i)) : undefined) ??
    (roleOf(i) ? prettyRole(roleOf(i)!) : `Point ${i + 1}`);
  const fitPoints = useMemo<Vec2[]>(() => {
    if (space === "section")
      return [[0, 0], [geom?.width ?? 60, 0], ...sampleCurve(curve, 12)];
    if (space !== "side") return [];
    const L = valid ? valid.length : 270;
    return [[0, 0], [L, 0], ...sampleCurve(contour ?? doc.bottom, 12)];
  }, [space, valid, contour, doc.bottom, curve, geom]);
  // Full names for chips and the status bar; short ones fit the narrow fields.
  const axes: readonly [string, string] =
    space === "top"
      ? ["X", "Y"]
      : space === "section"
        ? ["Across", "Height"]
        : ["Station", "Height"];
  const fieldAxes: readonly [string, string] =
    space === "top"
      ? ["X", "Y"]
      : space === "section"
        ? ["u", "z"]
        : ["s", "z"];
  return {
    space,
    slot,
    curve,
    activeDrives,
    selected,
    setSelected,
    curveDispatch,
    locks,
    canDelete,
    labelOf,
    fitPoints,
    axes,
    fieldAxes,
  };
}

const prettyRole = (r: string) =>
  r.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const VIEW_BUTTONS: [ViewName, string, string][] = [
  ["top", "Top", "7"],
  ["bottom", "Bottom", "⇧7"],
  ["lateral", "Lateral", "3"],
  ["medial", "Medial", "⇧3"],
  ["toe", "Toe", "1"],
  ["heel", "Heel", "⇧1"],
];

function ViewerPanel(props: {
  opts: ViewerOptions;
  set: (o: ViewerOptions) => void;
  cut: TopCut;
  onCut: (patch: Partial<TopCut>) => void;
  onView: (v: ViewName) => void;
}) {
  const { opts, set } = props,
    toggles: [keyof ViewerOptions, string][] = [
      ["surface", "Surface"],
      ["wire", "Wireframe"],
      ["rails", "Rails"],
      ["sections", "Sections"],
      ["pose", "Apply heel height"],
      ["topCut", "Flat top cut"],
      ["edit", "Edit points"],
      ["ortho", "Orthographic (5)"],
    ];
  return (
    <>
      <h3 className={styles.panelHeading}>3D view</h3>
      <div className={styles.toggles}>
        {toggles.map(([k, label]) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={opts[k]}
              onChange={(e) => set({ ...opts, [k]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <h3 className={styles.panelHeading}>Flat top cut</h3>
      <div className={styles.paramGrid}>
        <NumberField
          label="Height"
          unit="mm"
          value={props.cut.height}
          title="Height of the cutting plane above the sole at the heel back, measured on the flat foot"
          onCommit={(v) => props.onCut({ height: v })}
        />
        <NumberField
          label="Tilt"
          unit="°"
          value={props.cut.tiltDeg}
          title="Slope against the sole; + rises towards the toe"
          onCommit={(v) => props.onCut({ tiltDeg: v })}
        />
      </div>
      <p className={styles.sectionNote}>
        A plain plane: everything above it is removed. It is set on the flat
        foot and moves with the foot when the heel rises.
      </p>
      <h3 className={styles.panelHeading}>Views</h3>
      <div className={styles.viewButtons}>
        {VIEW_BUTTONS.map(([v, label, key]) => (
          <button key={v} type="button" onClick={() => props.onView(v)}>
            {label} <kbd>{key}</kbd>
          </button>
        ))}
      </div>
      <p className={styles.sectionNote}>
        Numpad 7 / 1 / 3 (Ctrl for the opposite side), or the digit keys with
        Shift. 5 switches orthographic, . frames the model.
      </p>
      <div className={styles.treeFooter}>
        <button type="button" onClick={() => props.onView("frame")}>
          Frame model
        </button>
      </div>
    </>
  );
}
