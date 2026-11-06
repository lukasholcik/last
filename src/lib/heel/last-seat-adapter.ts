import baseline from "../../../examples/foot-first-baseline.json";
import { buildFootFirst, parseFootFirstInput } from "../geometry/foot-first";
import type { SeatGuide } from "./model";
import type { Last2DState } from "../geometry/types";
import { sectionExtent, topCurvePoints } from "../geometry/top";
import { curveBounds } from "../geometry/math";

/** Authored Last cubics, restricted to the reference seat arc interval. */
export function seatFromLast(
  source: Pick<Last2DState, "inputs" | "models" | "resolved">,
): SeatGuide {
  const rear = source.models.bottom.points.bottom_heel_rear;
  const front = source.models.bottom.points.bottom_seat_front;
  const S = source.resolved.seat_arc_length;
  if (
    !rear ||
    !front ||
    ![rear.y, rear.z, front.y, front.z, S].every(Number.isFinite)
  )
    throw new Error(
      "Unsupported Last attachment: missing finite seat endpoints or arc length.",
    );
  const length = front.y - rear.y;
  if (!(S > 0 && length > 0 && rear.z > 0 && front.z > 0))
    throw new Error(
      "Unsupported Last attachment: seat must have positive length and clear the ground.",
    );
  const top = source.models.top;
  const minimum = Math.min(
    ...top.outline.map((n) => curveBounds(topCurvePoints(top, n), 1)[0]),
  );
  const rearExtent = sectionExtent(top, 0);
  if (
    Math.abs(minimum) > 1e-7 ||
    Math.abs(rearExtent[1] - rearExtent[0]) > 1e-7
  )
    throw new Error(
      "Unsupported Last attachment: authored outline must have a single rear tip at reference station zero.",
    );
  const at = (fraction: number, side: 0 | 1): [number, number] => [
    sectionExtent(top, S * fraction)[side],
    length * fraction,
  ];
  const rightFront = at(1, 1),
    leftFront = at(1, 0);
  const topOutline = Array.from({ length: 64 }, (_, j): [number, number] => {
    if (j <= 8) return at(0.5 + j / 16, 1);
    if (j <= 24)
      return [
        rightFront[0] + ((leftFront[0] - rightFront[0]) * (j - 8)) / 16,
        length,
      ];
    if (j <= 32) return at(1 - (j - 24) / 16, 0);
    if (j <= 48) return at((48 - j) / 32, 0);
    return at((j - 48) / 32, 1);
  });
  return {
    heelHeight: rear.z,
    pitchDeg: (Math.atan2(rear.z - front.z, length) * 180) / Math.PI,
    length,
    leftX: Math.min(...topOutline.map((p) => p[0])),
    rightX: Math.max(...topOutline.map((p) => p[0])),
    footLength: source.inputs.foot.length,
    footWidth: source.inputs.foot.width,
    topOutline,
    provenance:
      "Linked Last authored top cubics over the reference seat arc; bottom rear/front endpoints set the seat plane.",
    limitation:
      "Shared nominal/untrimmed top attachment outline, not a measured mating surface. The available front shoulder warps the actual seating area; curved sides may move outside the nominal outline. No fit, strength or manufacturing claim.",
  };
}

/** Independent illustrative pose; never reads or modifies the main viewer. */
export function getHeelSeat(heelHeight = 80, seatOffsetDeg = 2): SeatGuide {
  if (!Number.isFinite(heelHeight) || heelHeight <= 0)
    throw new Error("Heel seat height must be finite and above ground.");
  if (!Number.isFinite(seatOffsetDeg))
    throw new Error("Heel seat offset must be finite.");
  const input = parseFootFirstInput(structuredClone(baseline));
  input.pose.heel_height = heelHeight;
  input.pose.seat_inclination_deg = seatOffsetDeg;
  const source = buildFootFirst(input);
  const rear = source.models.bottom.points.bottom_heel_rear!;
  const front = source.models.bottom.points.bottom_seat_front!;
  const length = front.y - rear.y;
  const pitchDeg = (Math.atan2(rear.z - front.z, length) * 180) / Math.PI;
  if (!(length > 0 && rear.z > 0 && front.z > 0))
    throw new Error(
      "Source heel seat must have positive length and clear the ground.",
    );
  return {
    heelHeight: rear.z,
    pitchDeg,
    length,
    leftX: -input.template.medial_heel.side_extent_ratio * input.foot.width,
    rightX: input.template.lateral_heel.side_extent_ratio * input.foot.width,
    footLength: input.foot.length,
    footWidth: input.foot.width,
    provenance:
      `Synthetic schema-v4 foot-first baseline; independent illustrative ${heelHeight} mm pose ` +
      `(source baseline is ${baseline.pose.heel_height} mm), seat offset ${seatOffsetDeg} degrees. ` +
      "Seat plane derives from bottom_heel_rear and bottom_seat_front y,z; widths from medial/lateral heel side_extent_ratio × foot.width.",
    limitation:
      "Provisional D/U-shaped heel-region seat only: rounded rear and straight front. Source has an open bottom centre profile, not a 3D last/seat surface or measured fit. Heel widths are synthetic station extents, not a traced seat perimeter. Front shoulder removes a strip of seating area; no sole is added. No mating-surface, fit, strength or manufacturing claim; independent of the main viewer pose.",
  };
}
