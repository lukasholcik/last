import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { sampleCurve } from "~/lib/curves";
import { parseDoc, reconcileDoc, upgradeDoc } from "~/lib/studio/document";
import { upperFrame, upperToPosed } from "~/lib/studio/contour";
import { buildLoft } from "~/lib/studio/loft";
import { sideContext, validContext } from "~/lib/studio/side";

// Probe: does the heel back of the 3D surface follow the side contour's heel curve?
// STUDIO_DOC=debug/x.json pnpm exec vitest run tests-ts/debug/heelmatch.test.ts --silent=false
const file = process.env.STUDIO_DOC;
describe.skipIf(!file)("heel match", () => {
  it("prints", () => {
    const d = reconcileDoc(upgradeDoc(parseDoc(readFileSync(file!, "utf8")))),
      ctx = validContext(sideContext(d.top, d.params))!,
      f = upperFrame(ctx);
    for (const [name, frame] of [
      ["posed", f],
      ["flat", null],
    ] as const) {
      const pts = frame
        ? sampleCurve(upperToPosed(frame, d.dorsal), 40)
        : sampleCurve(d.dorsal, 40);
      const L = buildLoft(d, frame);
      // rear-most y of the surface and of the contour, per height band
      console.log(
        name,
        "height band: contour rear y | surface rear y (centre plane |x|<3 / any x)",
      );
      for (let z = 0; z <= 200; z += 20) {
        const inBand = (zz: number) => zz >= z && zz < z + 20;
        const c = pts.filter((p) => inBand(p[1])).map((p) => p[0]);
        let sc = Infinity,
          sa = Infinity;
        for (let i = 0; i < L.positions.length / 3; i++) {
          const x = L.positions[i * 3]!,
            y = L.positions[i * 3 + 1]!,
            zz = L.positions[i * 3 + 2]!;
          if (!inBand(zz)) continue;
          sa = Math.min(sa, y);
          if (Math.abs(x) < 3) sc = Math.min(sc, y);
        }
        const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "  - ");
        console.log(
          ` z ${String(z).padStart(3)}-${z + 20}: ${f1(c.length ? Math.min(...c) : Infinity).padStart(7)} | ${f1(sc).padStart(7)} / ${f1(sa).padStart(7)}`,
        );
      }
    }
  });
});
