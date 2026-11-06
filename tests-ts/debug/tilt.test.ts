import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseDoc, reconcileDoc, upgradeDoc } from "~/lib/studio/document";
import { upperFrame, flatToPosed } from "~/lib/studio/contour";
import { sectionGeometry, SECTION_IDS } from "~/lib/studio/section";
import { sideContext, validContext } from "~/lib/studio/side";

// Probe: how far is each section plane tilted by the pose rule, per heel height?
// STUDIO_DOC=debug/x.json pnpm exec vitest run tests-ts/debug/tilt.test.ts --silent=false
const file = process.env.STUDIO_DOC;
describe.skipIf(!file)("section tilt under pose", () => {
  it("prints", () => {
    const d = reconcileDoc(upgradeDoc(parseDoc(readFileSync(file!, "utf8"))));
    console.log("params", JSON.stringify(d.params));
    for (const H of [8, 40, 80]) {
      const ctx = validContext(
        sideContext(d.top, { ...d.params, heelHeight: H }),
      );
      if (!ctx) {
        console.log(H, "invalid");
        continue;
      }
      const f = upperFrame(ctx);
      console.log(
        `H=${H} seatAngle=${((ctx.pose.seatAngle * 180) / Math.PI).toFixed(1)} deg, ballStation=${ctx.ballStation.toFixed(1)}`,
      );
      for (const id of SECTION_IDS) {
        const g = sectionGeometry(d.top, d.dorsal, id)!;
        const a = flatToPosed(f, [g.station, 0]),
          b = flatToPosed(f, [g.station, 50]);
        const tilt = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
        const soleTilt = (st: number) => {
          const q0 = flatToPosed(f, [st - 1, 0]),
            q1 = flatToPosed(f, [st + 1, 0]);
          return (Math.atan2(q1[1] - q0[1], q1[0] - q0[0]) * 180) / Math.PI;
        };
        console.log(
          "    posed sole slope at station",
          (-soleTilt(g.station)).toFixed(1),
          "deg (rise toward the heel)",
        );
        console.log(
          " ",
          id.padEnd(6),
          "station",
          g.station.toFixed(1),
          "plane tilt from vertical",
          tilt.toFixed(1),
          "deg; sole at",
          a.map((v) => v.toFixed(1)).join(","),
        );
      }
    }
  });
});
