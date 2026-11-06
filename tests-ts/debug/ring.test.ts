import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseDoc, reconcileDoc, upgradeDoc } from "~/lib/studio/document";
import { upperFrame } from "~/lib/studio/contour";
import { sideContext, validContext } from "~/lib/studio/side";
import { buildLoft } from "~/lib/studio/loft";

/**
 * Prints one cross-section ring (x, z, and the turn angle at each vertex) of a
 * saved model, to find kinks: STUDIO_DOC=debug/x.json STUDIO_SLICE=85
 * pnpm exec vitest run tests-ts/debug/ring.test.ts --silent=false
 */
const file = process.env.STUDIO_DOC;
describe.skipIf(!file)("ring", () => {
  it("prints a ring", () => {
    const doc = reconcileDoc(upgradeDoc(parseDoc(readFileSync(file!, "utf8")))),
      ctx = validContext(sideContext(doc.top, doc.params)),
      loft = buildLoft(doc, ctx ? upperFrame(ctx) : null),
      s = Number(process.env.STUDIO_SLICE ?? 85),
      pt = (k: number) => {
        const i = (s * loft.ring + ((k + loft.ring) % loft.ring)) * 3;
        return [
          loft.positions[i]!,
          loft.positions[i + 1]!,
          loft.positions[i + 2]!,
        ];
      },
      out: string[] = [];
    for (let k = 0; k < loft.ring; k++) {
      const a = pt(k - 1),
        b = pt(k),
        c = pt(k + 1),
        u = [b[0]! - a[0]!, b[2]! - a[2]!],
        v = [c[0]! - b[0]!, c[2]! - b[2]!],
        turn =
          (Math.atan2(
            u[0]! * v[1]! - u[1]! * v[0]!,
            u[0]! * v[0]! + u[1]! * v[1]!,
          ) *
            180) /
          Math.PI;
      out.push(
        `k ${String(k).padStart(2)}${k % 10 === 0 ? " *" : "  "} x ${b[0]!.toFixed(2).padStart(7)}  z ${b[2]!.toFixed(2).padStart(7)}  turn ${turn.toFixed(1).padStart(6)}`,
      );
    }
    console.log(`slice ${s} y=${pt(0)[1]!.toFixed(1)}\n${out.join("\n")}`);
  });
});
