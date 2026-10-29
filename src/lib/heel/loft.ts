import type {
  HeelBoundary,
  HeelMesh,
  HeelParameters,
  HeelSection,
  HeelCap,
  SeatGuide,
  Vec3,
} from "./model";
import { getHeelEditingBounds } from "./model";
export { getHeelEditingBounds, getTipPositionBounds } from "./model";

type Controls = [number, number, number, number];
type BoundsControls = Record<HeelBoundary, Controls>;
const BOUNDARIES: HeelBoundary[] = ["back", "front", "left", "right"];
const SEGMENTS = 64;
const LEVELS = 32;
const EPS = 1e-5;
type Shoulder = { a: number; dt: number; t0: number };

function shoulder(p: HeelParameters, seat: SeatGuide): Shoulder {
  const k = Math.tan((seat.pitchDeg * Math.PI) / 180);
  const q = Math.hypot(1, k);
  const a = p.frontShoulderMm / q;
  const hcap = seat.heelHeight - k * (p.top.frontY - a);
  const dt = p.frontShoulderMm === 0 ? 0 : (p.frontShoulderMm * q) / hcap;
  return { a, dt, t0: 1 - dt };
}

function trimAt(s: Shoulder, t: number): number {
  if (s.dt === 0 || t <= s.t0) return 0;
  if (t >= 1) return s.a;
  const u = Math.min(1, (t - s.t0) / s.dt);
  // Stable at the lower joint (equivalent to 1-sqrt(1-u²)).
  return (s.a * u * u) / (1 + Math.sqrt(Math.max(0, 1 - u * u)));
}

function fail(message: string): never {
  throw new Error(`Invalid heel: ${message} Keep the last valid mesh.`);
}

function controls(p: HeelParameters): BoundsControls {
  const { bottom: b, top: a, handles: h } = p;
  const result: BoundsControls = {
    back: [b.centerY - b.depth / 2, ...h.back, a.backY],
    front: [b.centerY + b.depth / 2, ...h.front, a.frontY],
    left: [b.centerX - b.width / 2, ...h.left, a.leftX],
    right: [b.centerX + b.width / 2, ...h.right, a.rightX],
  };
  if (p.symmetricBody) {
    for (const i of [1, 2] as const) {
      const t = i / 3;
      const center = b.centerX * (1 - t) + ((a.leftX + a.rightX) / 2) * t;
      // Both authored sides contribute to width; only interior centre is mirrored.
      const radius = (result.right[i] - result.left[i]) / 2;
      result.left[i] = center - radius;
      result.right[i] = center + radius;
    }
  }
  return result;
}

function cubic(c: Controls, t: number): number {
  const s = 1 - t;
  return (
    s * s * s * c[0] +
    3 * s * s * t * c[1] +
    3 * s * t * t * c[2] +
    t * t * t * c[3]
  );
}

function validate(p: HeelParameters, seat: SeatGuide): BoundsControls {
  const values = [
    ...Object.values(p.top),
    ...Object.values(p.bottom),
    ...BOUNDARIES.flatMap((name) => p.handles[name]),
    p.roundness,
    p.frontShoulderMm,
    seat.heelHeight,
    seat.pitchDeg,
    seat.length,
    seat.leftX,
    seat.rightX,
    seat.footLength,
    seat.footWidth,
  ];
  if (!values.every(Number.isFinite))
    fail("all dimensions and controls must be finite.");
  if (typeof p.symmetricBody !== "boolean")
    fail("symmetricBody must be boolean.");
  if (p.roundness < 2 || p.roundness > 4)
    fail("roundness must be between 2 and 4.");
  if (p.frontShoulderMm < 0 || p.frontShoulderMm > 6)
    fail("front shoulder amount must be between 0 and 6 mm.");
  if (!(
    seat.heelHeight >= 1 &&
    seat.heelHeight <= 300 &&
    seat.footWidth > 0 &&
    seat.footLength > 0
  ))
    fail("seat height must be 1–300 mm and foot dimensions positive.");
  if (!(
    seat.length > EPS &&
    seat.length < seat.footLength &&
    seat.leftX < 0 &&
    seat.rightX > 0
  ))
    fail(
      "seat must be a positive heel-region guide with signed left/right widths.",
    );
  if (Math.abs(seat.pitchDeg) >= 80)
    fail("seat pitch must be within ±80 degrees.");
  // The provisional outline is editable; only its containing source box and
  // the global source seat plane are fixed.
  if (p.top.frontY - p.top.backY <= EPS || p.top.rightX - p.top.leftX <= EPS)
    fail(
      "top outline must retain positive width and depth (crossed top bounds).",
    );
  if (
    p.top.backY < 0 ||
    p.top.frontY > seat.length ||
    p.top.leftX < seat.leftX ||
    p.top.rightX > seat.rightX
  )
    fail("top outline must remain inside the source heel-region seat bounds.");
  if (p.bottom.width <= EPS || p.bottom.depth <= EPS)
    fail("bottom footprint must have positive width and depth.");
  const c = controls(p);
  const box = getHeelEditingBounds(seat);
  const k = Math.tan((seat.pitchDeg * Math.PI) / 180);
  if (Math.min(seat.heelHeight, seat.heelHeight - k * seat.length) <= EPS)
    fail("the full source seat plane must remain above ground.");
  for (let i = 0; i < 4; i++) {
    if (c.right[i]! - c.left[i]! <= EPS || c.front[i]! - c.back[i]! <= EPS)
      fail(
        "every Bernstein control must retain positive width and depth (crossed handles).",
      );
    if (
      c.left[i]! < box.leftX ||
      c.right[i]! > box.rightX ||
      c.back[i]! < box.backY ||
      c.front[i]! > box.frontY
    )
      fail(
        "footprint and body handles must remain within the 20 mm source overhang bounds.",
      );
    for (const boundary of ["back", "front"] as const) {
      const y = c[boundary][i]!;
      if (seat.heelHeight - k * y <= EPS)
        fail("the full seat plane must remain above ground.");
      // Bernstein coefficients of d[t*(H-k*y(t))]/dt. The source origin
      // remains fixed even when the provisional top backY is moved forward.
      // Nominal y is cubic. This certificate is NOT a monotone-world-z claim
      // for the shoulder: its front rim may descend along the tilted plane.
      const previous = i === 0 ? 0 : c[boundary][i - 1]!;
      const dy = (i + 1) * y - i * previous;
      if (seat.heelHeight - k * dy <= EPS)
        fail(
          "handles exceed the conservative monotone-height bound; reduce flare or pitch.",
        );
    }
  }
  if (p.frontShoulderMm > 0) {
    const s = shoulder(p, seat);
    const minimumHalfDepth = Math.min(
      ...c.front.map((f, i) => (f - c.back[i]!) / 2),
    );
    if (!(s.a < minimumHalfDepth))
      fail(
        "front shoulder trim must be smaller than every nominal half-depth control.",
      );
    if (!(Number.isFinite(s.dt) && s.dt > 0 && s.dt <= 0.25))
      fail(
        "front shoulder requires a positive cap height and a band no larger than 25% of the body.",
      );
  }
  return c;
}

function signedPower(v: number, power: number): number {
  // Exact cardinal points avoid tiny near-zero powers at superellipse axes.
  return Math.abs(v) < 1e-14 ? 0 : Math.sign(v) * Math.abs(v) ** power;
}

function point(
  p: HeelParameters,
  seat: SeatGuide,
  c: BoundsControls,
  t: number,
  theta: number,
  trim = trimAt(shoulder(p, seat), t),
): Vec3 {
  const left = cubic(c.left, t),
    right = cubic(c.right, t);
  const back = cubic(c.back, t),
    front = cubic(c.front, t);
  const centerY = (back + front) / 2;
  const actualFront = front - trim;
  const angle = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let x: number, y: number;
  if (angle < Math.PI / 4) {
    x = right;
    y = centerY + ((4 * angle) / Math.PI) * (actualFront - centerY);
  } else if (angle < (3 * Math.PI) / 4) {
    x = right + ((2 * (angle - Math.PI / 4)) / Math.PI) * (left - right);
    y = actualFront;
  } else if (angle < Math.PI) {
    x = left;
    y =
      actualFront +
      ((4 * (angle - (3 * Math.PI) / 4)) / Math.PI) * (centerY - actualFront);
  } else {
    x =
      (left + right) / 2 +
      ((right - left) / 2) * signedPower(Math.cos(angle), 2 / p.roundness);
    y =
      centerY +
      ((front - back) / 2) * signedPower(Math.sin(angle), 2 / p.roundness);
  }
  return [
    x,
    y,
    t * (seat.heelHeight - Math.tan((seat.pitchDeg * Math.PI) / 180) * y),
  ];
}

/** Sharp nominal top envelope, not the shoulder-trimmed actual cap boundary. */
export function getTopEnvelope(p: HeelParameters, seat: SeatGuide): Vec3[] {
  const c = validate(p, seat);
  return Array.from({ length: SEGMENTS }, (_, j) =>
    point(p, seat, c, 1, (j * 2 * Math.PI) / SEGMENTS, 0),
  );
}

export function pointOnHeel(
  p: HeelParameters,
  seat: SeatGuide,
  t: number,
  theta: number,
): Vec3 {
  if (!Number.isFinite(t) || t < 0 || t > 1 || !Number.isFinite(theta))
    fail("point queries require t in [0,1] and finite theta.");
  return point(p, seat, validate(p, seat), t, theta);
}

/**
 * Representative control markers, NOT a 3D cubic control polygon. x/y use the
 * actual scalar Bernstein controls; z is the section-plane height at i/3.
 * These describe the nominal envelope, NOT the trimmed actual cap. The nominal
 * boundary z is quartic; the shoulder is not polynomial. Draw the mesh instead.
 */
export function curveControlPoints(
  p: HeelParameters,
  seat: SeatGuide,
  boundary: HeelBoundary,
): Vec3[] {
  const c = validate(p, seat);
  const result: Vec3[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const x =
      boundary === "left" || boundary === "right"
        ? c[boundary][i]!
        : (c.left[i]! + c.right[i]!) / 2;
    const y =
      boundary === "back" || boundary === "front"
        ? c[boundary][i]!
        : (c.back[i]! + c.front[i]!) / 2;
    result.push([
      x,
      y,
      t * (seat.heelHeight - Math.tan((seat.pitchDeg * Math.PI) / 180) * y),
    ]);
  }
  return result;
}

/** Deterministic shared-vertex closed loft; no render-library dependency. */
export function buildHeel(p: HeelParameters, seat: SeatGuide): HeelMesh {
  const c = validate(p, seat);
  const s = shoulder(p, seat);
  const samples = Array.from({ length: LEVELS + 1 }, (_, i) => ({
    t: (s.t0 * i) / LEVELS,
    trim: 0,
  }));
  if (s.dt > 0)
    for (let m = 1; m <= 8; m++) {
      const phi = (m * Math.PI) / 16;
      samples.push({
        t: m === 8 ? 1 : s.t0 + s.dt * Math.sin(phi),
        trim: m === 8 ? s.a : s.a * (1 - Math.cos(phi)),
      });
    }
  const rings = samples.map(({ t, trim }) =>
    Array.from({ length: SEGMENTS }, (_, j) =>
      point(p, seat, c, t, (j * 2 * Math.PI) / SEGMENTS, trim),
    ),
  );
  const positions = rings.flat();
  const sections: HeelSection[] = samples.map(({ t }, i) => {
    const offset = i * SEGMENTS;
    return {
      t,
      boundary: Array.from({ length: SEGMENTS }, (_, j) => offset + j),
      cardinal: {
        right: offset,
        front: offset + SEGMENTS / 4,
        left: offset + SEGMENTS / 2,
        back: offset + (3 * SEGMENTS) / 4,
      },
    };
  });
  const intervals = sections.length - 1;
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < intervals; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * SEGMENTS + j,
        b = i * SEGMENTS + ((j + 1) % SEGMENTS);
      triangles.push([a, b, b + SEGMENTS], [a, b + SEGMENTS, a + SEGMENTS]);
    }
  }
  const createCap = (level: number): HeelCap => {
    const t = sections[level]!.t;
    const y = (cubic(c.back, t) + cubic(c.front, t)) / 2;
    const center: Vec3 = [
      (cubic(c.left, t) + cubic(c.right, t)) / 2,
      y,
      t * (seat.heelHeight - Math.tan((seat.pitchDeg * Math.PI) / 180) * y),
    ];
    const index = positions.length;
    positions.push(center);
    for (let j = 0; j < SEGMENTS; j++) {
      const a = level * SEGMENTS + j,
        b = level * SEGMENTS + ((j + 1) % SEGMENTS);
      triangles.push(level === 0 ? [index, b, a] : [index, a, b]);
    }
    return { boundary: sections[level]!.boundary, center: index };
  };
  const caps = { bottom: createCap(0), top: createCap(intervals) };
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of positions)
    for (const axis of [0, 1, 2] as const) {
      if (!Number.isFinite(v[axis])) fail("generated a non-finite vertex.");
      min[axis] = Math.min(min[axis], v[axis]);
      max[axis] = Math.max(max[axis], v[axis]);
    }
  // Certify the faceted mesh as well as the continuous family. The positive
  // projective map (x,y,z)/h(y) sends ring planes to parallel t=z/h(y) planes
  // and preserves triangles. Every side facet must face away from both ends
  // of the line joining its two interior ring centres. Hence each intermediate
  // polygon is strictly star-shaped about that line (winding one), not folded.
  const k = Math.tan((seat.pitchDeg * Math.PI) / 180);
  const projected = positions.map(([x, y, z]): Vec3 => {
    const h = seat.heelHeight - k * y;
    return [x / h, y / h, z / h];
  });
  const centers = rings.map((_, i): Vec3 => {
    const t = sections[i]!.t;
    const x = (cubic(c.left, t) + cubic(c.right, t)) / 2;
    const y = (cubic(c.back, t) + cubic(c.front, t)) / 2;
    const h = seat.heelHeight - k * y;
    return [x / h, y / h, t];
  });
  for (let i = 0; i < intervals * SEGMENTS * 2; i++) {
    const [ia, ib, ic] = triangles[i]!;
    const a = projected[ia]!,
      b = projected[ib]!,
      d = projected[ic]!;
    const u = b.map((v, axis) => v - a[axis]!) as Vec3;
    const v = d.map((value, axis) => value - a[axis]!) as Vec3;
    const n: Vec3 = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const level = Math.floor(i / (SEGMENTS * 2));
    for (const center of [centers[level]!, centers[level + 1]!]) {
      const outward =
        n[0] * (a[0] - center[0]) +
        n[1] * (a[1] - center[1]) +
        n[2] * (a[2] - center[2]);
      if (!(outward > 0))
        fail(
          "handles create a folded or non-star-shaped mesh facet; reduce ring shift or flare.",
        );
    }
  }
  let volume = 0;
  for (const [ia, ib, ic] of triangles) {
    const a = positions[ia]!,
      b = positions[ib]!,
      d = positions[ic]!;
    const u = b.map((v, i) => v - a[i]!) as Vec3;
    const v = d.map((value, i) => value - a[i]!) as Vec3;
    const cross: Vec3 = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    if (Math.hypot(...cross) <= EPS * EPS)
      fail("footprint produces a degenerate triangle.");
    volume += (a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2]) / 6;
  }
  if (!(Number.isFinite(volume) && volume > EPS))
    fail("mesh must have finite positive oriented volume.");
  return {
    positions,
    triangles,
    rings,
    sections,
    caps,
    bounds: { min, max },
    volume,
  };
}

/** Project the SAME vertices/triangles for filled 2D mesh silhouettes. */
export function projectMesh(
  mesh: HeelMesh,
  view: "side" | "rear" | "top" | "bottom",
): {
  positions: [number, number][];
  triangles: [number, number, number][];
} {
  return {
    positions: mesh.positions.map(([x, y, z]) =>
      view === "side" ? [y, z] : view === "rear" ? [x, z] : [x, y],
    ),
    triangles: mesh.triangles,
  };
}
