import { sampleCurve, type EditableCurve, type Vec2 } from "~/lib/curves";
import { flatToPosed, type UpperFrame } from "./contour";
import { RAIL_ROLES, type RailRole } from "./rails";
import {
  SECTION_IDS,
  heightAtStation,
  sectionGeometry,
  type SectionId,
} from "./section";
import { cutZ } from "./cut";
import type { StudioDoc } from "./document";
import { CAP_ARC, boundarySlice, capRows, resample, type End } from "./end-cap";

/**
 * 3D SURFACE (read-only), lofted from the rails and the sections.
 *
 * Construction (designed here; the standard "sections + longitudinal curves"
 * idea of surface-from-curve-network last modelling, not a published recipe):
 *  1. SLICES. The surface is sampled on planes y = const (heel to toe). On each
 *     slice the eight RAILS give the eight anchor points, in the section's
 *     point order, so the rails fully control where the surface passes.
 *  2. SHAPE BETWEEN ANCHORS. Each section contributes, for every stretch
 *     between two neighbouring anchors, its own drawn curve between the same
 *     two points. That curve is scaled to the slice (x by the slice's
 *     across-width over the section's, z by its height over the section's, both
 *     measured between the lateral/medial and sole/crown anchors) and put on the
 *     slice's start anchor; whatever is left between its end and the slice's
 *     next anchor is added back with a smoothstep, whose slope is zero at both
 *     ends. The neighbouring sections' curves are blended along the length
 *     (smoothstep, so every section is reproduced exactly at its own station).
 *     Decision, and why: the first version stored the curve relative to the
 *     chord between the anchors and re-applied it to the slice's chord. That
 *     rotates the section's tangent at an anchor by the difference between the
 *     two chords, and the two stretches that meet at an anchor rotate by
 *     different amounts, so near the toe (where the slice's chords are much
 *     steeper than the section's) the crown became a 67 degree ridge and the
 *     shoulders notched. Scaling the section as a whole keeps the tangent
 *     DIRECTION the section was drawn with at every anchor (smooth anchors stay
 *     smooth, corners such as the flat bottom's stay corners), and the eased
 *     remainder leaves it untouched at the anchors. A straight stretch stays
 *     straight, and a stretch whose section curve is degenerate falls back to
 *     the chord.
 *  3. ROUNDED NOSE. If the side view ends the toe in a wall (the dorsal's toe tip
 *     above the sole), the slices at the very tip would be a vertical sliver
 *     of that height and ~0 width: a blade, read as a "chopped-off" toe. The
 *     last `nose` mm (= the wall's height, designed) therefore shrink the
 *     ring's height about its mid-height with a half-ellipse, so the toe ends
 *     in a rounded nose (radius half the wall in side view). This is a
 *     deliberate departure from the drawn side silhouette in those last
 *     millimetres (it rounds the two corners of the wall); draw the toe tip on
 *     the sole (no wall) and it does nothing. Heel end: not rounded.
 *  4. HEEL OVERHANG. The side contour's heel counter may lean out BEHIND the
 *     sole start (negative stations: the bulge, the top of the counter). A slice
 *     plane cannot go behind the first slice, so the back of the surface would
 *     be a vertical wall at the sole start, not the contour drawn in the side
 *     view (measured on a user's model: contour 4 to 15 mm behind, surface
 *     none). `rearOverhang` shifts every vertex backwards by the contour's
 *     overhang at that height, fading to nothing towards the front, so the
 *     back of the centre plane follows the drawn counter. Models whose counter
 *     does not leave the sole start are not touched.
 *  5. HEEL POSE (optional). Slice points are mapped (y, z) -> posed with the
 *     same frame rule as the side view's upper, so the heel height lifts the
 *     surface consistently with that view.
 *
 *  6. END CAPS. The slices beyond the first full slice from each end are
 *     dropped and the heel back and the toe are built from horizontal
 *     half-rings (end-cap.ts), because the narrow lens-shaped slices there
 *     closed the heel as a pinched seam (a vertical groove down the centre) and
 *     the toe as a funnel. A cap never reaches past the end-most section's
 *     station. A blunt end keeps the old fan cap to the centroid.
 *
 * Limitations: slices are planes of constant y while sections lie on tilted
 * planes, so a section's drawn curve is reproduced at its anchors (which are
 * exactly on the rails) but its shape is applied in the slice plane, and its
 * tangent directions are scaled with the slice (x and z by different factors),
 * so they are kept as directions only up to that anisotropic scale; the
 * overhang is a shear of the rear
 * of the surface (the whole back leans the same at every x, and it is exact only
 * at the centre plane and where the counter is single-valued in height); the
 * surface is not a trimmed/cap-closed solid (heel and toe close because the
 * rails converge); no surface-quality checks; mesh only, nothing is exported.
 */
export type Vec3 = readonly [number, number, number];

export interface Loft {
  /**
   * xyz triples: `slices` rows of `ring` vertices (from the boundary slice at
   * the heel to the one at the toe), then for the heel and then for the toe
   * either the end's fan centre (`"fan"`) or the cap's inner vertices
   * (`"rings"`, see end-cap.ts: rows of CAP_ARC - 1 vertices, the row ends are
   * ring vertices).
   */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly slices: number;
  readonly ring: number;
  readonly back: "fan" | "rings";
  readonly front: "fan" | "rings";
  /** Index (among the SLICES cosine-spaced ones) of the first slice kept. */
  readonly firstSlice: number;
  /** The eight rails as polylines, heel to toe. */
  readonly rails: readonly { role: RailRole; pts: readonly Vec3[] }[];
  /** The sections where they are cut (tilted planes). */
  readonly sections: readonly { id: SectionId; pts: readonly Vec3[] }[];
}

/**
 * SLICE SPACING (decision): cosine-spaced from heel to toe, so the slices are
 * dense where the plan outline turns (heel back, toe tip) and sparse along the
 * straight middle. With even spacing the first step off the heel was ~4 mm,
 * wide enough that the back jumped from a 5 mm sliver to a 28 mm ring, which
 * read as a knife-edge crease up the back seam.
 */
const SLICES = 96,
  PER = 10; // ring vertices per stretch between anchors

const smooth = (t: number) => t * t * (3 - 2 * t);

/** x values where a polyline crosses y = const. */
export function crossings(poly: readonly Vec2[], y: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!,
      b = poly[i]!;
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
    out.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  return out;
}

/**
 * Each stretch (anchor role a to the next) of a section as PER+1 equal-arclength
 * samples of its own curve in the section frame (u across, z up), or null if
 * the stretch has no length; plus the section's width (lateral u minus medial
 * u) and height (crown z minus sole z), which scale it onto a slice. Null if
 * the section lacks one of the eight roles.
 */
function stretches(c: EditableCurve): {
  segs: (readonly Vec2[] | null)[];
  width: number;
  height: number;
} | null {
  const idx = RAIL_ROLES.map((r) => c.points.findIndex((p) => p.role === r));
  if (idx.some((i) => i < 0)) return null;
  const per = 24,
    all = sampleCurve(c, per),
    n = c.points.length,
    at = (r: RailRole) => c.points[idx[RAIL_ROLES.indexOf(r)]!]!.pos;
  const segs = RAIL_ROLES.map((_, a) => {
    const i0 = idx[a]!,
      i1 = idx[(a + 1) % RAIL_ROLES.length]!,
      q: Vec2[] = [];
    let i = i0;
    for (;;) {
      for (let k = 0; k < per; k++) q.push(all[(i * per + k) % all.length]!);
      i = (i + 1) % n;
      if (i === i1) break;
    }
    q.push(all[(i1 * per) % all.length]!);
    let len = 0;
    for (let k = 1; k < q.length; k++)
      len += Math.hypot(q[k]![0] - q[k - 1]![0], q[k]![1] - q[k - 1]![1]);
    return len < 1e-6 ? null : resample(q, PER);
  });
  return {
    segs,
    width: Math.abs(at("lateral")[0] - at("medial")[0]),
    height: at("crown")[1] - at("sole")[1],
  };
}

/**
 * Rounded cut (decision): the flat top is joined to the rounded upper by an
 * edge rounding of width `CUT_BLEND` = 8 mm (designed), not a hard `min`. A
 * hard min leaves a sharp wedge where the cut plane meets the crown at a
 * shallow angle (the "break" at the start and end of the crown) and a razor
 * edge all round the oval; a rounded edge is what a real last blank has.
 *
 * `capTo(z, plane)` is z where the surface is more than the blend below the
 * plane, the plane itself where it is above it, and in between a cubic
 * (slope 1 at the lower end, slope 0 where it reaches the plane), so the face
 * is EXACTLY the plane and the rounding lies on the wall below it. Rejected:
 * the polynomial smooth minimum used first. It lowers the result below BOTH
 * inputs near the crossing (by blend/4 = 2 mm), so where the upper grazes the
 * plane at a shallow angle (the roof behind a heel counter) the band of
 * influence is tens of mm wide and the face showed a 2 mm crater there.
 */
const CUT_BLEND = 8;
const capTo = (z: number, plane: number, k = CUT_BLEND) => {
  if (z >= plane) return plane;
  if (z <= plane - k) return z;
  const t = (z - (plane - k)) / k;
  return plane - k + k * (t + t * t - t * t * t);
};

/**
 * HEEL OVERHANG (decision, see the header): the part of the flat upper that
 * lies behind station 0, as a rear-most station per height, and a fade over
 * the stations in front of it.
 *
 *  - `at(z)`: the most negative station the counter reaches at height z (the
 *    drawn contour, flat frame), 0 above the point where the counter comes
 *    back to station 0, and 0 at the sole (the counter starts at (0, 0)).
 *  - `fade(y)`: 1 at the sole start, easing to 0 over `length` mm. DESIGNED:
 *    at least 30 mm and three times the largest overhang, so the shift never
 *    folds the slices (d(y + fade*at)/dy stays above 0.5 for a smoothstep,
 *    whose slope is at most 1.5/length).
 * Null when the counter never goes behind station 0 (nothing to do).
 */
export function rearOverhang(
  dorsal: EditableCurve,
): { at: (z: number) => number; fade: (y: number) => number } | null {
  const pts = sampleCurve(dorsal, 60),
    run: Vec2[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    run.push(pts[i]!);
    if (pts[i]![0] >= 0) break;
  }
  const deepest = Math.min(...run.map((p) => p[0]));
  if (deepest > -0.05) return null;
  const length = Math.max(30, 3 * -deepest),
    at = (z: number) => {
      let best = 0;
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1]!,
          b = run[i]!;
        if ((a[1] - z) * (b[1] - z) > 0 || a[1] === b[1]) continue;
        best = Math.min(
          best,
          a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]),
        );
      }
      return best;
    };
  return {
    at,
    fade: (y) => 1 - smooth(Math.min(1, Math.max(0, y / length))),
  };
}

export function buildLoft(
  doc: StudioDoc,
  frame: UpperFrame | null,
  opts: { topCut?: boolean } = {},
): Loft {
  const cut = opts.topCut === false ? null : cutZ(doc.cut, frame);
  const { top, dorsal, rails, sections } = doc,
    outline = sampleCurve(top, 48),
    ys = outline.map((p) => p[1]),
    y0 = Math.min(...ys) + 0.2,
    y1 = Math.max(...ys) - 0.2,
    planPoly = Object.fromEntries(
      (Object.keys(rails.plan) as (keyof typeof rails.plan)[]).map((r) => [
        r,
        sampleCurve(rails.plan[r], 32),
      ]),
    ) as Record<string, Vec2[]>,
    stations = SECTION_IDS.map((id) => {
      const g = sectionGeometry(top, dorsal, id),
        xs = g ? crossings(outline, g.station) : [];
      return {
        id,
        g,
        b: stretches(sections[id]),
        // Across-extent (x) of the outline at the section's station.
        wx: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
      };
    })
      .filter((s) => s.g && s.b)
      .sort((a, b) => a.g!.station - b.g!.station);

  const lean = rearOverhang(dorsal),
    // heel overhang (flat frame): the shear of the rear, see the header
    shear = (p0: Vec3): Vec3 =>
      lean ? [p0[0], p0[1] + lean.fade(p0[1]) * lean.at(p0[2]), p0[2]] : p0,
    // heel pose: the flat frame to the posed one
    pose = (p: Vec3): Vec3 => {
      if (!frame) return p;
      const q = flatToPosed(frame, [p[1], p[2]]);
      return [p[0], q[0], q[1]];
    },
    // the top cut, on the POSED height against the posed plane (cut.ts), so
    // the top is flat in the pose
    clip = (v: Vec3): Vec3 => (cut ? [v[0], v[1], capTo(v[2], cut(v[1]))] : v);
  // A slice vertex to its final place: overhang, pose, cut.
  const place = (p: Vec3): Vec3 => clip(pose(shear(p)));
  // A vertex that already has the overhang (the end caps'): pose, cut.
  const placeSheared = (p: Vec3): Vec3 => clip(pose(p));

  const anchorAt = (role: RailRole, y: number, xs: number[]): Vec3 => {
    const lo = Math.min(...xs),
      hi = Math.max(...xs);
    switch (role) {
      // Sole and crown lie in the centre plane x = 0 where the outline reaches
      // it; past that (the toe tip is off-centre) they stay on the nearest
      // outline edge, so the ring closes instead of turning inside out.
      case "sole":
        return [Math.min(hi, Math.max(lo, 0)), y, 0];
      case "crown":
        return [
          Math.min(hi, Math.max(lo, 0)),
          y,
          heightAtStation(dorsal, y) ?? 0,
        ];
      case "lateral":
        return [hi, y, heightAtStation(rails.elev.lateral, y) ?? 0];
      case "medial":
        return [lo, y, heightAtStation(rails.elev.medial, y) ?? 0];
      default: {
        const c = crossings(planPoly[role]!, y),
          want = role.startsWith("medial") ? lo : hi,
          x = c.length
            ? c.reduce((a, b) =>
                Math.abs(b - want) < Math.abs(a - want) ? b : a,
              )
            : want * 0.9;
        // CLAMP (decision): a derived rail never leaves the outline. Their plan
        // curves are free Beziers that start at the heel back / end at the toe
        // tip with their own tangents, so within the first millimetres a
        // shoulder rail could lie OUTSIDE the lateral rail (the outline) and the
        // ring folded into a creased strip at the heel back.
        const inside = role.startsWith("medial")
          ? Math.max(x, lo)
          : Math.min(x, hi);
        return [inside, y, heightAtStation(rails.elev[role], y) ?? 0];
      }
    }
  };

  const iSole = RAIL_ROLES.indexOf("sole"),
    iCrown = RAIL_ROLES.indexOf("crown"),
    iLat = RAIL_ROLES.indexOf("lateral"),
    iMed = RAIL_ROLES.indexOf("medial"),
    // ROUNDED NOSE (header, step 3): length = the toe wall's height.
    nose = Math.max(0, heightAtStation(dorsal, y1) ?? 0),
    noseK = (y: number) => {
      const u = (y - (y1 - nose)) / nose;
      return nose < 0.5 || u <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - u * u));
    };
  const flatRings: Vec3[][] = [],
    railLines: Vec3[][] = RAIL_ROLES.map(() => []),
    sliceY: number[] = [];
  for (let k = 0; k < SLICES; k++) {
    const y =
        y0 + ((y1 - y0) * (1 - Math.cos((Math.PI * k) / (SLICES - 1)))) / 2,
      xs = crossings(outline, y),
      A0 = RAIL_ROLES.map((r) => anchorAt(r, y, xs.length ? xs : [0])),
      e = noseK(y),
      zMid = (A0[iSole]![2] + A0[iCrown]![2]) / 2,
      A = A0.map((a): Vec3 => [a[0], a[1], zMid + (a[2] - zMid) * e]);
    sliceY.push(y);
    const flatRing: Vec3[] = [];
    flatRings.push(flatRing);
    A.forEach((a, i) => {
      // the drawn rail follows the (rounded) cut, like the surface does
      railLines[i]!.push(place(a));
    });
    // Blend the neighbouring sections' curves at this y.
    let lo = -1;
    for (let i = 0; i < stations.length; i++)
      if (stations[i]!.g!.station <= y) lo = i;
    const pairs: { s: (typeof stations)[number]; w: number }[] =
      stations.length === 0
        ? []
        : lo < 0
          ? [{ s: stations[0]!, w: 1 }]
          : lo >= stations.length - 1
            ? [{ s: stations[stations.length - 1]!, w: 1 }]
            : (() => {
                const a = stations[lo]!,
                  b = stations[lo + 1]!,
                  t = smooth(
                    (y - a.g!.station) / (b.g!.station - a.g!.station),
                  );
                return [
                  { s: a, w: 1 - t },
                  { s: b, w: t },
                ];
              })();
    // Scale of each section onto this slice (see the header, step 2): across by
    // the slice's width over the section's, up by its height over the
    // section's. At the heel and the toe the slice's width goes to nothing, so
    // the ring closes onto the back seam line / a line instead of opening a slit.
    const widthHere = A[iLat]![0] - A[iMed]![0],
      heightHere = A[iCrown]![2] - A[iSole]![2],
      scales = pairs.map(({ s: st }) => ({
        sx: st.b!.width > 1e-6 ? Math.max(0, widthHere) / st.b!.width : 1,
        sz: st.b!.height > 1e-6 ? heightHere / st.b!.height : 1,
      }));
    for (let a = 0; a < RAIL_ROLES.length; a++) {
      const P = A[a]!,
        Q = A[(a + 1) % RAIL_ROLES.length]!,
        // Dx/Dz[f]: the blended, scaled section curve from P, f = 0..PER
        Dx: number[] = new Array<number>(PER + 1).fill(0),
        Dz: number[] = new Array<number>(PER + 1).fill(0);
      pairs.forEach(({ s: st, w }, pi) => {
        const seg = st.b!.segs[a],
          { sx, sz } = scales[pi]!;
        for (let f = 0; f <= PER; f++) {
          if (seg) {
            Dx[f] = Dx[f]! + w * sx * (seg[f]![0] - seg[0]![0]);
            Dz[f] = Dz[f]! + w * sz * (seg[f]![1] - seg[0]![1]);
          } else {
            Dx[f] = Dx[f]! + (w * f * (Q[0] - P[0])) / PER;
            Dz[f] = Dz[f]! + (w * f * (Q[2] - P[2])) / PER;
          }
        }
      });
      const noPairs = pairs.length === 0,
        rest = [Q[0] - P[0] - Dx[PER]!, Q[2] - P[2] - Dz[PER]!];
      for (let f = 0; f < PER; f++) {
        const t = f / PER,
          ease = noPairs ? t : smooth(t),
          x =
            P[0] +
            (noPairs ? 0 : Dx[f]!) +
            ease * (noPairs ? Q[0] - P[0] : rest[0]!),
          z =
            P[2] +
            (noPairs ? 0 : Dz[f]!) +
            ease * (noPairs ? Q[2] - P[2] : rest[1]!);
        flatRing.push([x, y, z]);
      }
    }
  }

  const ring = RAIL_ROLES.length * PER,
    widthAt = (y: number) => {
      const xs = crossings(outline, y);
      return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    },
    indices: number[] = [];

  // END CAPS (header, step 6). A cap needs its boundary ring (the first full
  // slice from the end) with the overhang applied, paired up the two sides:
  // pair j is vertex j going up from the sole on the lateral side (increasing
  // ring index, through the lateral rail) and on the medial side (decreasing).
  const iS = iSole * PER,
    half = ((iCrown - iSole + RAIL_ROLES.length) % RAIL_ROLES.length) * PER,
    capFor = (end: End, k: number | null) => {
      if (k === null) return null;
      const bd = flatRings[k]!.map(shear),
        at = (j: number) => bd[(((iS + j) % ring) + ring) % ring]!;
      return capRows(
        Array.from({ length: half + 1 }, (_, j) => at(j)),
        Array.from({ length: half + 1 }, (_, j) => at(-j)),
        outline,
        dorsal,
        sliceY[k]!,
        end,
      );
    },
    kRear = boundarySlice(
      sliceY,
      widthAt,
      "rear",
      stations[0]?.g!.station ?? Infinity,
    );
  // the boundary at the toe must lie where the nose squeeze has not started
  let kFront = boundarySlice(
    sliceY,
    widthAt,
    "front",
    stations[stations.length - 1]?.g!.station ?? -Infinity,
  );
  while (kFront !== null && kFront > 0 && sliceY[kFront]! > y1 - nose) kFront--;
  const rear = capFor("rear", kRear),
    front = capFor("front", kFront),
    first = rear ? kRear! : 0,
    last = front ? kFront! : SLICES - 1,
    kept = last - first + 1;

  const positions: number[] = [];
  for (let k = first; k <= last; k++)
    for (const p of flatRings[k]!) {
      const v = place(p);
      positions.push(v[0], v[1], v[2]);
    }
  for (let k = 0; k < kept - 1; k++)
    for (let j = 0; j < ring; j++) {
      const a = k * ring + j,
        b = k * ring + ((j + 1) % ring),
        c = (k + 1) * ring + j,
        d = (k + 1) * ring + ((j + 1) % ring);
      indices.push(a, b, c, b, d, c);
    }
  // FAN (decision): an end ring without a cap is not a point (the outline is
  // blunt there, and 0.2 mm inside it the ring is a thin vertical sliver), so
  // it is closed with a triangle fan to its centroid; without it the end is an
  // open slit. The centroid vertex is appended after the ring vertices.
  const fan = (slice: number) => {
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let j = 0; j < ring; j++) {
      const i = (slice * ring + j) * 3;
      cx += positions[i]!;
      cy += positions[i + 1]!;
      cz += positions[i + 2]!;
    }
    const vi = positions.length / 3;
    positions.push(cx / ring, cy / ring, cz / ring);
    for (let j = 0; j < ring; j++) {
      const a = slice * ring + j,
        b = slice * ring + ((j + 1) % ring);
      indices.push(vi, a, b);
    }
  };
  // CAP: the inner vertices of the rows, then their quads. The row ends are
  // the boundary ring's own vertices. `flip` turns the winding: the toe cap is
  // the mirror image of the heel cap.
  const cap = (
    rows: NonNullable<typeof rear>,
    slice: number,
    flip: boolean,
  ) => {
    const base = positions.length / 3,
      inner = CAP_ARC - 1,
      at = (j: number, m0: number) => {
        // at the sole and at the crown the two boundary ends are one vertex, so
        // the row runs out to the end point and back along the same line: its
        // mirrored vertices are one vertex (else the seam stays open)
        const m = j === 0 || j === half ? Math.min(m0, CAP_ARC - m0) : m0;
        return m === 0
          ? slice * ring + ((iS + j) % ring)
          : m === CAP_ARC
            ? slice * ring + ((((iS - j) % ring) + ring) % ring)
            : base + j * inner + (m - 1);
      };
    for (const row of rows)
      for (let m = 1; m < CAP_ARC; m++) {
        const v = placeSheared(row[m]!);
        positions.push(v[0], v[1], v[2]);
      }
    for (let j = 0; j < half; j++)
      for (let m = 0; m < CAP_ARC; m++) {
        const a = at(j, m),
          b = at(j, m + 1),
          c = at(j + 1, m),
          d = at(j + 1, m + 1);
        // a row's two ends coincide at the sole and the crown: skip the
        // triangles that collapse to an edge
        for (const t of flip
          ? ([
              [a, c, b],
              [b, c, d],
            ] as const)
          : ([
              [a, b, c],
              [b, d, c],
            ] as const))
          if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2])
            indices.push(t[0], t[1], t[2]);
      }
  };
  if (rear) cap(rear, 0, false);
  else fan(0);
  if (front) cap(front, kept - 1, true);
  else fan(kept - 1);

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    slices: kept,
    ring,
    back: rear ? "rings" : "fan",
    front: front ? "rings" : "fan",
    firstSlice: first,
    rails: RAIL_ROLES.map((role, i) => ({ role, pts: railLines[i]! })),
    sections: stations.map(({ id, g }) => ({
      id,
      pts: sampleCurve(sections[id], 16).map((p): Vec3 => {
        const t = p[0] / g!.width,
          y = g!.medial[1] + t * (g!.lateral[1] - g!.medial[1]);
        return place([
          g!.medial[0] + t * (g!.lateral[0] - g!.medial[0]),
          y,
          p[1],
        ]);
      }),
    })),
  };
}
