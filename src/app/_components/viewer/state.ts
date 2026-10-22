import type {
  BottomControls,
  ContourInput,
  LastState,
  TopControls,
} from "~/lib/geometry/types";

export type Draft = Record<string, string>;
export type Phase = "loading" | "busy" | "dirty" | "valid" | "error";
export const sides = ["medial", "lateral"] as const;
export const regions = ["heel", "waist", "ball", "toe"] as const;
export const bottomFields = [
  ["heel_height", "Rear heel height", "mm"],
  ["toe_spring", "Toe spring height", "mm"],
  ["seat_arc_length", "Seat contour length", "mm"],
  ["seat_inclination_deg", "Seat inclination", "deg"],
  ["contact_s", "Contact contour station", "mm"],
  ["blend_arc_length", "Contact blend contour length", "mm"],
] as const satisfies ReadonlyArray<
  readonly [keyof BottomControls, string, string]
>;

export function fmt(v: unknown): string {
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (typeof v !== "number") return "—";
  if (v !== 0 && (Math.abs(v) < 0.001 || Math.abs(v) >= 1e6)) {
    return v.toExponential(5).replace(/\.?0+e/, "e");
  }
  return Number(v.toFixed(4)).toString();
}

export function toDraft(input: ContourInput): Draft {
  const draft: Draft = {
    "shared-last_length": String(input.design.last_length),
  };
  for (const [key, value] of Object.entries(input.design.top))
    draft[`top-${key}`] = String(value);
  for (const [key, value] of Object.entries(input.design.bottom))
    draft[`bottom-${key}`] = String(value);
  return draft;
}

export class DraftError extends Error {
  constructor(
    public readonly fieldId: string,
    label: string,
  ) {
    super(`Enter a finite number for ${label}.`);
  }
}

export function parseDraft(base: ContourInput, draft: Draft): ContourInput {
  const result = structuredClone(base);
  const number = (id: string, label: string) => {
    const text = draft[id];
    if (!text?.trim() || !Number.isFinite(Number(text))) {
      throw new DraftError(id, label);
    }
    return Number(text);
  };
  result.design.last_length = number(
    "shared-last_length",
    "Last length along bottom profile",
  );
  for (const key of Object.keys(base.design.top) as Array<keyof TopControls>) {
    result.design.top[key] = number(`top-${key}`, key.replaceAll("_", " "));
  }
  for (const [key, label] of bottomFields)
    result.design.bottom[key] = number(`bottom-${key}`, label);
  return result;
}

export interface Ticket {
  request: number;
  revision: number;
}
/** Request identity and edit identity are separate: editing back still invalidates a response. */
export class RequestGate {
  private request = 0;
  private revision = 0;
  edit() {
    this.revision++;
  }
  begin(): Ticket {
    return { request: ++this.request, revision: this.revision };
  }
  latest(ticket: Ticket) {
    return ticket.request === this.request;
  }
  accepts(ticket: Ticket) {
    return this.latest(ticket) && ticket.revision === this.revision;
  }
  invalidate() {
    this.request++;
  }
}

export function passingResult(result: LastState): boolean {
  return (
    result.reports.top.passed &&
    result.reports.bottom.passed &&
    result.reports.contour.passed
  );
}

export function viewState(phase: Phase, hasResult: boolean) {
  return phase === "valid"
    ? "Current rebuilt geometry"
    : hasResult
      ? "LAST VALID GEOMETRY · not the current inputs"
      : "No rebuilt geometry yet";
}
