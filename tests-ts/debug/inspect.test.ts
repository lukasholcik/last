import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseDoc, reconcileDoc, upgradeDoc } from "~/lib/studio/document";
import { upperFrame } from "~/lib/studio/contour";
import { sideContext, validContext } from "~/lib/studio/side";
import { buildLoft } from "~/lib/studio/loft";

/**
 * Headless inspection of a saved model (see docs/debugging.md). Not a test: it
 * only runs when STUDIO_DOC names a document JSON (a file saved from the app,
 * e.g. debug/toe-chopped.json) and prints, per slice, the numbers that show
 * where the surface goes wrong. `STUDIO_FROM` / `STUDIO_TO` (fractions of the
 * length, default 0.85..1) pick the stretch printed.
 *   STUDIO_DOC=debug/x.json pnpm exec vitest run tests-ts/debug/inspect.test.ts
 */
const file = process.env.STUDIO_DOC;
describe.skipIf(!file)("inspect model", () => {
  it("prints the slices", () => {
    const doc = reconcileDoc(upgradeDoc(parseDoc(readFileSync(file!, "utf8")))),
      ctx = validContext(sideContext(doc.top, doc.params)),
      frame = ctx ? upperFrame(ctx) : null,
      loft = buildLoft(doc, frame),
      from = Number(process.env.STUDIO_FROM ?? 0.85),
      to = Number(process.env.STUDIO_TO ?? 1),
      p = loft.positions,
      rows: string[] = [];
    for (let s = 0; s < loft.slices; s++) {
      if (s / (loft.slices - 1) < from || s / (loft.slices - 1) > to) continue;
      let zMax = -1e9,
        zMin = 1e9,
        xMin = 1e9,
        xMax = -1e9,
        y = 0;
      for (let k = 0; k < loft.ring; k++) {
        const i = (s * loft.ring + k) * 3;
        xMin = Math.min(xMin, p[i]!);
        xMax = Math.max(xMax, p[i]!);
        zMax = Math.max(zMax, p[i + 2]!);
        zMin = Math.min(zMin, p[i + 2]!);
        y += p[i + 1]! / loft.ring;
      }
      rows.push(
        `slice ${String(s).padStart(2)}  y=${y.toFixed(1).padStart(6)}  ` +
          `x ${xMin.toFixed(1).padStart(6)}..${xMax.toFixed(1).padStart(6)} ` +
          `(w ${(xMax - xMin).toFixed(1).padStart(5)})  ` +
          `z ${zMin.toFixed(1).padStart(6)}..${zMax.toFixed(1).padStart(6)} ` +
          `(h ${(zMax - zMin).toFixed(1).padStart(5)})`,
      );
    }
    console.log(
      `frame: ${frame ? "posed" : "flat"}; slices ${loft.slices}, ring ${loft.ring}\n` +
        rows.join("\n"),
    );
  });
});
