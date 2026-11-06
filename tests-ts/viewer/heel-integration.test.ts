import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import input from "../../examples/foot-first-baseline.json";
import { parseFootFirstInput } from "../../src/lib/geometry/foot-first";
import {
  buildLast2D,
  previewLast2D,
} from "../../src/lib/geometry/two-dimensional";
import type { LastState } from "../../src/lib/geometry/types";
import { createHeelParameters } from "../../src/lib/heel/model";
import { seatFromLast } from "../../src/lib/heel/last-seat-adapter";
import {
  Editable2DSession,
  is3DOutdated,
} from "../../src/app/_components/viewer/editable-2d";
import { HeelEditor } from "../../src/app/heel/HeelEditor";
import { EditorTabs } from "../../src/app/_components/viewer/EditorTabs";
import {
  LinkedHeelEditor,
  linkedHeelSource,
} from "../../src/app/heel/LinkedHeelEditor";
import {
  applyHeelEdit,
  followHeelSource,
  initializeHeel,
  recoverHeelEdit,
  resetHeelEdit,
} from "../../src/app/heel/editor-state";

const baseline = parseFootFirstInput(structuredClone(input));
const accepted = buildLast2D(baseline);
const checkpoint: LastState = {
  ...accepted,
  display: { ...accepted.display, top: [] },
};
function setup() {
  let pending: (() => void) | null = null;
  const session = new Editable2DSession(
    { preview: previewLast2D, validate: buildLast2D },
    () => undefined,
    {
      request: (callback) => {
        pending = callback;
        return 1;
      },
      cancel: () => {
        pending = null;
      },
    },
  );
  session.acceptRebuild(checkpoint);
  return {
    session,
    flush: () => {
      const callback = pending;
      pending = null;
      callback?.();
    },
  };
}
function source(height: number) {
  const next = structuredClone(baseline);
  next.pose.heel_height = height;
  return seatFromLast(buildLast2D(next));
}
function numberTag(html: string, label: string) {
  const tag = new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`).exec(
    html,
  )?.[0];
  expect(tag, label).toBeDefined();
  return tag!;
}

describe("Last / Heel integration", () => {
  it("starts on an accessible Last panel without initializing the heel editor", () => {
    const heel = vi.fn(() => createElement("p", null, "Heel editor"));
    const html = renderToStaticMarkup(
      createElement(EditorTabs, {
        last: createElement("input", {
          "aria-label": "Retained Last draft",
          defaultValue: "12",
        }),
        heel,
      }),
    );
    expect(heel).not.toHaveBeenCalled();
    expect(html).toMatch(
      /id="last-tab"[^>]*role="tab"[^>]*aria-selected="true"/,
    );
    expect(html).toMatch(/id="heel-panel"[^>]*role="tabpanel"[^>]*hidden=""/);
    expect(html).toContain('aria-label="Retained Last draft"');
  });
  it("bridges accepted current 2D before a new 3D rebuild, never provisional geometry or invalid numeric drafts", () => {
    const { session, flush } = setup();
    const initial = session.getSnapshot().validated;
    const gesture = session.beginGesture()!;
    const next = structuredClone(gesture.input);
    next.pose.heel_height = 12;
    session.queuePreview(gesture.token, next);
    flush();
    expect(session.getSnapshot().provisional?.inputs.pose.heel_height).toBe(12);
    expect(session.getSnapshot().validated).toBe(initial);
    expect(
      linkedHeelSource(session.getSnapshot().validated).seat?.heelHeight,
    ).toBe(8);
    expect(session.finishGesture(gesture.token, next)).toBe(true);
    expect(
      linkedHeelSource(session.getSnapshot().validated).seat?.heelHeight,
    ).toBe(12);
    expect(is3DOutdated(checkpoint, session.getSnapshot())).toBe(true);
    expect(checkpoint.inputs.pose.heel_height).toBe(8);
    session.editField("pose-heel_height", "");
    expect(session.getSnapshot().draftInvalid).toBe(true);
    expect(
      linkedHeelSource(session.getSnapshot().validated).seat?.heelHeight,
    ).toBe(12);
  });

  it("preserves authored heel design through accepted Last edits, Last Reset and Discard without touching the 3D checkpoint", () => {
    const { session } = setup();
    const originalSeat = seatFromLast(session.getSnapshot().validated!);
    let heel = initializeHeel(createHeelParameters(originalSeat), originalSeat);
    heel = applyHeelEdit(heel, {
      ...heel.draft,
      roundness: 3.2,
      symmetricBody: false,
      bottom: { ...heel.draft.bottom, centerX: heel.draft.bottom.centerX + 1 },
    });
    expect(heel.error).toBe("");
    const authored = structuredClone(heel.draft);
    session.editField("pose-heel_height", "12");
    const editedSeat = seatFromLast(session.getSnapshot().validated!);
    heel = followHeelSource(heel, editedSeat);
    expect(heel.seat.heelHeight).toBe(12);
    expect(heel.draft.roundness).toBe(3.2);
    expect(heel.draft.symmetricBody).toBe(false);
    expect(heel.draft.frontShoulderMm).toBe(authored.frontShoulderMm);
    session.load(baseline);
    heel = followHeelSource(
      heel,
      seatFromLast(session.getSnapshot().validated!),
    );
    expect(heel.draft.bottom.centerX).toBeCloseTo(authored.bottom.centerX);
    expect(heel.draft.bottom.depth).toBeCloseTo(authored.bottom.depth);
    expect(heel.draft.roundness).toBe(3.2);
    session.editField("pose-heel_height", "12");
    heel = followHeelSource(
      heel,
      seatFromLast(session.getSnapshot().validated!),
    );
    session.discardToRebuild(checkpoint);
    heel = followHeelSource(
      heel,
      seatFromLast(session.getSnapshot().validated!),
    );
    expect(heel.draft.handles.front[1]).toBeCloseTo(authored.handles.front[1]);
    expect(heel.draft.roundness).toBe(3.2);
    expect(heel.seat.heelHeight).toBe(8);
    expect(checkpoint.inputs).toEqual(baseline);
  });

  it("keeps rejected drafts and last-valid mesh on a source change, and recovers against current Last rather than rolling it back", () => {
    const oldSeat = source(8),
      nextSeat = source(12);
    let state = initializeHeel(createHeelParameters(oldSeat), oldSeat);
    const valid = state.valid;
    state = applyHeelEdit(state, {
      ...state.draft,
      frontShoulderMm: 7,
      roundness: 3.1,
    });
    expect(state.error).not.toBe("");
    state = followHeelSource(state, nextSeat);
    expect(state.valid).toBe(valid);
    expect(state.seat).toBe(nextSeat);
    expect(state.draft.frontShoulderMm).toBe(7);
    expect(state.draft.roundness).toBe(3.1);
    state = recoverHeelEdit(state, true);
    expect(state.error).toBe("");
    expect(state.seat).toBe(nextSeat);
    expect(state.valid?.seat).toBe(nextSeat);
    expect(state.valid?.mesh).not.toBe(valid?.mesh);
    expect(state.draft.top.frontY).toBe(nextSeat.length);
    state = resetHeelEdit(state, state.seat, "slender");
    expect(state.error).toBe("");
    expect(state.draft).toEqual(createHeelParameters(nextSeat));
    expect(state.seat.heelHeight).toBe(12);
  });

  it("handles an unavailable initial source and a failed initial heel without a synthetic fallback or crash", () => {
    expect(linkedHeelSource(null).seat).toBeNull();
    const malformed = structuredClone(accepted);
    delete malformed.models.bottom.points.bottom_heel_rear;
    const unavailable = linkedHeelSource(malformed);
    expect(unavailable.seat).toBeNull();
    expect(unavailable.error).toMatch(/attachment/i);
    const waiting = renderToStaticMarkup(
      createElement(LinkedHeelEditor, {
        accepted: malformed,
        onEditLast: () => undefined,
      }),
    );
    expect(waiting).toContain("Heel needs a Last outline.");
    expect(waiting).not.toContain('aria-label="Seat height"');
    expect(waiting).not.toContain("heel-solid-preview");
    const seat = source(8);
    let state = initializeHeel(
      { ...createHeelParameters(seat), frontShoulderMm: 7 },
      seat,
    );
    expect(state.valid).toBeNull();
    expect(state.error).not.toBe("");
    state = resetHeelEdit(state, seat, "slender");
    expect(state.valid?.seat).toBe(seat);
    expect(state.error).toBe("");
  });

  it("renders linked source controls read-only, leaves shoulder editable, and avoids duplicate main/h1; standalone stays editable", () => {
    const seat = source(8),
      parameters = createHeelParameters(seat);
    const linked = renderToStaticMarkup(
      createElement(HeelEditor, {
        initialSeat: seat,
        initialParameters: parameters,
        example: "slender",
        linkedSource: { seat, error: "" },
        onEditLast: () => undefined,
      }),
    );
    for (const label of [
      "Seat height",
      "Top left x",
      "Top right x",
      "Top back y",
      "Top front y",
    ])
      expect(numberTag(linked, label)).toContain('readOnly=""');
    expect(numberTag(linked, "Front shoulder")).not.toMatch(
      /readOnly|disabled/,
    );
    expect(linked).not.toMatch(/<main|<h1/);
    expect(linked).toContain("shared untrimmed Last outline");
    const standalone = renderToStaticMarkup(
      createElement(HeelEditor, {
        initialSeat: seat,
        initialParameters: parameters,
        example: "slender",
      }),
    );
    expect(numberTag(standalone, "Seat height")).not.toContain("readOnly");
    expect(numberTag(standalone, "Top left x")).not.toContain("readOnly");
    expect(standalone).toMatch(/<main/);
    expect(standalone).toMatch(/<h1/);
  });
});
