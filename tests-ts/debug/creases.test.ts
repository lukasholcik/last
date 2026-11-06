import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseDoc, reconcileDoc, upgradeDoc } from "~/lib/studio/document";
import { upperFrame } from "~/lib/studio/contour";
import { buildLoft } from "~/lib/studio/loft";
import { sideContext, validContext } from "~/lib/studio/side";

// Probe: where are the sharpest creases (angle between neighbouring triangle
// normals) of the lofted surface? STUDIO_DOC=debug/x.json pnpm exec vitest run tests-ts/debug/creases.test.ts --silent=false
const file = process.env.STUDIO_DOC;
describe.skipIf(!file)("creases", () => {
  it("prints", () => {
    const d = reconcileDoc(upgradeDoc(parseDoc(readFileSync(file!, "utf8")))),
      ctx = validContext(sideContext(d.top, d.params))!;
    for (const [name, frame, topCut] of [
      ["flat, no cut", null, false],
      ["flat, cut", null, true],
      ["posed, cut", upperFrame(ctx), true],
    ] as const) {
      const L = buildLoft(d, frame, { topCut }),
        P = (i: number) => [L.positions[i * 3]!, L.positions[i * 3 + 1]!, L.positions[i * 3 + 2]!] as const,
        nT = L.indices.length / 3,
        N: number[][] = [], areas: number[] = [],
        edge = new Map<string, number[]>();
      for (let t = 0; t < nT; t++) {
        const [a, b, c] = [L.indices[t * 3]!, L.indices[t * 3 + 1]!, L.indices[t * 3 + 2]!],
          A = P(a), B = P(b), C = P(c),
          u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]],
          n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!],
          l = Math.hypot(...n);
        N.push(l < 0.2 ? [0, 0, 0] : n.map((x) => x / l)); // area < 0.1 mm2: degenerate, no normal
        areas.push(l / 2);
        for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
          const k = p < q ? `${p}-${q}` : `${q}-${p}`;
          (edge.get(k) ?? edge.set(k, []).get(k)!).push(t);
        }
      }
      const hits: { ang: number; at: number[]; tri?: never }[] = [];
      for (const [k, ts] of edge) {
        if (ts.length !== 2) continue;
        const n0 = N[ts[0]!]!, n1 = N[ts[1]!]!;
        if (!n0[0] && !n0[1] && !n0[2]) continue;
        if (!n1[0] && !n1[1] && !n1[2]) continue;
        const ang = (Math.acos(Math.max(-1, Math.min(1, n0[0]! * n1[0]! + n0[1]! * n1[1]! + n0[2]! * n1[2]!))) * 180) / Math.PI;
        const [p, q] = k.split("-").map(Number) as [number, number];
        const a = P(p), b = P(q);
        if (ang > 20) hits.push({ ang, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], tri: [P(L.indices[ts[0]! * 3]!), P(L.indices[ts[0]! * 3 + 1]!), P(L.indices[ts[0]! * 3 + 2]!), areas[ts[0]!]!, areas[ts[1]!]!] as never });
      }
      hits.sort((a, b) => b.ang - a.ang);
      console.log(name, "edges > 20 deg:", hits.length);
      if (name === "flat, no cut") for (const h of hits.slice(0, 40).filter((h) => h.at[1]! < 25 && h.at[2]! < 1 && h.ang > 170)) console.log("   worst", h.ang.toFixed(0), JSON.stringify(h.tri));
      // cluster by 20 mm cells in y,z
      const cells = new Map<string, { n: number; max: number; at: number[] }>();
      for (const h of hits) {
        const key = `y${Math.round(h.at[1]! / 20) * 20} z${Math.round(h.at[2]! / 20) * 20}`;
        const c = cells.get(key) ?? { n: 0, max: 0, at: h.at };
        c.n++; if (h.ang > c.max) { c.max = h.ang; c.at = h.at; }
        cells.set(key, c);
      }
      for (const [k, c] of [...cells].sort((a, b) => b[1].max - a[1].max).slice(0, 12))
        console.log("   ", k, "n", c.n, "max", c.max.toFixed(0), "deg at x", c.at[0]!.toFixed(0), "y", c.at[1]!.toFixed(0), "z", c.at[2]!.toFixed(0));
    }
  });
});
