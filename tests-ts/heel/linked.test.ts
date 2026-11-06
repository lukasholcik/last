import { describe, expect, it } from "vitest";
import baseline from "../../examples/foot-first-baseline.json";
import { parseFootFirstInput } from "../../src/lib/geometry/foot-first";
import { previewLast2D } from "../../src/lib/geometry/two-dimensional";
import { sectionExtent } from "../../src/lib/geometry/top";
import { seatFromLast } from "../../src/lib/heel/last-seat-adapter";
import {
  createHeelParameters,
  rebaseHeelParameters,
} from "../../src/lib/heel/model";
import {
  buildHeel,
  getTopEnvelope,
  pointOnHeel,
} from "../../src/lib/heel/loft";

function source(height = 80) {
  const input = parseFootFirstInput(structuredClone(baseline));
  input.pose.heel_height = height;
  // The baseline instep's 50-degree offset is unsupported at this high pose;
  // keep its independently authored section tangent forward. Seat is unchanged.
  if (height === 120) input.centre_section.instep_front_down_offset_deg = 0;
  return previewLast2D(input);
}

function closed(mesh: ReturnType<typeof buildHeel>) {
  expect(mesh.positions.flat().every(Number.isFinite)).toBe(true);
  expect(mesh.volume).toBeGreaterThan(0);
  const edges = new Map<string, number>();
  for (const tri of mesh.triangles)
    for (let j = 0; j < 3; j++) {
      const a = tri[j]!,
        b = tri[(j + 1) % 3]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  expect([...edges.values()].every((n) => n === 2)).toBe(true);
}

describe("linked Last attachment", () => {
  it.each([8, 80, 120])(
    "supports the baseline at %i mm, with and without shoulder",
    (height) => {
      const last = source(height),
        before = structuredClone(last);
      const seat = seatFromLast(last),
        p = createHeelParameters(seat);
      expect(seat.topOutline).toHaveLength(64);
      expect(seat.topOutline![0]![1]).toBeCloseTo(seat.length / 2);
      expect(seat.topOutline![32]![1]).toBeCloseTo(seat.length / 2);
      expect(seat.topOutline![48]![1]).toBe(0);
      const k = Math.tan((seat.pitchDeg * Math.PI) / 180),
        q = Math.hypot(1, k);
      for (const amount of [0, p.frontShoulderMm]) {
        const params = { ...p, frontShoulderMm: amount };
        const mesh = buildHeel(params, seat);
        closed(mesh);
        const nominal = getTopEnvelope(params, seat);
        for (let j = 0; j < 64; j++) {
          expect(nominal[j]![0]).toBeCloseTo(seat.topOutline![j]![0], 9);
          expect(nominal[j]![1]).toBeCloseTo(seat.topOutline![j]![1], 9);
          const actual = pointOnHeel(params, seat, 1, (j * Math.PI) / 32);
          expect(actual).toEqual(mesh.rings.at(-1)![j]);
          expect(actual[0]).toBeCloseTo(nominal[j]![0], 9);
          expect(actual[2]).toBeCloseTo(seat.heelHeight - k * actual[1], 9);
        }
        expect(mesh.rings.at(-1)![16]![1]).toBeCloseTo(
          seat.length - amount / q,
          9,
        );
        expect(mesh.rings.at(-1)![48]).toEqual(nominal[48]);
        expect(getTopEnvelope({ ...params, roundness: 4 }, seat)).toEqual(
          nominal,
        );
      }
      expect(last).toEqual(before);
    },
  );

  it("samples asymmetric authored anchors and handles rather than template widths", () => {
    const last = source();
    const point = last.models.top.points.lateral_heel!;
    point.x += 3;
    const handle =
      last.models.top.points.heel_tip_to_lateral_heel_handle_start!;
    handle.x += 2;
    const before = structuredClone(last);
    const seat = seatFromLast(last),
      p = createHeelParameters(seat);
    const expected = sectionExtent(
      last.models.top,
      last.resolved.seat_arc_length / 2,
    )[1];
    expect(seat.topOutline![0]![0]).toBeCloseTo(expected, 10);
    expect(getTopEnvelope(p, seat)[0]![0]).toBeCloseTo(expected, 10);
    closed(buildHeel(p, seat));
    expect(last).toEqual(before);
  });

  it("rebases normalized body edits without mutating or resetting shoulder and shape", () => {
    const old = seatFromLast(source()),
      next = seatFromLast(source(120));
    next.leftX -= 4;
    next.rightX += 7;
    next.length *= 1.1;
    const p = createHeelParameters(old);
    p.bottom.centerX += 2;
    p.bottom.centerY += 3;
    p.handles.left[0] += 1;
    p.handles.front[1] -= 2;
    p.roundness = 3;
    p.symmetricBody = false;
    p.frontShoulderMm = 1.3;
    const before = structuredClone(p),
      result = rebaseHeelParameters(p, old, next);
    const sx = (next.rightX - next.leftX) / (old.rightX - old.leftX),
      sy = next.length / old.length;
    expect(result.bottom.centerX).toBeCloseTo(
      next.leftX + (p.bottom.centerX - old.leftX) * sx,
    );
    expect(result.bottom.width).toBeCloseTo(p.bottom.width * sx);
    expect(result.bottom.centerY).toBeCloseTo(p.bottom.centerY * sy);
    expect(result.handles.left[0]).toBeCloseTo(
      next.leftX + (p.handles.left[0] - old.leftX) * sx,
    );
    expect(result.handles.front[1]).toBeCloseTo(p.handles.front[1] * sy);
    expect(result.top).toEqual({
      backY: 0,
      frontY: next.length,
      leftX: next.leftX,
      rightX: next.rightX,
    });
    expect(result.frontShoulderMm).toBe(1.3);
    expect(result.roundness).toBe(3);
    expect(result.symmetricBody).toBe(false);
    expect(p).toEqual(before);
  });

  it("supports linked widths wholly on one side of zero and preserves the bottom", () => {
    const original = seatFromLast(source());
    const seat = {
      ...original,
      leftX: original.leftX + 80,
      rightX: original.rightX + 80,
      topOutline: original.topOutline!.map(
        ([x, y]) => [x + 80, y] as [number, number],
      ),
    };
    const p = createHeelParameters(seat);
    const linked = buildHeel(p, seat);
    closed(linked);
    const unlinked = buildHeel(p, {
      ...seat,
      leftX: -1,
      rightX: seat.rightX,
      topOutline: undefined,
    });
    expect(linked.rings[0]).toEqual(unlinked.rings[0]);
  });

  it.each([8, 80, 120])(
    "also supports the broad starting body at %i mm",
    (height) => {
      const seat = seatFromLast(source(height));
      closed(buildHeel(createHeelParameters(seat, "broad"), seat));
    },
  );

  it("rejects malformed, crossed and conflicting linked geometry visibly", () => {
    const seat = seatFromLast(source()),
      p = createHeelParameters(seat);
    expect(() =>
      buildHeel(p, { ...seat, topOutline: seat.topOutline!.slice(1) }),
    ).toThrow(/64 finite/);
    const nonfinite = seat.topOutline!.map((v) => [...v] as [number, number]);
    nonfinite[0]![0] = NaN;
    expect(() => buildHeel(p, { ...seat, topOutline: nonfinite })).toThrow(
      /64 finite/,
    );
    expect(() =>
      buildHeel(p, { ...seat, topOutline: [...seat.topOutline!].reverse() }),
    ).toThrow(/winding/);
    const crossed = seat.topOutline!.map((v) => [...v] as [number, number]);
    [crossed[1], crossed[30]] = [crossed[30]!, crossed[1]!];
    expect(() => buildHeel(p, { ...seat, topOutline: crossed })).toThrow(
      /star-shaped|simple/,
    );
    expect(() =>
      buildHeel({ ...p, top: { ...p.top, frontY: seat.length - 1 } }, seat),
    ).toThrow(/conflict/);
    const folded = structuredClone(p);
    folded.handles.front = [-20, -20];
    expect(() => buildHeel(folded, seat)).toThrow(/Invalid heel/);
    const last = source();
    last.models.top.points.heel_tip!.y = -1;
    expect(() => seatFromLast(last)).toThrow(/Unsupported Last attachment/);
  });
});
