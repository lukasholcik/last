import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseDoc, reconcileDoc, upgradeDoc } from "~/lib/studio/document";
import { upperFrame } from "~/lib/studio/contour";
import { buildLoft } from "~/lib/studio/loft";
import { sideContext, validContext } from "~/lib/studio/side";

// Probe: where do the eight rails start and end (unposed and posed)?
// STUDIO_DOC=debug/x.json pnpm exec vitest run tests-ts/debug/ends.test.ts --silent=false
const file = process.env.STUDIO_DOC;
describe.skipIf(!file)("rail ends", () => {
  it("prints", () => {
    const d = reconcileDoc(upgradeDoc(parseDoc(readFileSync(file!, "utf8")))),
      ctx = validContext(sideContext(d.top, d.params))!;
    for (const [name, L] of [
      ["flat", buildLoft(d, null)],
      ["posed", buildLoft(d, upperFrame(ctx))],
    ] as const) {
      console.log(name);
      for (const r of L.rails) {
        const f = (p: readonly number[]) =>
          p.map((v) => v.toFixed(1)).join(", ");
        console.log(
          r.role.padEnd(18),
          "heel",
          f(r.pts[0]!),
          "| toe",
          f(r.pts[r.pts.length - 1]!),
        );
      }
    }
  });
});
