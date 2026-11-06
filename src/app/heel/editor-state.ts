import { buildHeel } from "~/lib/heel/loft";
import {
  createHeelParameters,
  rebaseHeelParameters,
  type HeelParameters,
  type SeatGuide,
} from "~/lib/heel/model";

export function construct(parameters: HeelParameters, seat: SeatGuide) {
  const start = performance.now();
  const mesh = buildHeel(parameters, seat);
  return {
    parameters,
    seat,
    mesh,
    milliseconds: (performance.now() - start) as number | null,
  };
}

export interface HeelEditorState {
  draft: HeelParameters;
  seat: SeatGuide;
  valid: ReturnType<typeof construct> | null;
  error: string;
}

export function applyHeelEdit(
  previous: HeelEditorState,
  draft: HeelParameters,
  seat = previous.seat,
): HeelEditorState {
  try {
    return { draft, seat, valid: construct(draft, seat), error: "" };
  } catch (cause) {
    return {
      ...previous,
      draft,
      seat,
      error:
        cause instanceof Error ? cause.message : "Unable to build this edit.",
    };
  }
}

export function initializeHeel(draft: HeelParameters, seat: SeatGuide) {
  const state = applyHeelEdit(
    { draft, seat, valid: null, error: "" },
    draft,
    seat,
  );
  if (state.valid) state.valid.milliseconds = null;
  return state;
}

/** Transport the authored draft, including rejected edits; never recreate defaults. */
export function followHeelSource(previous: HeelEditorState, seat: SeatGuide) {
  try {
    return applyHeelEdit(
      previous,
      rebaseHeelParameters(previous.draft, previous.seat, seat),
      seat,
    );
  } catch (cause) {
    return {
      ...previous,
      seat,
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to follow this Last attachment.",
    };
  }
}

export function recoverHeelEdit(previous: HeelEditorState, linked: boolean) {
  if (!previous.valid) return applyHeelEdit(previous, previous.draft);
  const { parameters, seat } = previous.valid;
  try {
    return applyHeelEdit(
      previous,
      linked
        ? rebaseHeelParameters(parameters, seat, previous.seat)
        : parameters,
      linked ? previous.seat : seat,
    );
  } catch (cause) {
    return {
      ...previous,
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to recover this heel on the current Last.",
    };
  }
}

export function resetHeelEdit(
  previous: HeelEditorState,
  seat: SeatGuide,
  example: "slender" | "broad",
) {
  return applyHeelEdit(previous, createHeelParameters(seat, example), seat);
}
