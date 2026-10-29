import { describe, expect, it } from "vitest";
import type { ShapeHandle } from "../../src/lib/shaping";
import {
  selectedShapeHandle,
  shapeHandleOwner,
  visibleShapeHandles,
  shapeHandlesForMode,
} from "../../src/app/_components/viewer/shape-selection";

const handles: ShapeHandle[] = [
  {
    id: "top:last-toe",
    editTarget: "last",
    label: "Last toe",
    kind: "point",
    plane: "top",
    position: [260, 0],
    resetToFoot: "toe_tip",
  },
  {
    id: "top:toe_tip:in",
    editTarget: "last",
    label: "Incoming",
    kind: "tangent",
    plane: "top",
    position: [250, -20],
    anchor: [260, 0],
  },
  {
    id: "top:toe_tip:out",
    editTarget: "last",
    label: "Outgoing",
    kind: "tangent",
    plane: "top",
    position: [245, 10],
    anchor: [260, 0],
  },
  {
    id: "top:medial_heel",
    editTarget: "last",
    label: "Last heel",
    kind: "point",
    plane: "top",
    position: [30, -28],
    resetToFoot: "medial_heel",
  },
  {
    id: "top:medial_heel:in",
    editTarget: "last",
    label: "Heel incoming",
    kind: "tangent",
    plane: "top",
    position: [20, -28],
    anchor: [30, -28],
  },
  {
    id: "foot:medial_heel",
    editTarget: "foot",
    label: "Foot heel",
    kind: "point",
    plane: "top",
    position: [30, -28],
  },
  {
    id: "side:waist-roof",
    label: "Waist",
    kind: "point",
    plane: "side",
    position: [100, 55],
  },
  {
    id: "side:bezier:roof_front_to_waist:1",
    label: "Waist incoming",
    kind: "tangent",
    plane: "side",
    position: [95, 60],
    anchor: [100, 55],
  },
  {
    id: "side:bezier:roof_waist_to_ball:2",
    label: "Waist outgoing",
    kind: "tangent",
    plane: "side",
    position: [110, 45],
    anchor: [100, 55],
  },
  {
    id: "side:seat-angle",
    label: "Sole angle",
    kind: "tangent",
    plane: "side",
    position: [15, 5],
    anchor: [0, 8],
  },
];

describe("typed shape selection", () => {
  it("shows both actual independent vectors only for the selected last point", () => {
    const available = shapeHandlesForMode(handles, "last");
    const visible = visibleShapeHandles(available, "top:last-toe");
    expect(visible.map((h) => h.id)).toEqual([
      "top:last-toe",
      "top:toe_tip:in",
      "top:toe_tip:out",
      "top:medial_heel",
      "side:waist-roof",
      "side:seat-angle",
    ]);
    expect(visible[1]?.position).toEqual([250, -20]);
    expect(visible[2]?.position).toEqual([245, 10]);
    expect(shapeHandleOwner(available, available[1]!)).toBe(available[0]);
    expect(selectedShapeHandle(available, "top:toe_tip:out")?.resetToFoot).toBe(
      "toe_tip",
    );
  });
  it("keeps selection by ID after point positions refresh and exposes both adjacent side controls", () => {
    const moved = handles.map((h): ShapeHandle =>
      h.id === "top:last-toe"
        ? { ...h, position: [270, 0] }
        : h.id === "top:toe_tip:in" || h.id === "top:toe_tip:out"
          ? { ...h, anchor: [270, 0] }
          : h,
    );
    expect(selectedShapeHandle(moved, "top:last-toe")?.position).toEqual([
      270, 0,
    ]);
    expect(
      visibleShapeHandles(moved, "side:waist-roof")
        .filter((h) => h.kind === "tangent")
        .map((h) => h.id),
    ).toEqual([
      "side:bezier:roof_front_to_waist:1",
      "side:bezier:roof_waist_to_ball:2",
      "side:seat-angle",
    ]);
  });
  it("switches Foot/Last targets without copying or resetting contours or losing side handles", () => {
    const before = JSON.stringify(handles);
    const last = shapeHandlesForMode(handles, "last"),
      foot = shapeHandlesForMode(handles, "foot");
    expect(last.some((h) => h.id === "foot:medial_heel")).toBe(false);
    expect(foot.filter((h) => h.plane === "top").map((h) => h.id)).toEqual([
      "foot:medial_heel",
    ]);
    expect(foot.filter((h) => h.plane === "side")).toEqual(
      last.filter((h) => h.plane === "side"),
    );
    expect(shapeHandlesForMode(handles, "last")).toEqual(last);
    expect(JSON.stringify(handles)).toBe(before);
  });
});
