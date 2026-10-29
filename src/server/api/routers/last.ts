import { TRPCError } from "@trpc/server";

import baseline from "../../../../examples/foot-first-baseline.json";
import {
  buildLast,
  GeometryValidationError,
  InputError,
  parseFootFirstInput,
} from "~/lib/geometry";
import { type FootFirstInput, type LastState } from "~/lib/geometry/types";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

function domainError(error: unknown): TRPCError {
  if (error instanceof InputError) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof GeometryValidationError) {
    return new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: "Geometry validation failed.",
      cause: error,
    });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Unable to rebuild last.",
  });
}

// tRPC infers this parser's output as its client input, without a duplicate schema.
function parseInput(input: unknown): FootFirstInput {
  try {
    return parseFootFirstInput(input);
  } catch (error) {
    throw domainError(error);
  }
}

// tRPC wraps all parser exceptions in BAD_REQUEST. Keep domain error status codes.
const contourProcedure = publicProcedure.use(async ({ next }) => {
  const result = await next();
  if (
    !result.ok &&
    result.error.code === "BAD_REQUEST" &&
    result.error.cause instanceof TRPCError
  ) {
    return { ...result, error: result.error.cause };
  }
  return result;
});

export const lastRouter = createTRPCRouter({
  defaults: publicProcedure.query((): FootFirstInput => parseInput(baseline)),
  rebuild: contourProcedure
    .input(parseInput)
    .mutation(({ input }): LastState => {
      try {
        return buildLast(input);
      } catch (error) {
        throw domainError(error);
      }
    }),
});
