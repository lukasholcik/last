/**
 * Undo history with a live-preview slot: drags call `preview` on every frame
 * and a single `finish` records one undo step; `cancel` restores the start.
 *
 * Generic over the stored value so the studio can undo whole-document edits
 * (outline, parameters and side curves together) with one stack, instead of
 * one stack per curve where an undo could desynchronise linked views.
 */
export interface HistoryState<T> {
  readonly present: T;
  readonly past: readonly T[];
  readonly future: readonly T[];
  readonly base: T | null;
}
export type HistoryAction<T> =
  | { type: "commit"; value: T }
  | { type: "preview"; value: T }
  | { type: "finish" }
  | { type: "cancel" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; value: T };

const LIMIT = 200;

export const initHistory = <T>(value: T): HistoryState<T> => ({
  present: value,
  past: [],
  future: [],
  base: null,
});

const pushPast = <T>(past: readonly T[], v: T) => [...past, v].slice(-LIMIT);

export function historyReducer<T>(
  s: HistoryState<T>,
  a: HistoryAction<T>,
): HistoryState<T> {
  switch (a.type) {
    case "commit":
      if (a.value === s.present) return s;
      return {
        present: a.value,
        past: pushPast(s.past, s.base ?? s.present),
        future: [],
        base: null,
      };
    case "preview":
      return { ...s, present: a.value, base: s.base ?? s.present };
    case "finish":
      if (!s.base) return s;
      if (s.base === s.present) return { ...s, base: null };
      return {
        present: s.present,
        past: pushPast(s.past, s.base),
        future: [],
        base: null,
      };
    case "reset":
      return initHistory(a.value);
    case "cancel":
      return s.base ? { ...s, present: s.base, base: null } : s;
    case "undo": {
      const prev = s.past[s.past.length - 1];
      if (prev === undefined) return s;
      return {
        present: prev,
        past: s.past.slice(0, -1),
        future: [s.present, ...s.future],
        base: null,
      };
    }
    case "redo": {
      const [next, ...rest] = s.future;
      if (next === undefined) return s;
      return {
        present: next,
        past: pushPast(s.past, s.present),
        future: rest,
        base: null,
      };
    }
  }
}
