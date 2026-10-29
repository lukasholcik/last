import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import { buildLast2D } from "../../src/lib/geometry/two-dimensional";
import {
  editCrossSectionFrame,
  resolveCrossSections,
} from "../../src/lib/geometry/cross-sections";
import { referenceSectionLine } from "../../src/app/_components/viewer/section-editor";
import { SectionEditor } from "../../src/app/_components/viewer/SectionEditor";
import { HeelWraps } from "../../src/app/_components/viewer/HeelWraps";

describe("compact section editor", () => {
  it("keeps oblique reference marker endpoints at separate ball landmark stations, including authored tilt/offset", () => {
    const initial = buildLast2D(baseline);
    const moved = buildLast2D(
      editCrossSectionFrame(initial, "ball", {
        stationOffsetRatio: 0.01,
        tiltDeg: 2,
      }),
    );
    const ball = resolveCrossSections(moved).find((s) => s.id === "ball")!;
    const line = referenceSectionLine(moved, ball);
    const m = moved.models.top.points.medial_ball!,
      l = moved.models.top.points.lateral_ball!;
    const slope = (l.y - m.y) / (l.x - m.x) + Math.tan((2 * Math.PI) / 180);
    for (const [x, s] of line)
      expect(s).toBeCloseTo(
        m.y -
          ((l.y - m.y) / (l.x - m.x)) * m.x +
          0.01 * moved.inputs.foot.length +
          slope * x,
        6,
      );
    expect(line[0][1]).not.toBeCloseTo(line[1][1], 3);
  });
  it("renders five equal-scale editors, independent selected handles, and an honest endpoint", () => {
    const geometry = buildLast2D(baseline);
    const html = renderToStaticMarkup(
      createElement(SectionEditor, {
        geometry,
        editable: geometry,
        selected: "ball",
        onSelect: () => undefined,
        onMessage: () => undefined,
        enabled: true,
        dragging: false,
        version: 1,
        onBegin: () => null,
        onPreview: () => undefined,
        onFinish: () => false,
        onCancel: () => undefined,
      }),
    );
    expect(html.match(/equal scale local face-on view/g)).toHaveLength(5);
    expect(html).toContain('data-section-control="ball:dorsal:incoming"');
    expect(html).toContain('data-section-control="ball:dorsal:outgoing"');
    expect(html).not.toContain(
      'data-section-control="heel_width:dorsal:incoming"',
    );
    expect(html).not.toContain('data-section-control="toe_end:');
    expect(html).toContain("Endpoint · edit top / profile");
  });
  it("does not silently configure wraps or infer foot comparisons", () => {
    const geometry = buildLast2D(baseline);
    const html = renderToStaticMarkup(
      createElement(HeelWraps, {
        result: null,
        stale: true,
        geometry,
        enabled: true,
        onApply: () => true,
      }),
    );
    expect(html.match(/Unconfigured/g)).toHaveLength(2);
    expect(html.match(/capture conditions unavailable/g)).toHaveLength(2);
    expect(html.match(/Use declared route \+ target/g)).toHaveLength(2);
    expect(geometry.inputs.cross_sections?.heel_wraps).toBeUndefined();
  });
});
