import {
  createCurve,
  sampleCurve,
  type EditableCurve,
  type Vec2,
} from "~/lib/curves";

/** Plan-view landmarks. x is lateral (medial negative), y runs heel (0) to toe. */
export const TOP_ROLES = {
  heel_back: "Heel back",
  medial_heel: "Medial heel",
  medial_waist: "Medial waist",
  medial_ball: "Medial ball",
  medial_toe: "Medial toe",
  toe_tip: "Toe tip",
  lateral_toe: "Lateral toe",
  lateral_ball: "Lateral ball",
  lateral_waist: "Lateral waist",
  lateral_heel: "Lateral heel",
} as const;
export type TopRole = keyof typeof TOP_ROLES;

export const roleLabel = (role: string | undefined): string | null =>
  role ? ((TOP_ROLES as Record<string, string>)[role] ?? role) : null;

/** A neutral synthetic outline, 270 mm long; a starting point, not a measurement. */
export function defaultTopOutline(): EditableCurve {
  const pts: [TopRole, Vec2][] = [
    ["heel_back", [0, 0]],
    ["medial_heel", [-31, 36]],
    ["medial_waist", [-33, 100]],
    ["medial_ball", [-50, 190]],
    ["medial_toe", [-40, 246]],
    ["toe_tip", [-10, 270]],
    ["lateral_toe", [28, 247]],
    ["lateral_ball", [48, 180]],
    ["lateral_waist", [41, 100]],
    ["lateral_heel", [31, 36]],
  ];
  const base = createCurve(
    pts.map(([, pos]) => ({ pos })),
    true,
  );
  return {
    ...base,
    points: base.points.map((p, i) => ({ ...p, role: pts[i]![0] })),
  };
}

export interface Station {
  readonly id: "heel" | "waist" | "ball" | "toe";
  readonly label: string;
  /** Mean y of the two landmarks, mm from the heel. */
  readonly y: number;
  /** Fraction of overall length. */
  readonly ratio: number;
  /** Full outline width at this y, mm. */
  readonly width: number | null;
}

export interface TopMeasures {
  readonly length: number;
  readonly width: number;
  readonly yMin: number;
  readonly yMax: number;
  readonly stations: readonly Station[];
}

/** Horizontal extent of the outline at height y (null if it doesn't reach y). */
export function widthAtY(c: EditableCurve, y: number): number | null {
  const s = sampleCurve(c, 48),
    xs: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const a = s[i]!,
      b = s[(i + 1) % s.length]!;
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1])
      xs.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
  }
  return xs.length < 2 ? null : Math.max(...xs) - Math.min(...xs);
}

const STATIONS: [Station["id"], string, TopRole, TopRole][] = [
  ["heel", "Heel", "medial_heel", "lateral_heel"],
  ["waist", "Waist", "medial_waist", "lateral_waist"],
  ["ball", "Ball", "medial_ball", "lateral_ball"],
  ["toe", "Toe", "medial_toe", "lateral_toe"],
];

export function topMeasures(c: EditableCurve): TopMeasures {
  const s = sampleCurve(c, 48),
    ys = s.map((p) => p[1]),
    xs = s.map((p) => p[0]),
    yMin = Math.min(...ys),
    yMax = Math.max(...ys),
    length = yMax - yMin,
    byRole = (r: string) => c.points.find((p) => p.role === r),
    stations: Station[] = [];
  for (const [id, label, a, b] of STATIONS) {
    const pa = byRole(a),
      pb = byRole(b);
    if (!pa || !pb) continue;
    const y = (pa.pos[1] + pb.pos[1]) / 2;
    stations.push({
      id,
      label,
      y,
      ratio: length > 0 ? (y - yMin) / length : 0,
      width: widthAtY(c, y),
    });
  }
  return {
    length,
    width: Math.max(...xs) - Math.min(...xs),
    yMin,
    yMax,
    stations,
  };
}
