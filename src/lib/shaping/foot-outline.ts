import type {
  FootFirstInput,
  Last2DGeometry,
  TopAnchorId,
  Station,
  Vec2,
} from "../geometry/types";
import {
  TOP_ANCHORS,
  getLastAnchor,
  getLastHandle,
} from "../geometry/last-outline";
import { nextafter } from "../geometry/math";
import type {
  ShapeHandle,
  TopShapeHandleId,
  FootReferenceHandleId,
} from "./types";

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export function resetLastOutlinePoint(
  input: FootFirstInput,
  anchor: TopAnchorId,
): FootFirstInput {
  if (!TOP_ANCHORS.includes(anchor))
    throw new Error(`Unknown last anchor: ${anchor}`);
  const next = structuredClone(input);
  if (next.last_outline) {
    delete next.last_outline.anchors[anchor];
    delete next.last_outline.handles[anchor];
  }
  if (anchor === "toe_tip") next.design.toe_extension_ratio = 0;
  return next;
}
export function getFootHandles(state: Last2DGeometry): ShapeHandle[] {
  return TOP_ANCHORS.flatMap((id) => {
    const p = getLastAnchor(state.models.top, id),
      position: Vec2 = [p.y, p.x];
    const point: ShapeHandle = {
      id: id === "toe_tip" ? "top:last-toe" : `top:${id}`,
      label: `Last ${id.replaceAll("_", " ")}`,
      plane: "top",
      position,
      kind: "point",
      resetToFoot: id,
      editTarget: "last",
    };
    return [
      point,
      ...(["incoming", "outgoing"] as const).map((direction): ShapeHandle => {
        const h = getLastHandle(state.models.top, id, direction);
        return {
          id: `top:${id}:${direction === "incoming" ? "in" : "out"}`,
          label: `Last ${id} ${direction} Bézier handle`,
          plane: "top",
          position: [h.y, h.x],
          anchor: [...position],
          kind: "tangent",
          editTarget: "last",
        };
      }),
    ];
  });
}
const footStations = TOP_ANCHORS.filter(
  (id): id is Station => id !== "heel_tip" && id !== "toe_tip",
);
export function getFootReferenceHandles(state: Last2DGeometry): ShapeHandle[] {
  return footStations.map((id): ShapeHandle => {
    const p = getLastAnchor(state.models.foot, id);
    return {
      id: `foot:${id}`,
      label: `Foot ${id.replaceAll("_", " ")}`,
      plane: "top",
      position: [p.y, p.x],
      kind: "point",
      editTarget: "foot",
    };
  });
}
export function moveFootReferenceHandle(
  state: Last2DGeometry,
  input: FootFirstInput,
  id: FootReferenceHandleId,
  target: Vec2,
): string {
  const station = footStations.find((name) => id === `foot:${name}`);
  if (!station) throw new Error(`Unknown foot landmark: ${id}`);
  const F = input.foot.length,
    W = input.foot.width,
    sign = station.startsWith("medial") ? -1 : 1;
  const s = clamp(target[0], 0.01, F - 0.01),
    extent = clamp(sign * target[1], 0.01, 10000);
  let ratio = extent / W;
  if (ratio * W < 0.01) ratio = nextafter(ratio, Infinity);
  if (ratio * W > 10000) ratio = nextafter(ratio, 0);
  input.template[station] = { station_ratio: s / F, side_extent_ratio: ratio };
  rebaseAcceptedLast(state, input);
  return `Foot ${station}: station ${s.toFixed(2)} mm, side extent ${extent.toFixed(2)} mm. Current LAST preserved by rebasing; source observations unchanged. Rebuild validates foot order and pose.`;
}
function rebaseAcceptedLast(state: Last2DGeometry, input: FootFirstInput) {
  const F = input.foot.length,
    W = input.foot.width;
  const outline =
    input.last_outline ?? (input.last_outline = { anchors: {}, handles: {} });
  // Rebase accepted LAST anchors and capture generated vectors, never reset it
  // to the newly edited FOOT. Existing authored vectors remain unchanged.
  for (const anchor of TOP_ANCHORS) {
    const p = getLastAnchor(state.models.top, anchor);
    const footX =
      anchor === "heel_tip" || anchor === "toe_tip"
        ? 0
        : (anchor.startsWith("medial") ? -1 : 1) *
          (input.template[anchor].side_extent_ratio * W);
    const footS =
      anchor === "heel_tip"
        ? 0
        : anchor === "toe_tip"
          ? F + input.design.toe_extension_ratio * W
          : input.template[anchor].station_ratio * F;
    outline.anchors[anchor] = {
      station_offset_ratio:
        anchor === "heel_tip" || anchor === "toe_tip" ? 0 : (p.y - footS) / F,
      side_offset_ratio: (p.x - footX) / W,
    };
    const entry = outline.handles[anchor] ?? (outline.handles[anchor] = {});
    for (const direction of ["incoming", "outgoing"] as const)
      if (!entry[direction]) {
        const h = getLastHandle(state.models.top, anchor, direction);
        entry[direction] = {
          forward_ratio: (h.y - p.y) / F,
          side_ratio: (h.x - p.x) / W,
        };
      }
  }
}
/** Reuse for numeric FOOT-template edits at unchanged F/W; resize keeps normalized rules. */
export function rebaseLastOutline(
  state: Last2DGeometry,
  input: FootFirstInput,
): FootFirstInput {
  if (
    input.foot.length !== state.inputs.foot.length ||
    input.foot.width !== state.inputs.foot.width
  )
    throw new Error(
      "Last rebasing requires unchanged F/W; resize uses normalized dimensions.",
    );
  const next = structuredClone(input);
  rebaseAcceptedLast(state, next);
  return next;
}
export function moveFootHandle(
  state: Last2DGeometry,
  input: FootFirstInput,
  id: TopShapeHandleId,
  target: Vec2,
): string {
  const parts = id.split(":"),
    raw = parts[1] === "last-toe" ? "toe_tip" : parts[1],
    anchorId = TOP_ANCHORS.find((name) => name === raw);
  if (!anchorId) throw new Error(`Unknown last shape handle: ${id}`);
  const F = input.foot.length,
    W = input.foot.width;
  const outline =
    input.last_outline ?? (input.last_outline = { anchors: {}, handles: {} });
  if (parts[2] === "in" || parts[2] === "out") {
    const anchor = getLastAnchor(state.models.top, anchorId),
      s = clamp(target[0], 0, F + input.design.toe_extension_ratio * W);
    const entry = outline.handles[anchorId] ?? (outline.handles[anchorId] = {});
    entry[parts[2] === "in" ? "incoming" : "outgoing"] = {
      forward_ratio: (s - anchor.y) / F,
      side_ratio: (target[1] - anchor.x) / W,
    };
    return `Last ${anchorId} ${parts[2]} handle moved independently; FOOT and the opposite handle are unchanged. Rebuild checks folds and intersections.`;
  }
  const foot = getLastAnchor(state.models.foot, anchorId);
  if (anchorId === "toe_tip") {
    const length = clamp(target[0], F, 10000);
    input.design.toe_extension_ratio = (length - F) / W;
    outline.anchors.toe_tip = {
      station_offset_ratio: 0,
      side_offset_ratio: (target[1] - foot.x) / W,
    };
    return `Last toe: extension ${(length - F).toFixed(2)} mm (% W), side offset ${(target[1] - foot.x).toFixed(2)} mm. FOOT unchanged.`;
  }
  if (anchorId === "heel_tip") {
    outline.anchors.heel_tip = {
      station_offset_ratio: 0,
      side_offset_ratio: (target[1] - foot.x) / W,
    };
    return `Last heel side offset ${(target[1] - foot.x).toFixed(2)} mm; constrained to reference station 0. FOOT unchanged.`;
  }
  const s = clamp(
      target[0],
      0.01,
      F + input.design.toe_extension_ratio * W - 0.01,
    ),
    x = clamp(target[1], -10000, 10000);
  const offset = (x - foot.x) / W;
  outline.anchors[anchorId] = {
    station_offset_ratio: (s - foot.y) / F,
    side_offset_ratio: offset,
  };
  return `Last ${anchorId}: station ${s.toFixed(2)} mm, x ${x.toFixed(2)} mm${s !== target[0] || x !== target[1] ? " (constrained)" : ""}. Only this last anchor moves; FOOT/template/W are unchanged. Release checks crossings.`;
}
