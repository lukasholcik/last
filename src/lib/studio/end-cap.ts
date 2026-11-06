import { sampleCurve, type EditableCurve, type Vec2 } from "~/lib/curves";

/**
 * END CAPS: the heel back and the toe built from horizontal rings.
 *
 * WHY (decision; user reports: a vertical groove down the centre of the heel
 * back, then a pinched toe). The surface is lofted on planes y = const. Near
 * either end those planes are narrow lenses (the plan outline is only a few mm
 * wide there) and each lens takes the section's shape scaled to that width,
 * which narrows to nothing at the crown. So at a given height the surface only
 * starts to open a few slices in, and the end closed as a pinched seam (a fin
 * at the heel, a funnel at the toe) instead of a round wall. A round end is
 * naturally described by HORIZONTAL rings: at every height a closed curve
 * around it. Rejected: more or denser slices (the lens is the problem, not the
 * spacing); a different closing at the very first slice (the fan to the
 * centroid is what made the seam); the slice scaling changed so that lenses
 * keep their height (it moves the pinch, it does not remove it).
 *
 * CONSTRUCTION (designed here, not a published recipe). The slices beyond the
 * BOUNDARY slice (`boundarySlice`, the first full one seen from the end) are
 * dropped. The boundary ring has 8 anchors sole, ..., crown, ... medial_bottom.
 * Its vertices are paired by height: vertex j going up the lateral side with
 * vertex j going up the medial side, j = 0 at the sole and j = N at the crown.
 * Pair j is one ROW: a horizontal half ring that leaves the boundary at the
 * lateral vertex, runs round the end, and returns at the medial vertex.
 *  - The row's SHAPE is the plan outline's own end arc (from where the outline
 *    crosses the boundary slice, round the end, to the other side), scaled to
 *    the row: across by the pair's half distance, lengthwise by the row's
 *    depth. At the widest rail the footprint is the user's outline, and every
 *    row has the same round plan shape.
 *  - The row's DEPTH reaches the END POINT of that height, from the side view:
 *      heel: the contour's rear-most point at that height (its first crossing
 *      of the height, walking up from the sole start), so the centre of the back
 *      follows the drawn contour, counter bulge and roof included;
 *      toe: the contour's front-most point at that height (first crossing
 *      walking back from the toe tip) above the tip's height. Below it the toe
 *      is a WALL (the dorsal ends at the tip's height, not on the sole), and
 *      its underside is rounded back to the sole with a quarter ellipse whose
 *      semi-axes are the wall height (designed; the same rounding the
 *      slice-based nose used to make by squeezing the last rings).
 *    Where the contour does not reach the boundary's heights the depth is 0 and
 *    the row is the boundary pair joined by a line.
 *  - The rows at the sole (z = 0, the flat bottom) are nested outlines of the
 *    sole's end. The crown row is a single point.
 * The rows share the boundary ring's vertices at their two ends, so the mesh is
 * watertight with the slices.
 *
 * Numerical decisions, each found by the fold test in loft.test.ts:
 *  - heights below the contour's lowest point take its start (the sole rows sit
 *    at z = 0 plus or minus rounding, and a lookup that found nothing gave
 *    them no depth, collapsing them onto the boundary);
 *  - heights within 0.1 mm of the sole are the sole (the toe's rounding has an
 *    infinite slope there, so rounding noise gave nested rows different depths
 *    and crossed them);
 *  - the end-most point of every row lies on one centre line (the sole
 *    vertex's x) and the arc's x is rescaled so its tip is exactly the middle
 *    sample (the mean of a row's two boundary vertices drifts by about 0.1 mm
 *    per row, which crossed neighbouring rows where they are that narrow).
 * The crown row is a line, so the quad between it and the row below can hold a
 * zero-thickness sliver in the plane x = 0; it has no area worth shading.
 *
 * Limitations: the cap is an interpolation, not a fit: between the boundary and
 * the end point the rows keep the outline's shape, so the section drawn near
 * the end is not reproduced inside the cap (the sections' stations are in
 * front of it); the rail polylines still run through the cap region as the
 * slices would have placed them and may differ from the cap surface by a few
 * mm there; the rows are horizontal in the flat frame (they rotate with the
 * foot); where the roof meets the toe wall the corner stays as drawn (the
 * contour's own toe tip corner); a blunt end (the first slice already full)
 * keeps the old fan to the centroid.
 */

export type End = "rear" | "front";

/** Ring vertices of one half row between the two boundary ends (designed). */
export const CAP_ARC = 24;

/**
 * The boundary slice for one end: the first slice from that end whose plan
 * width reaches `CAP_WIDTH` (designed: 0.8) of the widest plan width within 30%
 * of the length from that end, but never beyond `limit`, the station of the
 * end-most section (less `CAP_MARGIN`, 2 mm, designed): the cap does not
 * reproduce a section drawn inside it, so it must not swallow one. A pointed
 * toe never gets that wide near its tip, so there the limit decides. Returns an
 * index into `ys` (ascending), or null when the boundary would be one of the
 * first 3 slices from the end (a blunt end or no room: the caller keeps the fan
 * cap).
 */
export const CAP_WIDTH = 0.8,
  CAP_MARGIN = 2;
export function boundarySlice(
  ys: readonly number[],
  widthAt: (y: number) => number,
  end: End,
  limit: number,
): number | null {
  const n = ys.length,
    at = (i: number) => ys[end === "rear" ? i : n - 1 - i]!,
    reach = Math.abs(at(n - 1) - at(0)) * 0.3,
    room = end === "rear" ? limit - CAP_MARGIN : limit + CAP_MARGIN;
  let ref = 0;
  for (let i = 0; i < n && Math.abs(at(i) - at(0)) <= reach; i++)
    ref = Math.max(ref, widthAt(at(i)));
  // i = how many slices from the end; stop at the width, at the limit, at the
  // reach
  let i = 0;
  while (
    i < n - 1 &&
    Math.abs(at(i + 1) - at(0)) <= reach &&
    widthAt(at(i)) < CAP_WIDTH * ref &&
    (end === "rear" ? at(i + 1) <= room : at(i + 1) >= room)
  )
    i++;
  return i < 3 ? null : end === "rear" ? i : n - 1 - i;
}

/** Equal-arclength resample of a polyline to n+1 points. */
export function resample(q: readonly Vec2[], n: number): Vec2[] {
  const cum = [0];
  for (let i = 1; i < q.length; i++)
    cum.push(
      cum[i - 1]! +
        Math.hypot(q[i]![0] - q[i - 1]![0], q[i]![1] - q[i - 1]![1]),
    );
  const total = cum[cum.length - 1]!,
    out: Vec2[] = [];
  let j = 1;
  for (let k = 0; k <= n; k++) {
    const d = (total * k) / n;
    while (j < q.length - 1 && cum[j]! < d) j++;
    const span = cum[j]! - cum[j - 1]!,
      t = span > 1e-12 ? (d - cum[j - 1]!) / span : 0,
      a = q[j - 1]!,
      b = q[j]!;
    out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
  }
  return out;
}

/**
 * The plan outline's end arc up to the boundary station yb, normalised: [X, Yn]
 * with X = +1 at the lateral (larger x) end and -1 at the medial end, Yn = 1 at
 * both ends (y = yb) and 0 at the end-most point; `CAP_ARC + 1` points, evenly
 * spaced along the arc in these units. Null when the outline has no such arc.
 */
export function endArc(
  outline: readonly Vec2[],
  yb: number,
  end: End,
): Vec2[] | null {
  // work as if it were the rear: mirror y for the front
  const m = end === "rear" ? 1 : -1,
    pts = outline.map((p): Vec2 => [p[0], m * p[1]]),
    ybm = m * yb,
    n = pts.length;
  if (n < 4) return null;
  let imin = 0;
  for (let i = 1; i < n; i++) if (pts[i]![1] < pts[imin]![1]) imin = i;
  const walk = (dir: 1 | -1): Vec2[] | null => {
    const out: Vec2[] = [pts[imin]!];
    let i = imin;
    for (let c = 0; c < n; c++) {
      const next = (i + dir + n) % n,
        a = pts[i]!,
        b = pts[next]!;
      if (b[1] > ybm) {
        if (a[1] > ybm || b[1] === a[1]) return null;
        const t = (ybm - a[1]) / (b[1] - a[1]);
        out.push([a[0] + t * (b[0] - a[0]), ybm]);
        return out;
      }
      out.push(b);
      i = next;
    }
    return null;
  };
  const f = walk(1),
    b = walk(-1);
  if (!f || !b) return null;
  const tipAt = b.length - 1; // index of the end-most point in the arc
  let arc = [...b.reverse(), ...f.slice(1)],
    tip = tipAt;
  if (arc[0]![0] < arc[arc.length - 1]![0]) {
    arc = arc.reverse();
    tip = arc.length - 1 - tipAt;
  }
  const xm = (arc[0]![0] + arc[arc.length - 1]![0]) / 2,
    half = (arc[0]![0] - arc[arc.length - 1]![0]) / 2,
    ymin = pts[imin]![1],
    span = ybm - ymin,
    xt = (arc[tip]![0] - xm) / half;
  if (half < 1e-6 || span < 1e-6 || Math.abs(xt) > 0.9) return null;
  const norm = arc.map((p): Vec2 => [(p[0] - xm) / half, (p[1] - ymin) / span]),
    // The end-most point is a sample (the middle one) and lies on X = 0, so
    // every row's end point is on the common centre line and the two halves
    // are sampled separately: X is rescaled piecewise linearly for that
    // (at most a tenth of the half width, the outline's own tip is not
    // exactly in the middle of the boundary).
    h1 = resample(norm.slice(0, tip + 1), CAP_ARC / 2),
    h2 = resample(norm.slice(tip), CAP_ARC / 2);
  return [
    ...h1.map((p): Vec2 => [(p[0] - xt) / (1 - xt), p[1]]),
    ...h2.slice(1).map((p): Vec2 => [(p[0] - xt) / (1 + xt), p[1]]),
  ];
}

/**
 * The end point of each height, from the side contour: y as a function of z, or
 * null where the contour has none (see the header). `yb` is the boundary
 * station.
 */
export function endAt(
  dorsal: EditableCurve,
  yb: number,
  end: End,
): (z: number) => number | null {
  const all = sampleCurve(dorsal, 60),
    // the contour from its end towards the boundary station
    pts = end === "rear" ? all : [...all].reverse(),
    run: Vec2[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!,
      s = end === "rear" ? 1 : -1;
    if (s * b[0] >= s * yb && s * a[0] < s * yb && b[0] !== a[0]) {
      const t = (yb - a[0]) / (b[0] - a[0]);
      run.push([yb, a[1] + t * (b[1] - a[1])]);
      break;
    }
    run.push(b);
  }
  const wall = end === "front" ? Math.max(0, run[0]![1]) : 0,
    tipY = run[0]![0];
  // heights below the contour's lowest point (the sole rows sit at z = 0 plus
  // or minus rounding, and the contour starts exactly at 0) take its start
  const zLow = Math.min(...run.map((p) => p[1]));
  return (zIn) => {
    // The flat bottom's rows differ in height by rounding noise (up to about
    // 0.02 mm). The toe's rounding has an infinite slope at the sole, so that
    // noise would give nested rows different depths and cross them (a fold).
    // Heights within `SNAP` of the sole are the sole (designed: 0.1 mm, far
    // below what the model draws).
    const z0 = Math.abs(zIn) < 0.1 ? 0 : zIn;
    // toe wall: below the tip's height, rounded back to the sole
    if (wall > 0.5 && z0 < wall) {
      const u = Math.min(1, (wall - z0) / wall);
      return tipY - wall * (1 - Math.sqrt(1 - u * u));
    }
    const z = Math.max(z0, zLow);
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!,
        b = run[i]!;
      if ((a[1] - z) * (b[1] - z) > 0 || a[1] === b[1]) continue;
      return a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    }
    return null;
  };
}

type V3 = readonly [number, number, number];

/**
 * The cap's points. `lateral[j]` and `medial[j]` are the boundary vertices of
 * pair j (j = 0 sole ... N crown; lateral[0] equals medial[0], and so do the
 * last), in the flat frame with the heel overhang already applied. Returns
 * `rows[j][m]`, m = 0..CAP_ARC, m = 0 the lateral and m = CAP_ARC the medial
 * boundary vertex; null if the outline gives no end arc.
 */
export function capRows(
  lateral: readonly V3[],
  medial: readonly V3[],
  outline: readonly Vec2[],
  dorsal: EditableCurve,
  yb: number,
  end: End,
): V3[][] | null {
  const arc = endArc(outline, yb, end);
  if (!arc) return null;
  const at = endAt(dorsal, yb, end),
    s = end === "rear" ? 1 : -1,
    axis = lateral[0]![0];
  return lateral.map((A, j): V3[] => {
    const B = medial[j]!,
      c: V3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2],
      h: V3 = [(B[0] - A[0]) / 2, (B[1] - A[1]) / 2, (B[2] - A[2]) / 2],
      ye = at(c[2]),
      // how far the end point lies beyond the row's centre, lengthwise
      d = ye === null ? 0 : Math.max(0, s * (c[1] - ye));
    return arc.map(([X, Yn], m): V3 => {
      // the ends are the boundary vertices themselves, exactly
      if (m === 0) return A;
      if (m === CAP_ARC) return B;
      return [
        // x: the end-most point of every row lies on the common centre line
        // (x of the sole vertex), and the row bends to the exact boundary
        // vertices at its two ends (X = +1, -1) with a smooth weight X^2.
        // Without it each row's centre is the mean of its two boundary
        // vertices, which drifts by about 0.1 mm per row; where the rows are
        // that narrow (a pointed toe's sole) neighbouring rows then cross.
        axis * (1 - X * X) + c[0] * X * X - X * h[0],
        c[1] - X * h[1] - s * (1 - Yn) * d,
        c[2] - X * h[2],
      ];
    });
  });
}
