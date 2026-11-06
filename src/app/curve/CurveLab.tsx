"use client";

import Link from "next/link";
import { useReducer, useState } from "react";
import { PRESETS, historyReducer, initHistory } from "~/lib/curves";
import { CurveCanvas, type Tool } from "./CurveCanvas";
import { Inspector } from "./Inspector";
import { useCurveShortcuts } from "./useCurveShortcuts";
import styles from "./curve.module.css";

export function CurveLab() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    initHistory(PRESETS[0]!.curve()),
  );
  const curve = history.present;
  const [tool, setTool] = useState<Tool>("select");
  const [selectedRaw, setSelected] = useState<number | null>(null);
  const [showComb, setShowComb] = useState(true);
  const [combGain, setCombGain] = useState(600);
  const [showAllHandles, setShowAllHandles] = useState(true);
  const [snapOn, setSnapOn] = useState(false);
  const [snapSize, setSnapSize] = useState(5);
  const [fitSignal, setFitSignal] = useState(0);
  const selected =
    selectedRaw !== null && selectedRaw < curve.points.length
      ? selectedRaw
      : null;

  useCurveShortcuts({
    curve,
    selected,
    tool,
    setTool,
    setSelected,
    dispatch,
  });

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Workbench
        </Link>
        <h1>Curve lab</h1>
        <span className={styles.tag}>Phase 1 · generic Bezier editor</span>
      </header>
      <nav className={styles.rail} aria-label="Tools">
        <button
          type="button"
          data-active={tool === "select" || undefined}
          onClick={() => setTool("select")}
          title="Select and drag (V)"
          aria-pressed={tool === "select"}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M4 2l11 8-5 1.2L12.5 17l-2.2 1-2.5-5.8L4 15z" />
          </svg>
          <span>Select</span>
          <kbd>V</kbd>
        </button>
        <button
          type="button"
          data-active={tool === "pen" || undefined}
          onClick={() => setTool("pen")}
          title="Pen: click to add or insert points (P)"
          aria-pressed={tool === "pen"}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M3 17l1-4 9-9 3 3-9 9zM12 5l3 3" />
          </svg>
          <span>Pen</span>
          <kbd>P</kbd>
        </button>
        <hr />
        <button
          type="button"
          disabled={!history.past.length}
          onClick={() => dispatch({ type: "undo" })}
          title="Undo (⌘Z)"
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M7 5L3 9l4 4M3 9h8a5 5 0 010 10" />
          </svg>
          <span>Undo</span>
        </button>
        <button
          type="button"
          disabled={!history.future.length}
          onClick={() => dispatch({ type: "redo" })}
          title="Redo (⇧⌘Z)"
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M13 5l4 4-4 4M17 9H9a5 5 0 000 10" />
          </svg>
          <span>Redo</span>
        </button>
      </nav>
      <main className={styles.stage}>
        <CurveCanvas
          curve={curve}
          selected={selected}
          tool={tool}
          snap={snapOn ? snapSize : null}
          showComb={showComb}
          combGain={combGain}
          showAllHandles={showAllHandles}
          fitSignal={fitSignal}
          onSelect={setSelected}
          dispatch={dispatch}
        />
        <p className={styles.legend} aria-hidden>
          <span>
            <i data-m="auto" />
            Auto
          </span>
          <span>
            <i data-m="smooth" />
            Smooth
          </span>
          <span>
            <i data-m="symmetric" />
            Symmetric
          </span>
          <span>
            <i data-m="corner" />
            Corner
          </span>
          <span className={styles.legendTip}>
            {tool === "pen"
              ? "Click to add · click the curve to insert · Esc to stop"
              : "Drag points and handles · double-click the curve to insert, a point to delete"}
          </span>
        </p>
      </main>
      <Inspector
        curve={curve}
        selected={selected}
        dispatch={dispatch}
        onSelect={setSelected}
        onLoaded={() => setFitSignal((n) => n + 1)}
        showComb={showComb}
        setShowComb={setShowComb}
        combGain={combGain}
        setCombGain={setCombGain}
        showAllHandles={showAllHandles}
        setShowAllHandles={setShowAllHandles}
        snapOn={snapOn}
        setSnapOn={setSnapOn}
        snapSize={snapSize}
        setSnapSize={setSnapSize}
      />
    </div>
  );
}
