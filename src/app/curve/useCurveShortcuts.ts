import { useEffect, type Dispatch } from "react";
import {
  POINT_MODES,
  moveAnchor,
  removePoint,
  setMode,
  type EditableCurve,
  type HistoryAction,
} from "~/lib/curves";
import { add } from "~/lib/curves/vec";
import type { Tool } from "./CurveCanvas";

/** V/P tools, 1-4 modes, Del, arrow nudge, Esc, and undo/redo. */
export function useCurveShortcuts(o: {
  curve: EditableCurve;
  selected: number | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  setSelected: (i: number | null) => void;
  dispatch: Dispatch<HistoryAction<EditableCurve>>;
  canDelete?: (i: number) => boolean;
  /** Enables the I shortcut for the reference-image tool. */
  hasImage?: boolean;
  /** Driven axes of point i, [x, y]; arrow nudges leave them alone. */
  locks?: (i: number) => readonly [boolean, boolean];
}) {
  const {
    curve,
    selected,
    tool,
    setTool,
    setSelected,
    dispatch,
    canDelete,
    locks,
  } = o;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) &&
        !(
          t instanceof HTMLInputElement &&
          (t.type === "checkbox" || t.type === "range")
        )
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === "Escape") {
        if (tool === "pen" || tool === "image") setTool("select");
        else setSelected(null);
      } else if (e.key === "v") setTool("select");
      else if (e.key === "p") setTool("pen");
      else if (e.key === "i" && o.hasImage) setTool("image");
      else if (selected !== null && ["1", "2", "3", "4"].includes(e.key))
        dispatch({
          type: "commit",
          value: setMode(curve, selected, POINT_MODES[Number(e.key) - 1]!),
        });
      else if (
        selected !== null &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        if (canDelete && !canDelete(selected)) return;
        dispatch({ type: "commit", value: removePoint(curve, selected) });
        setSelected(null);
      } else if (selected !== null && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1,
          d: [number, number] =
            e.key === "ArrowLeft"
              ? [-step, 0]
              : e.key === "ArrowRight"
                ? [step, 0]
                : e.key === "ArrowUp"
                  ? [0, step]
                  : [0, -step];
        const [lx, ly] = locks?.(selected) ?? [false, false];
        dispatch({
          type: "commit",
          value: moveAnchor(
            curve,
            selected,
            add(curve.points[selected]!.pos, [lx ? 0 : d[0], ly ? 0 : d[1]]),
          ),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    curve,
    selected,
    tool,
    setTool,
    setSelected,
    dispatch,
    canDelete,
    locks,
    o.hasImage,
  ]);
}
