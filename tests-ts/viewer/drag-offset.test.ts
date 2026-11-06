import { isValidElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import { buildLast2D } from "../../src/lib/geometry/two-dimensional";
import {
  editCrossSection,
  resolveCrossSections,
} from "../../src/lib/geometry/cross-sections";
import { getShapeHandles, moveShapeHandle } from "../../src/lib/shaping";
import { ProfileHandles } from "../../src/app/_components/viewer/ProfileHandles";
import { SectionEditor } from "../../src/app/_components/viewer/SectionEditor";
import { modelToSvg } from "../../src/app/_components/viewer/profile-pointer";

// Exercise the real rendered controls' event callbacks without a DOM dependency.
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
  useMemo: (make: () => unknown) => make(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
}));

function find(
  node: ReactNode,
  attribute: string,
  value: string,
): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const found = find(child, attribute, value);
      if (found) return found;
    }
  } else if (isValidElement<Record<string, unknown>>(node)) {
    if (node.props[attribute] === value) return node.props;
    return find(node.props.children as ReactNode, attribute, value);
  }
}

function setup() {
  const geometry = buildLast2D(baseline);
  // A non-unit screen scale, with a frame that can change after pointerdown.
  const inverse = { a: 0.5, d: 0.5, e: -10, f: -15 };
  const getScreenCTM = vi.fn(() => ({ inverse: () => inverse }));
  vi.stubGlobal(
    "DOMPoint",
    class {
      constructor(
        public x: number,
        public y: number,
      ) {}
      matrixTransform(m: typeof inverse) {
        return { x: this.x * m.a + m.e, y: this.y * m.d + m.f };
      }
    },
  );
  const element = {
    ownerSVGElement: { getScreenCTM },
    focus: vi.fn(),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  const props = {
    enabled: true,
    version: 1,
    dragging: false,
    onBegin: () => ({
      token: 1,
      geometry,
      input: structuredClone(geometry.inputs),
    }),
    onPreview: vi.fn(),
    onFinish: vi.fn(() => true),
    onCancel: vi.fn(),
  };
  const event = (x: number, y: number) => ({
    button: 0,
    pointerId: 7,
    clientX: x * 2 + 20,
    clientY: y * 2 + 30,
    currentTarget: element,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  });
  const call = (
    control: Record<string, unknown>,
    name: string,
    x: number,
    y: number,
  ) => (control[name] as (event: unknown) => void)(event(x, y));
  return { geometry, props, element, getScreenCTM, event, call };
}
afterEach(() => vi.unstubAllGlobals());

describe("diagram grab offsets", () => {
  for (const plane of ["top", "side"] as const) {
    for (const kind of ["point", "tangent"] as const) {
      it(`${plane} ${kind}: off-centre clicks cancel, drags keep their offset in the initial screen frame`, () => {
        const s = setup();
        const handle = getShapeHandles(s.geometry).find(
          (h) =>
            h.plane === plane &&
            h.kind === kind &&
            (plane !== "top" || h.editTarget === "last"),
        )!;
        const frame = { left: 16, topBase: 70, bottomBase: 250 };
        const tree = ProfileHandles({
          ...s.props,
          result: s.geometry,
          frame,
          selectedId: handle.id,
          onChoose: vi.fn(),
          outlineMode: "last",
          onSelect: vi.fn(),
        });
        const control = find(tree, "data-shape-handle", handle.id)!;
        const [x, y] = modelToSvg(handle.position, plane, frame);
        s.call(control, "onPointerDown", x + 3, y + 2);
        expect(s.props.onPreview).not.toHaveBeenCalled();
        s.call(control, "onPointerUp", x + 3, y + 2);
        expect(s.props.onFinish).not.toHaveBeenCalled();
        expect(s.props.onCancel).toHaveBeenCalledWith(1);

        s.call(control, "onPointerDown", x + 3, y + 2);
        s.getScreenCTM.mockImplementation(() => ({
          inverse: () => ({ a: 9, d: 9, e: 100, f: 100 }),
        }));
        const expected = moveShapeHandle(
          s.geometry,
          s.geometry.inputs,
          handle.id,
          [
            handle.position[0] + 2,
            handle.position[1] + (plane === "side" ? -1 : 1),
          ],
        );
        s.call(control, "onPointerMove", x + 5, y + 3);
        expect(s.props.onPreview).toHaveBeenLastCalledWith(1, expected.input);
        s.call(control, "onPointerUp", x + 5, y + 3);
        expect(s.props.onFinish).toHaveBeenLastCalledWith(
          1,
          expected.input,
          expected.feedback,
        );
        expect(s.element.releasePointerCapture).toHaveBeenCalledWith(7);
      });
    }
  }

  it("pointer cancellation releases capture without accepting a top/profile preview", () => {
    const s = setup();
    const tree = ProfileHandles({
      ...s.props,
      result: s.geometry,
      frame: { left: 16, topBase: 70, bottomBase: 250 },
      selectedId: null,
      onChoose: vi.fn(),
      outlineMode: "last",
      onSelect: vi.fn(),
    });
    const control = find(tree, "data-shape-handle", "top:last-toe")!;
    s.call(control, "onPointerDown", 300, 70);
    s.call(control, "onPointerMove", 302, 70);
    s.call(control, "onPointerCancel", 302, 70);
    s.call(control, "onPointerUp", 302, 70);
    expect(s.props.onCancel).toHaveBeenCalledWith(1);
    expect(s.props.onFinish).not.toHaveBeenCalled();
    expect(s.element.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  for (const kind of ["point", "incoming", "outgoing"] as const) {
    it(`section ${kind}: preserves off-centre clicks and drag offsets, and cancels previews`, () => {
      const s = setup();
      const tree = SectionEditor({
        ...s.props,
        geometry: s.geometry,
        editable: s.geometry,
        selected: "ball",
        onSelect: vi.fn(),
        onMessage: vi.fn(),
      });
      const control = find(
        tree,
        "data-section-control",
        `ball:dorsal:${kind}`,
      )!;
      const initial = resolveCrossSections(s.geometry)
        .find((section) => section.id === "ball")!
        .anchors.find((anchor) => anchor.id === "dorsal")![kind];
      s.call(control, "onPointerDown", 3, 10);
      s.call(control, "onPointerUp", 3, 10);
      expect(s.props.onFinish).not.toHaveBeenCalled();
      expect(s.props.onCancel).toHaveBeenCalledWith(1);
      s.call(control, "onPointerDown", 3, 10);
      s.getScreenCTM.mockImplementation(() => ({
        inverse: () => ({ a: 9, d: 9, e: 100, f: 100 }),
      }));
      const expected = editCrossSection(
        s.geometry,
        "ball",
        { anchor: "dorsal", kind },
        [kind === "point" ? 0 : initial[0] + 1, initial[1] + 1],
      );
      s.call(control, "onPointerMove", 4, 9);
      expect(s.props.onPreview).toHaveBeenLastCalledWith(1, expected);
      s.call(control, "onPointerUp", 4, 9);
      expect(s.props.onFinish).toHaveBeenLastCalledWith(
        1,
        expected,
        "Section updated",
      );
      s.props.onFinish.mockClear();
      s.call(control, "onPointerDown", 3, 10);
      s.call(control, "onPointerMove", 4, 9);
      s.call(control, "onPointerCancel", 4, 9);
      s.call(control, "onPointerUp", 4, 9);
      expect(s.props.onFinish).not.toHaveBeenCalled();
      expect(s.element.releasePointerCapture).toHaveBeenCalledWith(7);
    });
  }
});
