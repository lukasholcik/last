import { describe, expect, it } from "vitest";
import { arcLengthToPoint, moveAnchor, sampleCurve } from "~/lib/curves";
import { solvePosture } from "~/lib/geometry/foot-first";
import {
  defaultDoc,
  parseDoc,
  upgradeDoc,
  serializeDoc,
  withCurve,
  withParams,
  withUnlocked,
  type StudioDoc,
} from "~/lib/studio/document";
import { referenceToPosed, solvePose } from "~/lib/studio/pose";
import { DEFAULT_SIDE_PARAMS } from "~/lib/studio/side";
import { posedDorsal } from "~/lib/studio/contour";
import { bottomDrives, sideContext, sideDiagnostics } from "~/lib/studio/side";

const ctxOf = (d: StudioDoc) => {
  const c = sideContext(d.top, d.params);
  if ("error" in c || !c.pose.ok) throw new Error("invalid test context");
  return c as typeof c & {
    pose: { ok: true; allowance: number; theta: number; seatAngle: number };
  };
};
const idx = (d: StudioDoc, role: string) =>
  d.bottom.points.findIndex((p) => p.role === role);
const cross = (a: readonly number[], b: readonly number[]) =>
  a[0]! * b[1]! - a[1]! * b[0]!;

/** Every locked drive of the bottom must hold exactly. */
function expectBudgets(d: StudioDoc) {
  const c = ctxOf(d),
    { pose } = c,
    H = d.params.heelHeight,
    S = d.params.seatLength;
  expect(d.bottom.points[idx(d, "heel_rear")]!.pos).toEqual([0, H]);
  const seat = d.bottom.points[idx(d, "seat_front")]!.pos;
  expect(seat[0]).toBeCloseTo(S * Math.cos(pose.seatAngle), 9);
  expect(seat[1]).toBeCloseTo(H - S * Math.sin(pose.seatAngle), 9);
  expect(arcLengthToPoint(d.bottom, idx(d, "contact"))).toBeCloseTo(
    c.ballStation + pose.allowance,
    2,
  );
  expect(arcLengthToPoint(d.bottom, idx(d, "toe_end"))).toBeCloseTo(
    c.length + pose.allowance,
    2,
  );
  expect(d.bottom.points[idx(d, "toe_end")]!.pos[1]).toBeCloseTo(
    d.params.toeSpring,
    9,
  );
  expect(d.bottom.points[idx(d, "contact")]!.pos[1]).toBe(0);
}

describe("pose", () => {
  it("is the production hinge solver", () => {
    const p = solvePose({
      heelHeight: 40,
      ballStation: 185,
      radius: 13.5,
      seatOffsetDeg: 0,
    });
    const ref = solvePosture(185, 13.5, 40);
    expect(p.ok && p.theta).toBe(ref.angle);
    expect(p.ok && p.allowance).toBe(ref.allowance);
  });

  it("flat has no angle or allowance", () => {
    const p = solvePose({
      heelHeight: 0,
      ballStation: 185,
      radius: 13.5,
      seatOffsetDeg: 0,
    });
    expect(p).toMatchObject({ ok: true, theta: 0, allowance: 0 });
  });

  it("rejects heights outside the hinge domain with a readable message", () => {
    const p = solvePose({
      heelHeight: 400,
      ballStation: 185,
      radius: 13.5,
      seatOffsetDeg: 0,
    });
    expect(p.ok).toBe(false);
    expect(!p.ok && p.error).toContain("Heel height must be");
  });

  it("a positive seat offset at H=0 is rejected downstream, not adapted", () => {
    const d = withParams(defaultDoc(), { heelHeight: 0, seatOffsetDeg: 2 });
    const diag = sideDiagnostics(sideContext(d.top, d.params), d.bottom);
    expect(
      diag.some((x) => x.level === "error" && x.text.includes("below ground")),
    ).toBe(true);
  });

  it("the allowance map is C1, monotone and hits the budget points", () => {
    const S = 54,
      A = 185,
      d = 6;
    expect(referenceToPosed(0, S, A, d)).toBe(0);
    expect(referenceToPosed(S, S, A, d)).toBe(S);
    expect(referenceToPosed(A, S, A, d)).toBe(A + d);
    let prev = -1;
    for (let s = 0; s <= 270; s += 1) {
      const g = referenceToPosed(s, S, A, d);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
    const e = 1e-4;
    for (const s of [S, A]) {
      const slope =
        (referenceToPosed(s + e, S, A, d) - referenceToPosed(s - e, S, A, d)) /
        (2 * e);
      expect(slope).toBeCloseTo(1, 3);
    }
  });
});

describe("side document", () => {
  it("starts valid and satisfies every budget", () => {
    expectBudgets(defaultDoc());
  });

  it.each([0, 8, 40, 80])("keeps all budgets at heel height %d mm", (H) => {
    const d = withParams(defaultDoc(), { heelHeight: H });
    expect(
      sideDiagnostics(sideContext(d.top, d.params), d.bottom).filter(
        (x) => x.level !== "ok",
      ),
    ).toEqual([]);
    expectBudgets(d);
  });

  it("flat → elevated → flat returns to the flat shape", () => {
    const flat = withParams(defaultDoc(), { heelHeight: 0 });
    const back = withParams(withParams(flat, { heelHeight: 80 }), {
      heelHeight: 0,
    });
    flat.bottom.points.forEach((p, i) => {
      expect(back.bottom.points[i]!.pos[0]).toBeCloseTo(p.pos[0], 6);
      expect(back.bottom.points[i]!.pos[1]).toBeCloseTo(p.pos[1], 6);
    });
  });

  it("raising the heel tilts the straight seat instead of bowing it", () => {
    const d = withParams(defaultDoc(), { heelHeight: 60 }),
      a = d.bottom.points[0]!,
      b = d.bottom.points[1]!,
      chord = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]];
    const n = Math.hypot(chord[0]!, chord[1]!);
    expect(
      Math.abs(cross(a.handleOut, chord)) / (n * Math.hypot(...a.handleOut)),
    ).toBeLessThan(1e-6);
    expect(
      Math.abs(cross(b.handleIn, chord)) / (n * Math.hypot(...b.handleIn)),
    ).toBeLessThan(1e-6);
  });

  it("heel seat length moves the breast along the seat", () => {
    const d = withParams(defaultDoc(), { seatLength: 80 });
    expectBudgets(d);
    expect(d.bottom.points[idx(d, "seat_front")]!.pos[0]).toBeGreaterThan(70);
  });

  it("a ground-contact curve never dips below the ground by default", () => {
    for (const H of [0, 8, 80]) {
      const d = withParams(defaultDoc(), { heelHeight: H });
      expect(
        Math.min(...sampleCurve(d.bottom, 40).map((p) => p[1])),
      ).toBeGreaterThan(-0.05);
    }
  });

  it("unlocking a driven value stops it following the parameter", () => {
    let d = withUnlocked(defaultDoc(), "toe_end:1", true);
    const z = d.bottom.points[idx(d, "toe_end")]!.pos[1];
    d = withParams(d, { toeSpring: 25 });
    expect(d.bottom.points[idx(d, "toe_end")]!.pos[1]).toBe(z);
    d = withUnlocked(d, "toe_end:1", false);
    expect(d.bottom.points[idx(d, "toe_end")]!.pos[1]).toBeCloseTo(25, 9);
  });

  it("editing the top outline updates the side view's driven values", () => {
    const d0 = defaultDoc(),
      i = d0.top.points.findIndex((p) => p.role === "medial_ball"),
      p = d0.top.points[i]!.pos,
      d1 = withCurve(d0, "top", moveAnchor(d0.top, i, [p[0], p[1] + 20]));
    expect(ctxOf(d1).ballStation).toBeCloseTo(ctxOf(d0).ballStation + 20, 6);
    expectBudgets(d1);
    const ball = d1.dorsal.points.find((q) => q.role === "ball_top")!;
    expect(ball.pos[0]).toBeCloseTo(ctxOf(d1).ballStation, 9);
  });

  it("an invalid height leaves the geometry untouched and explains why", () => {
    const d0 = defaultDoc(),
      d1 = withParams(d0, { heelHeight: 500 });
    expect(d1.bottom).toBe(d0.bottom);
    const diag = sideDiagnostics(sideContext(d1.top, d1.params), d1.bottom);
    expect(diag[0]!.level).toBe("error");
  });

  it("at H=0 the posed instep equals the flat instep over the flat sole", () => {
    const d = withParams(defaultDoc(), { heelHeight: 0 }),
      c = ctxOf(d),
      posed = posedDorsal(c, d.dorsal),
      flat = sampleCurve(d.dorsal, 40);
    flat.forEach((f, i) => {
      if (f[0] < c.ballStation - 5) {
        expect(posed[i]![0]).toBeCloseTo(f[0], 1);
        expect(posed[i]![1]).toBeCloseTo(f[1], 1);
      }
    });
  });

  it("raising the heel lifts the rear of the instep and keeps the toe end", () => {
    const flat = withParams(defaultDoc(), { heelHeight: 0 }),
      high = withParams(defaultDoc(), { heelHeight: 80 }),
      pf = posedDorsal(ctxOf(flat), flat.dorsal),
      ph = posedDorsal(ctxOf(high), high.dorsal);
    expect(ph[0]![1]).toBeGreaterThan(pf[0]![1] + 60);
    expect(ph[ph.length - 1]![1]).toBeCloseTo(pf[pf.length - 1]![1], 1);
  });

  it("round-trips through JSON", () => {
    const d = withUnlocked(defaultDoc(), "contact:0", true);
    expect(parseDoc(serializeDoc(d))).toEqual(JSON.parse(JSON.stringify(d)));
    expect(() => parseDoc('{"version":1}')).toThrow();
  });
});

describe("explicit straight segments and the blend", () => {
  it("the blend end stays one blend length after the contact", () => {
    for (const H of [0, 40, 80]) {
      const d = withParams(defaultDoc(), { heelHeight: H, blendLength: 12 });
      expect(d.bottom.points[idx(d, "blend_end")]!.pos[0]).toBeCloseTo(
        d.bottom.points[idx(d, "contact")]!.pos[0] + 12,
        9,
      );
    }
  });

  it("the ground contact keeps a horizontal tangent at any heel height", () => {
    for (const H of [0, 8, 80]) {
      const d = withParams(defaultDoc(), { heelHeight: H }),
        c = d.bottom.points[idx(d, "contact")]!;
      expect(c.handleIn[1]).toBe(0);
      expect(c.handleOut[1]).toBe(0);
    }
  });

  it("a flat waist is still a curve: it stays free when the heel rises", () => {
    const flat = withParams(defaultDoc(), { heelHeight: 0 });
    expect(
      flat.bottom.points[idx(flat, "seat_front")]!.lineToNext,
    ).toBeUndefined();
  });
});

describe("invalid pose", () => {
  it("keeps every landmark locked and protected, with nothing to apply", () => {
    const good = sideContext(defaultDoc().top, DEFAULT_SIDE_PARAMS),
      d = withParams(defaultDoc(), { heelHeight: 500 }),
      bad = sideContext(d.top, d.params);
    if ("error" in good || "error" in bad) throw new Error("context");
    expect(bottomDrives(bad).map((x) => x.id)).toEqual(
      bottomDrives(good).map((x) => x.id),
    );
    const seat = bottomDrives(bad).filter((x) => x.role === "seat_front");
    expect(seat).toHaveLength(2);
    for (const x of seat) expect(x.driver.kind).toBe("pending");
  });
});

describe("heel counter", () => {
  const flatPoint = (d: StudioDoc, role: string) =>
    d.dorsal.points.findIndex((p) => p.role === role);

  it("the flat curve starts at the sole's rear, locked to station 0 and ground", () => {
    const d = defaultDoc(),
      first = d.dorsal.points[0]!;
    expect(first.role).toBe("heel_back");
    expect(first.pos).toEqual([0, 0]);
    expect(d.dorsal.points[1]!.role).toBe("heel_bulge");
    expect(d.dorsal.points[1]!.pos[0]).toBeLessThan(0);
  });

  it.each([0, 25, 80])("starts exactly on the posed sole rear at H=%d", (H) => {
    const d = withParams(defaultDoc(), { heelHeight: H }),
      c = ctxOf(d),
      posed = posedDorsal(c, d.dorsal);
    expect(posed[0]![0]).toBeCloseTo(0, 9);
    expect(posed[0]![1]).toBeCloseTo(H, 9);
  });

  it("rides rigidly with the seat: a rotation about the sole's rear point", () => {
    const d = withParams(defaultDoc(), { heelHeight: 80 }),
      c = ctxOf(d),
      a = c.pose.seatAngle,
      i = flatPoint(d, "heel_bulge"),
      [s, h] = d.dorsal.points[i]!.pos,
      posed = posedDorsal(c, d.dorsal)[i * 40]!;
    // t = seat direction (down-forward), n = its normal (up-forward).
    const t = [Math.cos(a), -Math.sin(a)],
      n = [Math.sin(a), Math.cos(a)];
    expect(posed[0]).toBeCloseTo(s * t[0]! + h * n[0]!, 6);
    expect(posed[1]).toBeCloseTo(80 + s * t[1]! + h * n[1]!, 6);
  });

  it("leans forward at the top when the heel is raised, and not when flat", () => {
    const lean = (H: number) => {
      const d = withParams(defaultDoc(), { heelHeight: H }),
        p = posedDorsal(ctxOf(d), d.dorsal),
        k = flatPoint(d, "roof_rear") * 40;
      return p[k]![0] - p[0]![0];
    };
    expect(lean(80)).toBeGreaterThan(lean(0) + 20);
  });

  it("the instep over the ball is raised along the turned foot's up, from the ball contact", () => {
    // Frame rule (contour.ts): the foot turns about the ball, so "up" at the
    // ball is the hinge angle θ, not vertical (it was vertical before).
    const d = withParams(defaultDoc(), { heelHeight: 80 }),
      c = ctxOf(d),
      i = flatPoint(d, "ball_top"),
      p = posedDorsal(c, d.dorsal)[i * 40]!,
      h = d.dorsal.points[i]!.pos[1],
      cont = d.bottom.points[idx(d, "contact")]!.pos,
      th = c.pose.theta;
    expect(d.dorsal.points[i]!.pos[0]).toBeCloseTo(c.ballStation, 6);
    expect(Math.abs(p[0] - (cont[0] + h * Math.sin(th)))).toBeLessThan(6);
    expect(Math.abs(p[1] - h * Math.cos(th))).toBeLessThan(1);
  });

  it("upgrades a save that predates the heel counter without touching the instep", () => {
    const d = defaultDoc(),
      old: StudioDoc = {
        ...d,
        dorsal: { ...d.dorsal, points: d.dorsal.points.slice(2) },
      },
      up = upgradeDoc(old);
    expect(up.dorsal.points.map((p) => p.role)).toEqual(
      d.dorsal.points.map((p) => p.role),
    );
    expect(up.dorsal.points.slice(2).map((p) => p.pos)).toEqual(
      old.dorsal.points.map((p) => p.pos),
    );
    expect(upgradeDoc(up)).toBe(up);
  });
});
