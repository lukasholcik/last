/** Millimetres: x right/lateral, y forward, z up; ground is z=0. */
export type Vec3 = [number, number, number];
export type HeelBoundary = "back" | "front" | "left" | "right";

export interface SeatGuide {
  heelHeight: number;
  pitchDeg: number;
  length: number;
  leftX: number;
  rightX: number;
  footLength: number;
  footWidth: number;
  provenance: string;
  limitation: string;
}

export interface HeelParameters {
  /** Editable provisional extents inside the source box, on its fixed plane. */
  top: { backY: number; frontY: number; leftX: number; rightX: number };
  bottom: { centerX: number; centerY: number; width: number; depth: number };
  /** Absolute scalar Bernstein controls (not samples) from bottom to top. */
  handles: Record<HeelBoundary, [number, number]>;
  /** Mirror only interior transverse controls, retaining asymmetric top bounds. */
  symmetricBody: boolean;
  /** Superellipse exponent 2–4 of the curved rear half only. */
  roundness: number;
  /** Front shoulder amount: removed top-front strip length in the seat plane. */
  frontShoulderMm: number;
}

export interface HeelSection {
  t: number;
  boundary: number[];
  cardinal: Record<HeelBoundary, number>;
}

export interface HeelCap {
  boundary: number[];
  center: number;
}

export interface HeelMesh {
  positions: Vec3[];
  triangles: [number, number, number][];
  rings: Vec3[][];
  sections: HeelSection[];
  caps: { top: HeelCap; bottom: HeelCap };
  bounds: { min: Vec3; max: Vec3 };
  volume: number;
}

/** Body controls/ground footprint may overhang the source by at most 20 mm. */
export function getHeelEditingBounds(seat: SeatGuide): {
  leftX: number;
  rightX: number;
  backY: number;
  frontY: number;
} {
  return {
    leftX: seat.leftX - 20,
    rightX: seat.rightX + 20,
    backY: -20,
    frontY: seat.length + 20,
  };
}

/** Geometric box limits only; plane and fold validation remain additional. */
export function getTipPositionBounds(
  params: HeelParameters,
  seat: SeatGuide,
): {
  x: [number, number];
  y: [number, number];
} {
  const box = getHeelEditingBounds(seat);
  return {
    x: [
      box.leftX + params.bottom.width / 2,
      box.rightX - params.bottom.width / 2,
    ],
    y: [
      box.backY + params.bottom.depth / 2,
      box.frontY - params.bottom.depth / 2,
    ],
  };
}

/** Two starting shapes of the same loft, not distinct geometry algorithms. */
export function createHeelParameters(
  seat: SeatGuide,
  example: "slender" | "broad" = "slender",
): HeelParameters {
  const broad = example === "broad";
  const centerX = (seat.leftX + seat.rightX) / 2;
  const centerY = seat.length * (broad ? 0.49 : 0.36);
  const width = (seat.rightX - seat.leftX) * (broad ? 0.88 : 0.16);
  const depth = seat.length * (broad ? 0.88 : 0.21);
  const back = centerY - depth / 2;
  const front = centerY + depth / 2;
  const left = centerX - width / 2;
  const right = centerX + width / 2;
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  // A narrow lower shaft that flares towards the seat, or near-full footprint.
  const reach: [number, number] = broad ? [1 / 3, 2 / 3] : [0.04, 0.2];
  const controls = (a: number, b: number): [number, number] => [
    mix(a, b, reach[0]),
    mix(a, b, reach[1]),
  ];
  // At a low pose, aggressive longitudinal flare can descend near the seat.
  // Ease only as far toward linear controls as the exact dz/dt certificate
  // needs. The transverse pin/flare and both endpoint footprints stay intact.
  const longitudinalControls = (a: number, b: number): [number, number] => {
    const authored = [a, ...controls(a, b), b];
    const linear = [a, mix(a, b, 1 / 3), mix(a, b, 2 / 3), b];
    const k = Math.tan((seat.pitchDeg * Math.PI) / 180);
    const derivative = (c: number[], i: number) =>
      seat.heelHeight - k * ((i + 1) * c[i]! - i * (c[i - 1] ?? 0));
    let blend = 0;
    const margin = seat.heelHeight * 0.01;
    for (let i = 0; i < 4; i++) {
      const from = derivative(authored, i),
        to = derivative(linear, i);
      if (from < margin && to > from)
        blend = Math.max(blend, Math.min(1, (margin - from) / (to - from)));
    }
    return [
      mix(authored[1]!, linear[1]!, blend),
      mix(authored[2]!, linear[2]!, blend),
    ];
  };
  const k = Math.tan((seat.pitchDeg * Math.PI) / 180);
  const q = Math.hypot(1, k);
  // Visible at the illustrative pose, gently reduced for short/low bodies.
  // Keep a generous margin within the shoulder band and minimum depth limits.
  const frontShoulderMm = Math.max(
    0,
    Math.min(
      3,
      (0.12 * Math.min(seat.heelHeight, seat.heelHeight - k * seat.length)) / q,
      depth * 0.4 * q,
    ),
  );
  return {
    top: {
      backY: 0,
      frontY: seat.length,
      leftX: seat.leftX,
      rightX: seat.rightX,
    },
    bottom: { centerX, centerY, width, depth },
    handles: {
      back: longitudinalControls(back, 0),
      front: longitudinalControls(front, seat.length),
      left: controls(left, seat.leftX),
      right: controls(right, seat.rightX),
    },
    symmetricBody: true,
    roundness: 2,
    frontShoulderMm,
  };
}
