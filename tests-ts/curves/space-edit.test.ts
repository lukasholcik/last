import { describe, expect, it } from "vitest";
import { defaultDoc } from "~/lib/studio/document";
import { upperFrame } from "~/lib/studio/contour";
import { dragMarker, editMarkers } from "~/lib/studio/space-edit";
import {
  DEFAULT_SIDE_PARAMS,
  sideContext,
  validContext,
} from "~/lib/studio/side";

const frameAt = (heelHeight: number) =>
  upperFrame(
    validContext(
      sideContext(defaultDoc().top, { ...DEFAULT_SIDE_PARAMS, heelHeight }),
    )!,
  );

/** The node (marker) that holds curve point `key` = "curve#index". */
const nodeOf = (ms: ReturnType<typeof editMarkers>, key: string) => {
  const [curve, i] = key.split("#");
  return ms.find(
    (x) =>
      x.part === "anchor" &&
      x.members.some((m) => m.curve === curve && m.index === Number(i)),
  )!;
};

describe("3D editing", () => {
  const d = defaultDoc();
  it("shows markers for the top outline, 4 plan rails and 6 elevation rails", () => {
    const m = editMarkers(d, null, null);
    const members = m.flatMap((x) => x.members);
    expect(members.filter((x) => x.curve === "top")).toHaveLength(10);
    expect(members.filter((x) => x.kind === "plan").length).toBe(10 + 4 * 6);
    expect(members.filter((x) => x.kind === "elev").length).toBe(6 * 6);
  });
  it("merges a plan and an elevation point at the same place into one node", () => {
    const m = editMarkers(d, null, null);
    expect(m.length).toBeLessThan(10 + 4 * 6 + 6 * 6);
    expect(m.some((x) => x.kind === "both")).toBe(true);
    for (const a of m)
      for (const b of m)
        if (a !== b)
          expect(
            Math.hypot(
              a.pos[0] - b.pos[0],
              a.pos[1] - b.pos[1],
              a.pos[2] - b.pos[2],
            ),
          ).toBeGreaterThanOrEqual(1);
  });
  it("dropping a marker where it is changes nothing, flat or with the heel raised", () => {
    for (const f of [null, frameAt(40)]) {
      const ms = editMarkers(d, f, null);
      for (const id of ["plan:lateral_bottom#3", "elev:lateral#3", "top#3"]) {
        const m = nodeOf(ms, id),
          d2 = dragMarker(d, f, m, m.pos);
        const nums = (v: unknown): number[] =>
          JSON.stringify(v)
            .match(/-?\d+\.?\d*(e-?\d+)?/g)!
            .map(Number);
        const x = nums([d2.rails, d2.top.points.map((p) => p.pos)]),
          y = nums([d.rails, d.top.points.map((p) => p.pos)]);
        expect(x).toHaveLength(y.length);
        x.forEach((v, i) => expect(v).toBeCloseTo(y[i]!, 4));
      }
    }
  });
  it("dragging an elevation marker up raises the section point it drives", () => {
    const m = nodeOf(editMarkers(d, null, null), "elev:lateral_bottom#3"),
      d2 = dragMarker(d, null, m, [m.pos[0], m.pos[1], m.pos[2] + 6]);
    const before = d.sections.ball.points.find(
        (p) => p.role === "lateral_bottom",
      )!.pos[1],
      after = d2.sections.ball.points.find((p) => p.role === "lateral_bottom")!
        .pos[1];
    expect(after).toBeCloseTo(before + 6, 5);
  });
  it("Shift keeps only the larger change", () => {
    const m = nodeOf(editMarkers(d, null, null), "plan:lateral_bottom#3"),
      d2 = dragMarker(d, null, m, [m.pos[0] + 5, m.pos[1] + 1, m.pos[2]], true),
      p0 = d.rails.plan.lateral_bottom.points[3]!.pos,
      p1 = d2.rails.plan.lateral_bottom.points[3]!.pos;
    expect(p1[0]).toBeCloseTo(p0[0] + 5, 6);
    expect(p1[1]).toBeCloseTo(p0[1], 6);
  });
  it("handle markers appear for the selected point only", () => {
    const node = nodeOf(editMarkers(d, null, null), "elev:lateral#3"),
      m = editMarkers(d, null, node.id),
      hs = m.filter((x) => x.part !== "anchor");
    expect(hs.some((x) => x.curve === "elev:lateral" && x.index === 3)).toBe(
      true,
    );
    // every handle belongs to a member of the selected node
    for (const h of hs)
      expect(
        node.members.some((k) => k.curve === h.curve && k.index === h.index),
      ).toBe(true);
  });
  it("a selected node shows the handles of every member, tinted by projection", () => {
    const ms = editMarkers(d, null, null),
      node = ms.find((x) => x.kind === "both")!,
      hs = editMarkers(d, null, node.id).filter((x) => x.part !== "anchor");
    expect(new Set(hs.map((h) => h.kind)).size).toBeGreaterThan(1);
    expect(hs.every((h) => h.owner === node.id)).toBe(true);
  });

  /** A node where the plan and elevation curves of the same rail meet. */
  const railNode = () => {
    const ms = editMarkers(d, null, null);
    return ms.find(
      (n) =>
        n.part === "anchor" &&
        n.members.some(
          (a) =>
            a.curve.startsWith("plan:") &&
            n.members.some((b) => b.curve === `elev:${a.curve.slice(5)}`),
        ),
    )!;
  };
  it("shows one handle pair per rail, joining its plan and elevation handles", () => {
    const node = railNode(),
      hs = editMarkers(d, null, node.id).filter((x) => x.part !== "anchor"),
      joined = hs.filter((h) => h.members.length === 2);
    expect(joined.length).toBeGreaterThan(0);
    for (const h of joined) {
      expect(h.kind).toBe("both");
      const [a, b] = h.members;
      expect(new Set([a!.kind, b!.kind])).toEqual(new Set(["plan", "elev"]));
      expect(a!.curve.slice(5)).toBe(b!.curve.slice(5));
    }
  });
  it("never joins the top outline or a section with a rail handle", () => {
    const ms = editMarkers(d, null, null);
    for (const n of ms.filter((x) => x.part === "anchor")) {
      const hs = editMarkers(d, null, n.id).filter((x) => x.part !== "anchor");
      for (const h of hs) {
        const curves = h.members.map((m) => m.curve);
        if (
          curves.includes("top") ||
          curves.some((c) => c.startsWith("section:"))
        )
          expect(curves).toHaveLength(1);
      }
    }
  });
  it("dragging a joined handle moves both curves with the same y extent", () => {
    const node = railNode(),
      h = editMarkers(d, null, node.id).find(
        (x) => x.part !== "anchor" && x.members.length === 2,
      )!,
      at = [h.pos[0] + 4, h.pos[1] + 3, h.pos[2] + 2] as const,
      d2 = dragMarker(d, null, h, [...at]),
      off = (doc: typeof d, m: (typeof h.members)[number]) => {
        const c = m.curve.startsWith("plan:")
            ? doc.rails.plan[m.curve.slice(5) as keyof typeof doc.rails.plan]
            : doc.rails.elev[m.curve.slice(5) as keyof typeof doc.rails.elev],
          p = c.points[m.index]!;
        return m.side === "in" ? p.handleIn : p.handleOut;
      },
      [plan, elev] = [
        h.members.find((m) => m.kind === "plan")!,
        h.members.find((m) => m.kind === "elev")!,
      ];
    expect(off(d2, plan)[1]).toBeCloseTo(off(d2, elev)[0], 6);
    expect(off(d2, plan)[0]).not.toBeCloseTo(off(d, plan)[0], 3);
    expect(off(d2, elev)[1]).not.toBeCloseTo(off(d, elev)[1], 3);
  });
});
