import { initTRPC } from "@trpc/server";
import superjson from "superjson";

import { GeometryValidationError, InputError } from "~/lib/geometry";

export const createTRPCContext = (opts: { headers: Headers }) => opts;

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      message:
        error.code === "INTERNAL_SERVER_ERROR"
          ? "Unable to rebuild last."
          : error.code === "BAD_REQUEST" && !(error.cause instanceof InputError)
            ? "Invalid request input."
            : shape.message,
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        path: shape.data.path,
        reports:
          error.cause instanceof GeometryValidationError
            ? error.cause.reports
            : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
