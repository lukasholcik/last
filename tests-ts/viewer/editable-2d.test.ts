import { describe, expect, it } from "vitest";
import input from "../../examples/foot-first-baseline.json";
import type {
  FootFirstInput,
  LastState,
  Last2DState,
} from "../../src/lib/geometry/types";
import {
  buildLast2D,
  previewLast2D,
} from "../../src/lib/geometry/two-dimensional";
import { resetLastOutlinePoint } from "../../src/lib/shaping";
import {
  Editable2DSession,
  type FrameClock,
} from "../../src/app/_components/viewer/editable-2d";
import { RequestGate, toDraft } from "../../src/app/_components/viewer/state";

const baseline: FootFirstInput = {
  ...input,
  schema_version: 4,
  kind: "foot_first_last",
  units: "mm",
  reference: { ...input.reference, provenance: "synthetic" },
};
const fixture = buildLast2D(baseline);
const checkpoint: LastState = {
  ...fixture,
  display: { ...fixture.display, top: [] },
};

function setup() {
  const frames = new Map<number, () => void>();
  let id = 0;
  const clock: FrameClock = {
    request: (callback) => {
      frames.set(++id, callback);
      return id;
    },
    cancel: (key) => {
      frames.delete(key);
    },
  };
  const gate = new RequestGate();
  const previews: number[] = [];
  // These controlled builders test checkpoint/scheduling behavior, not geometry validity.
  const model = (value: FootFirstInput): Last2DState => ({
    ...fixture,
    inputs: structuredClone(value),
    display: {
      ...fixture.display,
      section: [
        {
          name: "unit-preview-marker",
          points: [[0, value.pose.heel_height, 0]],
        },
      ],
    },
  });
  const session = new Editable2DSession(
    {
      preview: (value) => {
        previews.push(value.pose.heel_height);
        if (value.pose.heel_height === 99)
          throw new Error("Unconstructible preview");
        return model(value);
      },
      validate: (value) => {
        if (value.pose.heel_height < 0) throw new Error("Rejected 2D edit");
        return model(value);
      },
    },
    () => gate.edit(),
    clock,
  );
  session.acceptRebuild(checkpoint);
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  return { session, gate, frames, previews, flush };
}

describe("editable 2D checkpoints and provisional scheduling", () => {
  it("rebases same-size numeric foot extents while retaining proportional F/W sizing", () => {
    const session = new Editable2DSession(
      { preview: previewLast2D, validate: buildLast2D },
      () => undefined,
      { request: () => 0, cancel: () => undefined },
    );
    session.acceptRebuild(checkpoint);
    const authored: FootFirstInput = {
      ...structuredClone(baseline),
      last_outline: {
        anchors: {
          medial_waist: { station_offset_ratio: 0, side_offset_ratio: -0.02 },
        },
        handles: {},
      },
    };
    expect(session.applyInput(authored)).toBe(true);
    const previous = session.getSnapshot().validated!;
    session.editField("extent-medial_waist", "34");
    const edited = session.getSnapshot().validated!;
    expect(session.getSnapshot().error).toBeNull();
    expect(edited.models.foot.points.medial_waist?.x).toBeCloseTo(-34);
    expect(edited.models.top.points).toEqual(previous.models.top.points);
    expect(edited.inputs.reference).toEqual(baseline.reference);
    session.editField("foot-width", "120");
    expect(
      session.getSnapshot().validated?.models.top.points.medial_waist?.x,
    ).toBeCloseTo(previous.models.top.points.medial_waist!.x * 1.2);
  });
  it("resets only the selected last point and its handles through actual 2D validation", () => {
    const session = new Editable2DSession(
      { preview: previewLast2D, validate: buildLast2D },
      () => undefined,
      { request: () => 0, cancel: () => undefined },
    );
    session.acceptRebuild(checkpoint);
    const custom: FootFirstInput = {
      ...structuredClone(baseline),
      last_outline: {
        anchors: {
          medial_heel: { station_offset_ratio: 0.01, side_offset_ratio: -0.02 },
          medial_waist: { station_offset_ratio: 0, side_offset_ratio: -0.02 },
        },
        handles: {
          medial_heel: {
            incoming: { forward_ratio: 0.02, side_ratio: 0 },
            outgoing: { forward_ratio: -0.02, side_ratio: 0 },
          },
        },
      },
    };
    expect(session.applyInput(custom)).toBe(true);
    const edited = session.getSnapshot().validated!;
    expect(edited.models.foot).toEqual(fixture.models.foot);
    expect(
      session.applyInput(resetLastOutlinePoint(edited.inputs, "medial_heel")),
    ).toBe(true);
    const restored = session.getSnapshot().validated!;
    expect(restored.models.top.points.medial_heel).toEqual(
      restored.models.foot.points.medial_heel,
    );
    expect(restored.models.top.points.medial_waist).toEqual(
      edited.models.top.points.medial_waist,
    );
    expect(restored.inputs.last_outline?.handles.medial_heel).toBeUndefined();
    expect(restored.inputs.last_outline?.anchors.medial_heel).toBeUndefined();
    expect(restored.models.foot).toEqual(edited.models.foot);
    expect(checkpoint.inputs).toEqual(baseline);
  });
  it("coalesces latest target only and does not commit the 2D/3D checkpoint during preview", () => {
    const { session, previews, flush } = setup(),
      accepted = session.getSnapshot().validated;
    const original3D = JSON.stringify(checkpoint);
    const gesture = session.beginGesture()!;
    for (const height of [9, 10, 11, 12, 13])
      session.queuePreview(gesture.token, {
        ...gesture.input,
        pose: { ...gesture.input.pose, heel_height: height },
      });
    expect(previews).toEqual([]);
    flush();
    expect(previews).toEqual([13]);
    expect(session.getSnapshot().provisional?.inputs.pose.heel_height).toBe(13);
    expect(session.getSnapshot().validated).toBe(accepted);
    expect(JSON.stringify(checkpoint)).toBe(original3D);
    expect(session.getSnapshot().dragging).toBe(true);
  });
  it("commits two cumulative edits from refreshed 2D inputs without an explicit rebuild", () => {
    const { session } = setup();
    const first = session.beginGesture()!;
    expect(
      session.finishGesture(first.token, {
        ...first.input,
        pose: { ...first.input.pose, heel_height: 20 },
      }),
    ).toBe(true);
    const second = session.beginGesture()!;
    expect(second.input.pose.heel_height).toBe(20);
    expect(
      session.finishGesture(second.token, {
        ...second.input,
        pose: { ...second.input.pose, toe_spring: 12 },
      }),
    ).toBe(true);
    expect(session.getSnapshot().validated?.inputs.pose).toMatchObject({
      heel_height: 20,
      toe_spring: 12,
    });
    expect(checkpoint.inputs.pose.heel_height).toBe(8);
  });
  it("cancel and stale frame callbacks restore the gesture-start checkpoint, not the older 3D state", () => {
    const { session, frames, previews, flush } = setup();
    const first = session.beginGesture()!;
    session.finishGesture(first.token, {
      ...first.input,
      pose: { ...first.input.pose, heel_height: 20 },
    });
    const second = session.beginGesture()!;
    session.queuePreview(second.token, {
      ...second.input,
      pose: { ...second.input.pose, heel_height: 30 },
    });
    const staleCallback = [...frames.values()][0]!;
    session.cancelGesture(second.token);
    staleCallback();
    expect(session.getSnapshot().validated?.inputs.pose.heel_height).toBe(20);
    expect(session.getSnapshot().provisional).toBeNull();
    expect(session.getSnapshot().dragging).toBe(false);
    const next = session.beginGesture()!;
    session.queuePreview(next.token, {
      ...next.input,
      pose: { ...next.input.pose, heel_height: 35 },
    });
    staleCallback();
    expect(previews).toEqual([]);
    flush();
    expect(previews).toEqual([35]);
  });
  it("keeps the most recent constructible preview and rejects invalid release without blocking the next edit", () => {
    const { session, flush } = setup();
    const gesture = session.beginGesture()!;
    session.queuePreview(gesture.token, {
      ...gesture.input,
      pose: { ...gesture.input.pose, heel_height: 12 },
    });
    flush();
    const latest = session.getSnapshot().provisional;
    session.queuePreview(gesture.token, {
      ...gesture.input,
      pose: { ...gesture.input.pose, heel_height: 99 },
    });
    flush();
    expect(session.getSnapshot().provisional).toBe(latest);
    expect(session.getSnapshot().previewError).toBe("Unconstructible preview");
    expect(
      session.finishGesture(gesture.token, {
        ...gesture.input,
        pose: { ...gesture.input.pose, heel_height: -1 },
      }),
    ).toBe(false);
    expect(session.getSnapshot().validated?.inputs.pose.heel_height).toBe(8);
    expect(session.getSnapshot().draftInvalid).toBe(false);
    const retry = session.beginGesture()!;
    expect(
      session.finishGesture(retry.token, {
        ...retry.input,
        pose: { ...retry.input.pose, heel_height: 10 },
      }),
    ).toBe(true);
  });
  it("retains blank numeric text and usable geometry, then supports correction and 3D-checkpoint discard", () => {
    const { session } = setup(),
      usable = session.getSnapshot().validated;
    session.editField("foot-length", "");
    expect(session.getSnapshot().draft?.["foot-length"]).toBe("");
    expect(session.getSnapshot().validated).toBe(usable);
    expect(session.beginGesture()).toBeNull();
    session.editField("foot-length", "225");
    expect(session.getSnapshot().validated?.inputs.foot.length).toBe(225);
    session.discardToRebuild(checkpoint);
    expect(session.getSnapshot().draft).toEqual(toDraft(checkpoint.inputs));
    expect(session.getSnapshot().validated?.inputs.foot.length).toBe(250);
    expect(session.getSnapshot().error).toBeNull();
    session.load({ ...baseline, description: "Explicitly loaded example" });
    expect(session.getSnapshot().validated?.inputs.description).toBe(
      "Explicitly loaded example",
    );
  });
  it("numeric revisions invalidate both an active gesture and older HTTP tickets", () => {
    const { session, gate, flush } = setup(),
      ticket = gate.begin();
    const gesture = session.beginGesture()!;
    session.queuePreview(gesture.token, {
      ...gesture.input,
      pose: { ...gesture.input.pose, heel_height: 30 },
    });
    session.editField("foot-width", "110");
    flush();
    expect(gate.accepts(ticket)).toBe(false);
    expect(session.finishGesture(gesture.token, gesture.input)).toBe(false);
    expect(session.getSnapshot().validated?.inputs.foot.width).toBe(110);
    expect(session.getSnapshot().provisional).toBeNull();
  });
});
