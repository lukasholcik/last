import type { HeelParameters } from "~/lib/heel/model";

export type TipAxis = "x" | "y";

/** Offsets reference the sharp top envelope, not the trimmed cap's centroid. */
export function topEnvelopeCenter(
  parameters: HeelParameters,
  axis: TipAxis,
): number {
  return axis === "x"
    ? (parameters.top.leftX + parameters.top.rightX) / 2
    : (parameters.top.backY + parameters.top.frontY) / 2;
}

export function tipOffset(parameters: HeelParameters, axis: TipAxis): number {
  return (
    parameters.bottom[axis === "x" ? "centerX" : "centerY"] -
    topEnvelopeCenter(parameters, axis)
  );
}

/** Change exactly one bottom coordinate; never transport authored body handles. */
export function placeTip(
  parameters: HeelParameters,
  axis: TipAxis,
  absolute: number,
): HeelParameters {
  return {
    ...parameters,
    bottom: {
      ...parameters.bottom,
      [axis === "x" ? "centerX" : "centerY"]: absolute,
    },
  };
}

export function placeTipAtOffset(
  parameters: HeelParameters,
  axis: TipAxis,
  offset: number,
): HeelParameters {
  return placeTip(
    parameters,
    axis,
    topEnvelopeCenter(parameters, axis) + offset,
  );
}
