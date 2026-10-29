import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import input from "../../examples/foot-first-baseline.json";
import type { FootFirstInput } from "../../src/lib/geometry/types";
import { Controls } from "../../src/app/_components/viewer/Controls";
import { toDraft } from "../../src/app/_components/viewer/state";

const baseline: FootFirstInput = {
  ...input,
  schema_version: 4,
  kind: "foot_first_last",
  units: "mm",
  reference: { ...input.reference, provenance: "synthetic" },
};
describe("physical controls panel", () => {
  it("renders only primary physical dimensions, not an auxiliary angle/ratio catalogue", () => {
    const html = renderToStaticMarkup(
      createElement(Controls, {
        draft: toDraft(baseline),
        reference: baseline.reference,
        result: null,
        busy: false,
        canReset: true,
        canDiscard: true,
        onEdit: () => undefined,
        onResize: () => false,
        onSubmit: () => undefined,
        onReset: () => undefined,
        onDiscard: () => undefined,
      }),
    );
    expect(html).toContain('id="foot-length"');
    expect(html).toContain('id="foot-width"');
    expect(html).toContain('id="extent-medial_heel"');
    expect(html).toContain('id="extent-lateral_toe"');
    expect(html).toContain('id="toe-extension-mm"');
    expect(html).toContain('id="pose-heel_height"');
    expect(html).toContain('id="discard-pending"');
    expect(html).toContain("Discard changes");
    expect(html).not.toMatch(/id="section-/);
    expect(html).not.toContain('id="pose-seat_inclination_deg"');
    expect(html).not.toMatch(/id="design-(?:arch|seat|blend|bend)/);
    expect(html).not.toMatch(/id="template-/);
    expect(html.match(/type="number"/g)).toHaveLength(14);
    expect(html).toContain("not a summed section width");
  });
});
