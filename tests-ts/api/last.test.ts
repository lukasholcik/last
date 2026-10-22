import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";

import baseline from "../../examples/contour-baseline.json";
import * as geometry from "~/lib/geometry";
import { type ContourInput, type LastState } from "~/lib/geometry/types";
import { createCaller, type AppRouter } from "~/server/api/root";

const caller = createCaller({ headers: new Headers() });

afterEach(() => vi.restoreAllMocks());

describe("last router", () => {
  it("infers domain input and result types for clients", () => {
    expectTypeOf<
      inferRouterInputs<AppRouter>["last"]["rebuild"]
    >().toEqualTypeOf<ContourInput>();
    expectTypeOf<
      inferRouterOutputs<AppRouter>["last"]["rebuild"]
    >().toEqualTypeOf<LastState>();
  });

  it("returns the existing contour baseline unchanged", async () => {
    expect(await caller.last.defaults()).toEqual(baseline);
  });

  it("rebuilds with the shared core and returns all three passing reports", async () => {
    const input = await caller.last.defaults();
    const state = await caller.last.rebuild(input);
    expect(state).toEqual(geometry.buildLast(input));
    expect(state.inputs).toEqual(input);
    expect(Object.keys(state.reports).sort()).toEqual([
      "bottom",
      "contour",
      "top",
    ]);
    expect(Object.values(state.reports).every((report) => report.passed)).toBe(
      true,
    );
  });

  it("rejects invalid current-schema input as BAD_REQUEST", async () => {
    const input = await caller.last.defaults();
    input.design.last_length = -1;
    await expect(caller.last.rebuild(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("maps unexpected core errors to a generic internal error", async () => {
    vi.spyOn(geometry, "buildLast").mockImplementationOnce(() => {
      throw new Error("private /server/secret/path");
    });
    await expect(
      caller.last.rebuild(geometry.parseContourInput(baseline)),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unable to rebuild last.",
    });
  });
});
