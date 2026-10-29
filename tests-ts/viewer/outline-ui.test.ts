import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import input from "../../examples/foot-first-baseline.json";
import type { FootFirstInput } from "../../src/lib/geometry/types";
import { buildLast2D } from "../../src/lib/geometry/two-dimensional";
import { AlignedGuides } from "../../src/app/_components/viewer/AlignedGuides";

const baseline: FootFirstInput = {
  ...input,
  schema_version: 4,
  kind: "foot_first_last",
  units: "mm",
  reference: { ...input.reference, provenance: "synthetic" },
};
describe("quiet last-outline editor", () => {
  it("renders selected toe handles, reset metadata and distinct reference styling without drag popovers", () => {
    const geometry = buildLast2D(baseline);
    const html = renderToStaticMarkup(
      createElement(AlignedGuides, {
        result: geometry,
        editable: geometry,
        previewError: null,
        construction: false,
        onConstruction: () => undefined,
        selection: null,
        onSelect: () => undefined,
        viewLabel: "2D checked",
        enabled: true,
        version: 1,
        dragging: false,
        selectedId: "top:last-toe",
        onChoose: () => undefined,
        onBegin: () => null,
        onPreview: () => undefined,
        onFinish: () => false,
        onCancel: () => undefined,
        onResetPoint: () => undefined,
      }),
    );
    expect(html).toContain('id="edit-last" type="button" aria-pressed="true"');
    expect(html).toContain('data-guide="foot"');
    expect(html).toContain('stroke-dasharray="2 1.3"');
    expect(html).toContain('data-guide="top"');
    expect(html).toContain('data-shape-handle="top:toe_tip:in"');
    expect(html).toContain('data-shape-handle="top:toe_tip:out"');
    expect(html).toContain('id="reset-point-to-foot"');
    expect(html).not.toContain("foreignObject");
    expect(html).not.toContain("profile-tooltip");
    expect(html).not.toContain("One forward direction");
    const css = readFileSync(
      new URL("../../src/styles/globals.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(
      "#drawing.last-shape-drawing .guide-foot{fill:none;stroke:var(--muted);stroke-dasharray:2 1.3}",
    );
    expect(css).toContain(
      "#drawing.last-shape-drawing .guide-top{fill:#21635608;stroke:var(--top);stroke-dasharray:none}",
    );
  });
});
