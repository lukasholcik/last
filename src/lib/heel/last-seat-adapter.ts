import baseline from "../../../examples/foot-first-baseline.json";
import { buildFootFirst, parseFootFirstInput } from "../geometry/foot-first";
import type { SeatGuide } from "./model";

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
