import { z } from "zod";
import type { EditableCurve } from "./types";
import { MIN_POINTS_CLOSED, MIN_POINTS_OPEN } from "./edit";

const vec = z.tuple([z.number().finite(), z.number().finite()]);
/** Shape of a curve without the version envelope; reused by composite documents. */
export const curveBody = z
  .object({
    closed: z.boolean(),
    points: z.array(
      z
        .object({
          pos: vec,
          mode: z.enum(["auto", "smooth", "symmetric", "corner"]),
          handleIn: vec,
          handleOut: vec,
          role: z.string().optional(),
          lineToNext: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const schema = curveBody.extend({ version: z.literal(1) });

export function serializeCurve(c: EditableCurve): string {
  return JSON.stringify(
    { version: 1, closed: c.closed, points: c.points },
    null,
    2,
  );
}

/** Throws a readable Error for malformed JSON or an invalid curve. */
export function parseCurve(text: string): EditableCurve {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Invalid curve${issue ? ` at ${issue.path.join(".") || "root"}: ${issue.message}` : ""}`,
    );
  }
  const { closed, points } = result.data;
  if (points.length < (closed ? MIN_POINTS_CLOSED : MIN_POINTS_OPEN))
    throw new Error(
      `A ${closed ? "closed" : "open"} curve needs at least ${closed ? MIN_POINTS_CLOSED : MIN_POINTS_OPEN} points`,
    );
  return { closed, points };
}
