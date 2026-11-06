import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moveAnchor, sampleCurve } from "~/lib/curves";
import {
  defaultDoc,
  parseDoc,
  reconcileDoc,
  upgradeDoc,
  withParams,
} from "~/lib/studio/document";
import { upperFrame } from "~/lib/studio/contour";
import { buildLoft, rearOverhang } from "~/lib/studio/loft";
import { cutZ } from "~/lib/studio/cut";
import {
  DEFAULT_SIDE_PARAMS,
  sideContext,
  validContext,
} from "~/lib/studio/side";

/**
 * Edges of the triangle mesh that are not used exactly once in each direction:
 * 0 means the surface is closed and consistently wound (no slit, no flipped
 * triangle). Row ends of both end caps are part of the test.
 */
function unmatchedEdges(L: { indices: Uint32Array }): number {
  const e = new Map<string, number>();
  for (let i = 0; i < L.indices.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const key = `${L.indices[i + k]}-${L.indices[i + ((k + 1) % 3)]}`;
      e.set(key, (e.get(key) ?? 0) + 1);
    }
  let bad = 0;
  for (const [key, c] of e) {
    const [a, b] = key.split("-");
    if (c !== 1 || e.get(`${b}-${a}`) !== 1) bad++;
  }
  return bad;
}

/**
 * Angles (degrees) between the normals of neighbouring triangles, for the
 * edges whose midpoint passes `where`. Triangles under 0.1 mm2 (slivers, e.g. the zero-thickness one between the crown row and its neighbour) have no usable
 * normal and are skipped.
 */
function creases(
  L: { positions: Float32Array; indices: Uint32Array },
  where: (mid: readonly number[]) => boolean,
): { angle: number; at: number[] }[] {
  const P = (i: number) => [
      L.positions[i * 3]!,
      L.positions[i * 3 + 1]!,
      L.positions[i * 3 + 2]!,
    ],
    nrm: (number[] | null)[] = [],
    edge = new Map<string, number[]>();
  for (let t = 0; t < L.indices.length / 3; t++) {
    const v = [L.indices[t * 3]!, L.indices[t * 3 + 1]!, L.indices[t * 3 + 2]!],
      [A, B, C] = v.map(P) as [number[], number[], number[]],
      u = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!],
      w = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!],
      n = [
        u[1]! * w[2]! - u[2]! * w[1]!,
        u[2]! * w[0]! - u[0]! * w[2]!,
        u[0]! * w[1]! - u[1]! * w[0]!,
      ],
      l = Math.hypot(n[0]!, n[1]!, n[2]!);
    nrm.push(l < 0.2 ? null : n.map((x) => x / l));
    for (let k = 0; k < 3; k++) {
      const p = v[k]!,
        q = v[(k + 1) % 3]!,
        key = p < q ? `${p}-${q}` : `${q}-${p}`;
      (edge.get(key) ?? edge.set(key, []).get(key)!).push(t);
    }
  }
  const out: { angle: number; at: number[] }[] = [];
  for (const [key, ts] of edge) {
    if (ts.length !== 2) continue;
    const a = nrm[ts[0]!],
      b = nrm[ts[1]!];
    if (!a || !b) continue;
    const [p, q] = key.split("-").map(Number) as [number, number],
      mid = [0, 1, 2].map((i) => (P(p)[i]! + P(q)[i]!) / 2);
    if (!where(mid)) continue;
    const dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    out.push({
      angle: (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI,
      at: mid,
    });
  }
  return out;
}

describe("loft", () => {
  const d = defaultDoc(),
    L = buildLoft(d, null);
  it("is a closed ring mesh with finite coordinates", () => {
    expect([...L.positions].every(Number.isFinite)).toBe(true);
    expect(unmatchedEdges(L)).toBe(0);
  });
  it("keeps the bottom flat behind the ball: the stretches around the sole stay at z = 0", () => {
    const per = L.ring / 8;
    for (let k = 1; k < L.slices - 1; k++)
      // Only up to the ball (y 175 of the default model): the bottom rails rise
      // from there to the single toe tip point at half the wall height
      // (rails.ts TOE_FRACTION), which lifts the sole a little ahead of the ball.
      for (const stretch of L.positions[k * L.ring * 3 + 1]! > 175
        ? []
        : [7, 0])
        for (let f = 0; f < per; f++) {
          const j = stretch * per + f;
          expect(Math.abs(L.positions[(k * L.ring + j) * 3 + 2]!)).toBeLessThan(
            1e-4,
          );
        }
  });
  it("rails pass through the section anchors", () => {
    const rail = L.rails.find((r) => r.role === "lateral_bottom")!,
      ball = d.sections.ball.points.find((p) => p.role === "lateral_bottom")!,
      ring = L.sections.find((s) => s.id === "ball")!;
    // the section ring contains its own anchor
    const hit = ring.pts.some(
      (p) => Math.abs(p[2] - ball.pos[1]) < 1e-6 && p[2] < 1,
    );
    expect(hit).toBe(true);
    // the rails run the whole length, also through the heel cap's region
    expect(rail.pts.length).toBeGreaterThanOrEqual(L.slices);
  });
  it("heel pose lifts the heel end of the surface", () => {
    const ctx = validContext(
      sideContext(d.top, { ...DEFAULT_SIDE_PARAMS, heelHeight: 40 }),
    )!;
    const up = buildLoft(d, upperFrame(ctx)),
      zmax = (l: typeof L) =>
        Math.max(...l.positions.filter((_, i) => i % 3 === 2));
    expect(zmax(up)).toBeGreaterThan(zmax(L) + 5);
  });
  it("closes onto a seam at the heel and a line at the toe (no slit)", () => {
    const outline = sampleCurve(d.top, 200);
    for (const k of [0, L.slices - 1]) {
      const xs = Array.from(
        { length: L.ring },
        (_, j) => L.positions[(k * L.ring + j) * 3]!,
      );
      const y = L.positions[k * L.ring * 3 + 1]!,
        cross: number[] = [];
      for (let i = 1; i < outline.length; i++) {
        const a = outline[i - 1]!,
          b = outline[i]!;
        if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1])
          cross.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      const width = Math.max(...cross) - Math.min(...cross);
      // the ring is no wider than the outline itself: nothing bulges open
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(width + 1);
    }
  });
  it("cuts everything above the plane away, front to back", () => {
    const cut = cutZ(d.cut, null),
      tops = (l: typeof L) =>
        Array.from({ length: l.slices }, (_, k) => ({
          y: l.positions[k * l.ring * 3 + 1]!,
          top: Math.max(
            ...Array.from(
              { length: l.ring },
              (_, j) => l.positions[(k * l.ring + j) * 3 + 2]!,
            ),
          ),
        }));
    for (const { y, top } of tops(L)) expect(top).toBeLessThan(cut(y) + 1e-3);
    // and the cut really removes something: switched off, the top is higher
    const open = tops(buildLoft(d, null, { topCut: false })),
      cutRows = tops(L);
    expect(open.some((r, i) => r.top > cutRows[i]!.top + 1)).toBe(true);
  });

  // The top is a PLANE in the pose, not the flat plane bent by the pose map.
  it("keeps the top flat once the heel is raised: nothing above the posed plane, and a face on it", () => {
    for (const heel of [8, 40, 80]) {
      const dd = withParams(d, { heelHeight: heel, seatOffsetDeg: 0 }),
        frame = upperFrame(validContext(sideContext(dd.top, dd.params))!),
        P = buildLoft(dd, frame),
        z = cutZ(dd.cut, frame);
      let touching = 0;
      for (let i = 0; i < P.positions.length / 3; i++) {
        const y = P.positions[i * 3 + 1]!,
          h = P.positions[i * 3 + 2]!;
        expect(h).toBeLessThan(z(y) + 1e-3);
        if (h > z(y) - 0.5) touching++;
      }
      expect(touching).toBeGreaterThan(20);
    }
  });

  it("leaves no ridge in front of the flat face: the top height changes smoothly", () => {
    // the highest point of each slice along the last has no jump bigger than the
    // slope of the plane plus a few mm per slice (the old release ramp made a step)
    const dd = withParams(d, { heelHeight: 40, seatOffsetDeg: 0 }),
      frame = upperFrame(validContext(sideContext(dd.top, dd.params))!),
      P = buildLoft(dd, frame);
    let prev = NaN;
    for (let k = 0; k < P.slices; k++) {
      let top = -1e9;
      for (let j = 0; j < P.ring; j++)
        top = Math.max(top, P.positions[(k * P.ring + j) * 3 + 2]!);
      if (!Number.isNaN(prev)) expect(Math.abs(top - prev)).toBeLessThan(6);
      prev = top;
    }
  });

  it("lifts the cut with the foot when the heel rises", () => {
    const at = (heel: number) => {
      const dd = withParams(d, { heelHeight: heel, seatOffsetDeg: 0 });
      return cutZ(
        dd.cut,
        upperFrame(validContext(sideContext(dd.top, dd.params))!),
      )(20);
    };
    expect(at(80)).toBeGreaterThan(at(8) + 40);
  });

  it("ends every rail in ONE point at the toe tip", () => {
    const tip = (curve: { points: readonly { pos: readonly number[] }[] }) =>
        curve.points[curve.points.length - 1]!.pos,
      z0 = tip(d.rails.elev.lateral)[1]!,
      xy = tip(d.rails.plan.lateral_bottom);
    for (const c of Object.values(d.rails.elev))
      expect(tip(c)[1]).toBeCloseTo(z0, 6);
    for (const c of Object.values(d.rails.plan)) {
      expect(tip(c)[0]).toBeCloseTo(xy[0]!, 6);
      expect(tip(c)[1]).toBeCloseTo(xy[1]!, 6);
    }
    expect(z0).toBeGreaterThan(0);
  });
  it("keeps the shoulder and bottom rails inside the outline at every slice (debug/heel-strip.json had a shoulder 1.7 mm outside it at the heel back)", () => {
    const fx = reconcileDoc(
        upgradeDoc(parseDoc(readFileSync("debug/heel-strip.json", "utf8"))),
      ),
      L = buildLoft(fx, null),
      per = L.ring / 8,
      at = (k: number, stretch: number) =>
        L.positions[(k * L.ring + stretch * per) * 3]!;
    // ring order: sole, lat_bottom, lateral, lat_shoulder, crown, med_shoulder, medial, med_bottom
    for (let k = 0; k < L.slices; k++) {
      expect(at(k, 1)).toBeLessThanOrEqual(at(k, 2) + 1e-6);
      expect(at(k, 3)).toBeLessThanOrEqual(at(k, 2) + 1e-6);
      expect(at(k, 5)).toBeGreaterThanOrEqual(at(k, 6) - 1e-6);
      expect(at(k, 7)).toBeGreaterThanOrEqual(at(k, 6) - 1e-6);
    }
  });

  // debug/heel-contour.json: the side contour's heel counter leans out behind
  // the sole start (4 to 5 mm at the bulge, 15 mm at cut_rear) but the surface
  // used to end in a vertical wall at the sole start.
  it("follows the heel counter that leans out behind the sole start", () => {
    const fx = reconcileDoc(
        upgradeDoc(parseDoc(readFileSync("debug/heel-contour.json", "utf8"))),
      ),
      H = buildLoft(fx, null),
      curve = sampleCurve(fx.dorsal, 60);
    for (const z0 of [10, 30, 50, 70, 90, 105]) {
      // rear-most station of the drawn counter and of the surface, per band
      const band = (z: number) => z >= z0 && z < z0 + 10,
        want = Math.min(...curve.filter((p) => band(p[1])).map((p) => p[0]));
      let got = Infinity;
      for (let i = 0; i < H.positions.length / 3; i++)
        if (band(H.positions[i * 3 + 2]!))
          got = Math.min(got, H.positions[i * 3 + 1]!);
      expect(Math.abs(got - want)).toBeLessThan(1.5);
    }
  });
  // A folded patch (a region of the surface turned over on itself) shows as
  // neighbouring triangles whose normals are nearly opposite. Found once in the
  // heel cap: rows at the sole (z = 0 plus or minus rounding) got no depth and
  // collapsed onto the boundary. The flat bottom's corners are about 90
  // degrees, so 120 leaves a margin and still catches every fold.
  it("has no folded-over triangles, flat or posed, with and without the cut", () => {
    const live = reconcileDoc(
      upgradeDoc(parseDoc(readFileSync("debug/model-live.json", "utf8"))),
    );
    for (const [name, doc] of [
      ["default", d],
      ["debug/model-live.json", live],
    ] as const) {
      const ctx = validContext(sideContext(doc.top, doc.params))!;
      for (const [how, frame, topCut] of [
        ["flat", null, false],
        ["flat, cut", null, true],
        ["posed, cut", upperFrame(ctx), true],
      ] as const) {
        const w = creases(buildLoft(doc, frame, { topCut }), () => true).sort(
          (a, b) => b.angle - a.angle,
        )[0];
        expect(
          w ? w.angle : 0,
          `${name} ${how}: ${JSON.stringify(w)}`,
        ).toBeLessThan(120);
      }
    }
  });
  // User report: a vertical groove down the centre of the heel back (the lens
  // shaped first slices pinched the back into a fin). At every height the rear
  // outline of the surface must be one convex arc: its rear-most point at the
  // centre, then moving forward with distance from the centre.
  it("builds the heel back as a round wall, with no groove down its centre", () => {
    for (const [name, doc] of [
      ["default", d],
      [
        "debug/heel-contour.json",
        reconcileDoc(
          upgradeDoc(parseDoc(readFileSync("debug/heel-contour.json", "utf8"))),
        ),
      ],
    ] as const) {
      const H = buildLoft(doc, null, { topCut: false });
      expect(H.back, name).toBe("rings");
      for (const z0 of [10, 30, 50, 70, 90]) {
        // rear-most y per 3 mm column across, on each side of the centre
        for (const side of [1, -1]) {
          const col = new Map<number, number>();
          for (let i = 0; i < H.positions.length / 3; i++) {
            const x = H.positions[i * 3]! * side,
              y = H.positions[i * 3 + 1]!,
              z = H.positions[i * 3 + 2]!;
            if (Math.abs(z - z0) > 2 || x < 0 || y > 60) continue;
            const c = Math.floor(x / 3);
            col.set(c, Math.min(col.get(c) ?? Infinity, y));
          }
          const cols = [...col.keys()].sort((a, b) => a - b).slice(0, 6);
          for (let i = 1; i < cols.length; i++)
            expect(
              col.get(cols[i]!)! - col.get(cols[i - 1]!)!,
              `${name} z ${z0} side ${side} column ${cols[i]}`,
            ).toBeGreaterThan(-0.75);
        }
      }
    }
  });
  it("shifts the default heel only by its 3 mm bulge, and a counter that stays in front not at all", () => {
    const o = rearOverhang(d.dorsal)!;
    expect(o.at(0.17 * 297)).toBeGreaterThan(-3.6);
    expect(o.at(0.17 * 297)).toBeLessThan(-1);
    const bulge = d.dorsal.points.findIndex((p) => p.role === "heel_bulge"),
      inside = moveAnchor(d.dorsal, bulge, [4, d.dorsal.points[bulge]!.pos[1]]);
    expect(rearOverhang(inside)).toBeNull();
  });

  // Regression for the toe of debug/toe-chopped.json: a model whose side view
  // ends the toe in an 8 mm wall had (1) a 67 degree ridge along the crown and
  // notches at the shoulders of the toe rings (section tangents rotated with
  // the chords), (2) a vertical blade at the tip and (3), with the slices all
  // the way to the tip, a pinched funnel (the last slices were narrow lenses).
  // The toe is now a cap of horizontal rings (end-cap.ts).
  describe("toe of a model with a toe wall", () => {
    const fx = reconcileDoc(
        upgradeDoc(parseDoc(readFileSync("debug/toe-chopped.json", "utf8"))),
      ),
      ctx = validContext(sideContext(fx.top, fx.params))!,
      T = buildLoft(fx, upperFrame(ctx)),
      TU = buildLoft(fx, upperFrame(ctx), { topCut: false }),
      F = buildLoft(fx, null, { topCut: false });
    it("is a cap of horizontal rings, closed with the slices", () => {
      expect(F.front).toBe("rings");
      expect(unmatchedEdges(F)).toBe(0);
      expect(unmatchedEdges(T)).toBe(0);
    });
    it("has no crease on the toe above the sole's corner", () => {
      // the sole's edge is a corner by design (the flat bottom), and the last
      // 10 mm carry the corner of the drawn toe tip; everything else must be
      // smooth: no crown ridge, no notch at the shoulders
      for (const L of [F, TU]) {
        const c = creases(
          L,
          (p) => p[1]! > 235 && p[1]! < 285 && p[2]! > 3 + (L === TU ? 20 : 0),
        );
        const w = c.sort((a, b) => b.angle - a.angle)[0];
        expect(w ? w.angle : 0, JSON.stringify(w)).toBeLessThan(30);
      }
    });
    it("closes the toe in a rounded nose, not a blade", () => {
      // a blade is tall and has no width: 3 mm behind the tip the surface must
      // be at least 6 mm wide (the plan outline's own end arc)
      let tip = -Infinity;
      for (let i = 0; i < F.positions.length; i += 3)
        tip = Math.max(tip, F.positions[i + 1]!);
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < F.positions.length; i += 3)
        if (Math.abs(F.positions[i + 1]! - (tip - 3)) < 1) {
          lo = Math.min(lo, F.positions[i]!);
          hi = Math.max(hi, F.positions[i]!);
        }
      expect(hi - lo).toBeGreaterThan(6);
    });
  });
});
