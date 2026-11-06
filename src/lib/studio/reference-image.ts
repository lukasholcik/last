import { z } from "zod";
import type { Vec2 } from "~/lib/curves";

/**
 * A reference image placed in WORLD units (mm) behind a view, to trace over.
 *
 * DECISIONS
 * - It is a workspace aid, not model data: it is stored per edit space in the
 *   browser, kept out of the document JSON and the undo history, and never
 *   read by any geometry or check. Moving it cannot change the last.
 * - `src` is a downscaled copy (see `readImageFile`), so a large photo neither
 *   bloats storage nor leaves the browser. Nothing is uploaded anywhere.
 * - The image has no inherent scale. Matching the model is done by the user:
 *   drag, scale, rotate, or calibrate from two points of known distance.
 */
export interface RefImage {
  /** Data URL of the (downscaled) image. */
  readonly src: string;
  readonly name: string;
  /** Natural width / height, fixed at upload. */
  readonly aspect: number;
  /** Centre in world mm. */
  readonly cx: number;
  readonly cy: number;
  /** Width in world mm; height is width / aspect. */
  readonly width: number;
  /** Counter-clockwise degrees with y up. */
  readonly rotationDeg: number;
  readonly opacity: number;
  readonly flipX: boolean;
  /** A locked image ignores the image tool, so it cannot be nudged by accident. */
  readonly locked: boolean;
  readonly visible: boolean;
}

export const MIN_IMAGE_WIDTH = 1;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export const imageHeight = (i: RefImage) => i.width / i.aspect;

/** Local (image-axis) offset from the centre → world point. */
export function localToWorld(i: RefImage, p: Vec2): Vec2 {
  const c = Math.cos(rad(i.rotationDeg)),
    s = Math.sin(rad(i.rotationDeg));
  return [i.cx + p[0] * c - p[1] * s, i.cy + p[0] * s + p[1] * c];
}
export function worldToLocal(i: RefImage, p: Vec2): Vec2 {
  const c = Math.cos(rad(i.rotationDeg)),
    s = Math.sin(rad(i.rotationDeg)),
    x = p[0] - i.cx,
    y = p[1] - i.cy;
  return [x * c + y * s, -x * s + y * c];
}

/** Corners in world space: 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left. */
export function imageCorners(i: RefImage): [Vec2, Vec2, Vec2, Vec2] {
  const hw = i.width / 2,
    hh = imageHeight(i) / 2;
  return [
    localToWorld(i, [-hw, -hh]),
    localToWorld(i, [hw, -hh]),
    localToWorld(i, [hw, hh]),
    localToWorld(i, [-hw, hh]),
  ];
}

export function imageContains(i: RefImage, p: Vec2): boolean {
  const [x, y] = worldToLocal(i, p);
  return Math.abs(x) <= i.width / 2 && Math.abs(y) <= imageHeight(i) / 2;
}

export const moveImage = (i: RefImage, d: Vec2): RefImage => ({
  ...i,
  cx: i.cx + d[0],
  cy: i.cy + d[1],
});

/** Scale by `k` about a world point, which stays fixed. */
export function scaleImageAbout(
  i: RefImage,
  anchor: Vec2,
  k: number,
): RefImage {
  const f = Math.max(k, MIN_IMAGE_WIDTH / i.width);
  return {
    ...i,
    width: i.width * f,
    cx: anchor[0] + (i.cx - anchor[0]) * f,
    cy: anchor[1] + (i.cy - anchor[1]) * f,
  };
}

/**
 * Drag a corner: the opposite corner stays fixed, the aspect ratio is kept, and
 * the dragged corner follows the pointer's projection onto the diagonal.
 */
export function scaleImageFromCorner(
  i: RefImage,
  corner: 0 | 1 | 2 | 3,
  pointer: Vec2,
): RefImage {
  const corners = imageCorners(i),
    anchor = corners[((corner + 2) % 4) as 0 | 1 | 2 | 3],
    dragged = corners[corner],
    diag: Vec2 = [dragged[0] - anchor[0], dragged[1] - anchor[1]],
    v: Vec2 = [pointer[0] - anchor[0], pointer[1] - anchor[1]],
    k = (v[0] * diag[0] + v[1] * diag[1]) / (diag[0] ** 2 + diag[1] ** 2);
  return scaleImageAbout(i, anchor, k);
}

/** Point the image's "up" handle at the pointer; optionally snap to `step` degrees. */
export function rotateImageTo(
  i: RefImage,
  pointer: Vec2,
  step?: number,
): RefImage {
  let a = deg(Math.atan2(pointer[1] - i.cy, pointer[0] - i.cx)) - 90;
  if (step) a = Math.round(a / step) * step;
  a = ((((a + 180) % 360) + 360) % 360) - 180;
  return { ...i, rotationDeg: a };
}

/**
 * Calibrate: the two world points p1, p2 currently show something whose true
 * separation is `realMm`. Scale about p1 so they become exactly that far apart.
 */
export function calibrateImage(
  i: RefImage,
  p1: Vec2,
  p2: Vec2,
  realMm: number,
): RefImage | null {
  const now = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (!(now > 1e-9) || !(realMm > 0) || !Number.isFinite(realMm)) return null;
  return scaleImageAbout(i, p1, realMm / now);
}

function bounds(points: readonly Vec2[]) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
}

/** Centre the image on the points' bounds without changing its size. */
export function centerImageOn(i: RefImage, points: readonly Vec2[]): RefImage {
  if (!points.length) return i;
  const b = bounds(points);
  return { ...i, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
}

/** Centre the image and size it so the points sit inside its frame, with margin. */
export function fitImageAround(
  i: RefImage,
  points: readonly Vec2[],
  margin = 1.15,
): RefImage {
  if (!points.length) return i;
  const b = bounds(points),
    w = Math.max(b.x1 - b.x0, 1),
    h = Math.max(b.y1 - b.y0, 1),
    width = Math.max(w, h * i.aspect) * margin;
  return centerImageOn(
    { ...i, width: Math.max(width, MIN_IMAGE_WIDTH), rotationDeg: 0 },
    points,
  );
}

/** A newly loaded image, placed behind the curve at half opacity. */
export function newRefImage(
  src: string,
  name: string,
  aspect: number,
  around: readonly Vec2[],
): RefImage {
  return fitImageAround(
    {
      src,
      name,
      aspect,
      cx: 0,
      cy: 0,
      width: 100,
      rotationDeg: 0,
      opacity: 0.5,
      flipX: false,
      locked: false,
      visible: true,
    },
    around,
  );
}

const schema = z
  .object({
    src: z.string().startsWith("data:image/"),
    name: z.string(),
    aspect: z.number().positive().finite(),
    cx: z.number().finite(),
    cy: z.number().finite(),
    width: z.number().min(MIN_IMAGE_WIDTH).finite(),
    rotationDeg: z.number().finite(),
    opacity: z.number().min(0).max(1),
    flipX: z.boolean(),
    locked: z.boolean(),
    visible: z.boolean(),
  })
  .strict();

export const serializeRefImage = (i: RefImage) => JSON.stringify(i);
/** Throws on malformed or non-image data; callers drop the image. */
export const parseRefImage = (text: string): RefImage =>
  schema.parse(JSON.parse(text));
