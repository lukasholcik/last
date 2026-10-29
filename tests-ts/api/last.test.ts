import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";

import baseline from "../../examples/foot-first-baseline.json";
import * as geometry from "~/lib/geometry";
import { type FootFirstInput, type LastState } from "~/lib/geometry/types";
import { createCaller, type AppRouter } from "~/server/api/root";

const caller = createCaller({ headers: new Headers() });

afterEach(() => vi.restoreAllMocks());

describe("last router", () => {
  it("infers domain input and result types for clients", () => {
    expectTypeOf<
      inferRouterInputs<AppRouter>["last"]["rebuild"]
    >().toEqualTypeOf<FootFirstInput>();
    expectTypeOf<
      inferRouterOutputs<AppRouter>["last"]["rebuild"]
    >().toEqualTypeOf<LastState>();
  });

  it("returns the new synthetic foot-first baseline unchanged", async () => {
    expect(await caller.last.defaults()).toEqual(baseline);
  });

  it("rebuilds with the shared core and returns all five passing reports", async () => {
    const input = await caller.last.defaults();
    const state = await caller.last.rebuild(input);
    expect(state).toEqual(geometry.buildLast(input));
    expect(state.inputs).toEqual(input);
    expect(Object.keys(state.reports).sort()).toEqual([
      "bottom",
      "contour",
      "foot",
      "section",
      "top",
    ]);
    expect(Object.values(state.reports).every((report) => report.passed)).toBe(
      true,
    );
  });

  it("rejects invalid current-schema input as BAD_REQUEST", async () => {
    const input = await caller.last.defaults();
    input.foot.length = -1;
    await expect(caller.last.rebuild(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
  it("accepts optional last-only edits without changing the returned FOOT or its bend anchor", async () => {
    const input = await caller.last.defaults(),
      original = await caller.last.rebuild(input);
    input.last_outline = {
      anchors: {
        medial_ball: { station_offset_ratio: 0.02, side_offset_ratio: -0.04 },
      },
      handles: {},
    };
    const changed = await caller.last.rebuild(input);
    expect(changed.models.foot).toEqual(original.models.foot);
    expect(changed.models.top.points.medial_ball).toMatchObject({
      y: 180,
      x: -50,
    });
    expect(changed.inputs.template).toEqual(original.inputs.template);
    expect(changed.resolved.bend_station).toBe(original.resolved.bend_station);
  });

  it("keeps actual bottom feasibility conflicts as readable BAD_REQUEST errors", async () => {
    const input = await caller.last.defaults();
    input.pose.heel_height = 0;
    await expect(caller.last.rebuild(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.last.rebuild(input)).rejects.toThrow(/seat front/);
  });

  it("maps unexpected core errors to a generic internal error", async () => {
    vi.spyOn(geometry, "buildLast").mockImplementationOnce(() => {
      throw new Error("private /server/secret/path");
    });
    await expect(
      caller.last.rebuild(geometry.parseFootFirstInput(baseline)),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unable to rebuild last.",
    });
  });
});
