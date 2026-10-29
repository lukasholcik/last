import type { FootFirstInput, LastState, Station } from "~/lib/geometry/types";

export type Draft = Record<string, string>;
export type Phase = "loading" | "busy" | "dirty" | "valid" | "error";
export const sides = ["medial", "lateral"] as const;
export const regions = ["heel", "waist", "ball", "toe"] as const;
export const poseFields = [
  ["heel_height", "Heel rise above support", "mm"],
  ["toe_spring", "Toe spring height", "mm"],
  ["seat_inclination_deg", "Rear sole angle offset", "deg"],
] as const satisfies ReadonlyArray<
  readonly [keyof FootFirstInput["pose"], string, string]
>;
export const designFields = [
  ["toe_extension_ratio", "Toe extension", "W"],
  ["seat_arc_ratio", "Seat contour", "F"],
  ["blend_arc_ratio", "Contact blend", "F"],
  ["bend_radius_ratio", "Effective bend radius", "F"],
] as const satisfies ReadonlyArray<
  readonly [keyof FootFirstInput["design"], string, "F" | "W"]
>;
export const sectionFields = [
  ["top_rear_station_ratio", "Top cut rear station", "station"],
  ["top_front_station_ratio", "Top cut front station", "station"],
  ["toe_roof_station_ratio", "Toe roof station", "station"],
  ["top_front_height_ratio", "Top cut front depth", "depth"],
  ["waist_height_ratio", "Waist roof depth", "depth"],
  ["ball_height_ratio", "Ball roof depth", "depth"],
  ["toe_roof_height_ratio", "Toe roof depth", "depth"],
] as const satisfies ReadonlyArray<
  readonly [keyof FootFirstInput["centre_section"], string, "station" | "depth"]
>;
export const archFields = [
  ["arch_start_reach_ratio", "Arch start handle reach"],
  ["arch_contact_reach_ratio", "Contact handle reach"],
] as const satisfies ReadonlyArray<
  readonly [keyof FootFirstInput["design"], string]
>;
export const profileShapeFields = [
  ["heel_leave_outward_deg", "Heel outward departure", "deg", "heel"],
  ["heel_bulge_ratio", "Heel middle bulge", "F", "heel"],
  ["instep_front_handle_ratio", "Front handle length", "F", "instep"],
  ["instep_waist_handle_ratio", "Shared waist handle length", "F", "instep"],
  [
    "instep_front_down_offset_deg",
    "Front tangent down-offset",
    "deg",
    "instep",
  ],
  [
    "instep_waist_down_offset_deg",
    "Waist tangent down-offset",
    "deg",
    "instep",
  ],
] as const satisfies ReadonlyArray<
  readonly [
    keyof FootFirstInput["centre_section"],
    string,
    "deg" | "F",
    "heel" | "instep",
  ]
>;

export function fmt(v: unknown): string {
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (typeof v !== "number") return "—";
  if (v !== 0 && (Math.abs(v) < 0.001 || Math.abs(v) >= 1e6)) {
    return v.toExponential(5).replace(/\.?0+e/, "e");
  }
  return Number(v.toFixed(4)).toString();
}

const percent = (value: number) =>
  String(Number((value * 100).toPrecision(15)));

export function toDraft(input: FootFirstInput): Draft {
  const draft: Draft = {
    "foot-length": String(input.foot.length),
    "foot-width": String(input.foot.width),
  };
  for (const [station, rule] of Object.entries(input.template)) {
    draft[`template-${station}-station_ratio`] = percent(rule.station_ratio);
    draft[`template-${station}-side_extent_ratio`] = percent(
      rule.side_extent_ratio,
    );
  }
  for (const [key, value] of Object.entries(input.design))
    draft[`design-${key}`] = percent(value);
  for (const [key, value] of Object.entries(input.pose))
    draft[`pose-${key}`] = String(value);
  for (const [key] of sectionFields)
    draft[`section-${key}`] = percent(input.centre_section[key]);
  for (const [key, , basis] of profileShapeFields)
    draft[`section-${key}`] =
      basis === "deg"
        ? String(input.centre_section[key])
        : percent(input.centre_section[key]);
  return draft;
}

export class DraftError extends Error {
  constructor(
    public readonly fieldId: string,
    label: string,
    message = `Enter a finite number for ${label}.`,
  ) {
    super(message);
  }
}

export function parseDraft(base: FootFirstInput, draft: Draft): FootFirstInput {
  const result = structuredClone(base);
  const number = (id: string, label: string) => {
    const text = draft[id];
    if (!text?.trim() || !Number.isFinite(Number(text))) {
      throw new DraftError(id, label);
    }
    return Number(text);
  };
  const ratio = (id: string, label: string, original: number) => {
    const value = number(id, label);
    // Preserve exact authored fractions (notably 1/3) when their displayed value is unchanged.
    return draft[id] === percent(original) ? original : value / 100;
  };
  result.foot.length = number("foot-length", "working foot length F");
  result.foot.width = number("foot-width", "reference width basis W");
  for (const station of Object.keys(base.template) as Station[]) {
    result.template[station].station_ratio = ratio(
      `template-${station}-station_ratio`,
      `${station} station percentage of F`,
      base.template[station].station_ratio,
    );
    result.template[station].side_extent_ratio = ratio(
      `template-${station}-side_extent_ratio`,
      `${station} side extent percentage of W`,
      base.template[station].side_extent_ratio,
    );
  }
  for (const [key, label] of designFields)
    result.design[key] = ratio(`design-${key}`, label, base.design[key]);
  for (const [key, label] of archFields)
    result.design[key] = ratio(`design-${key}`, label, base.design[key]);
  for (const [key, label] of poseFields)
    result.pose[key] = number(`pose-${key}`, label);
  for (const [key, label] of sectionFields)
    result.centre_section[key] = ratio(
      `section-${key}`,
      label,
      base.centre_section[key],
    );
  for (const [key, label, basis] of profileShapeFields)
    result.centre_section[key] =
      basis === "deg"
        ? number(`section-${key}`, label)
        : ratio(`section-${key}`, label, base.centre_section[key]);
  return result;
}

/** Display-unit arithmetic from the accepted result, not a client posture solver. */
export function profileAngles(
  result: {
    inputs: Pick<FootFirstInput, "pose" | "centre_section">;
    resolved: Pick<LastState["resolved"], "bend_angle_rad">;
  } | null,
) {
  if (!result) return undefined;
  const rearSole =
    (result.resolved.bend_angle_rad * 180) / Math.PI +
    result.inputs.pose.seat_inclination_deg;
  return {
    rearSole,
    instepFront:
      rearSole + result.inputs.centre_section.instep_front_down_offset_deg,
    instepWaist:
      rearSole + result.inputs.centre_section.instep_waist_down_offset_deg,
    heelCounter:
      90 - rearSole + result.inputs.centre_section.heel_leave_outward_deg,
  };
}

/** Input-unit conversion only; never substitutes for the server section geometry. */
export function draftMillimetres(
  draft: Draft,
  fieldId: string,
): number | undefined {
  const text = draft[fieldId],
    length = draft["foot-length"];
  if (!text?.trim() || !length?.trim()) return undefined;
  const value = (Number(text) * Number(length)) / 100;
  return Number.isFinite(value) ? value : undefined;
}

function physicalRatioId(id: string): string {
  if (id === "toe-extension-mm") return "design-toe_extension_ratio";
  const station = id.replace(/^extent-/, "");
  if (
    id.startsWith("extent-") &&
    sides.some((side) =>
      regions.some((region) => station === `${side}_${region}`),
    )
  )
    return `template-${station}-side_extent_ratio`;
  throw new DraftError(id, "physical dimension", "Unknown physical dimension.");
}

/** Physical form values are adapters; only existing normalized fields are authored. */
export function physicalDraftValue(draft: Draft | null, id: string): string {
  if (!draft) return "";
  const text = draft[physicalRatioId(id)],
    width = draft["foot-width"];
  if (!text?.trim() || !width?.trim()) return "";
  const value = (Number(text) * Number(width)) / 100;
  return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : "";
}

export function editPhysicalDraft(
  draft: Draft,
  id: string,
  text: string,
): Draft {
  const key = physicalRatioId(id);
  if (!text.trim()) return { ...draft, [key]: "" };
  const width = Number(draft["foot-width"]),
    value = Number(text);
  if (!draft["foot-width"]?.trim() || !Number.isFinite(width) || width <= 0)
    throw new DraftError(
      "foot-width",
      "reference width basis W",
      "Enter a positive width basis before editing extents or toe extension.",
    );
  const percentValue = (value / width) * 100;
  if (!Number.isFinite(value) || !Number.isFinite(percentValue))
    throw new DraftError(
      id,
      id === "toe-extension-mm" ? "toe extension" : "side extent",
    );
  return { ...draft, [key]: String(percentValue) };
}

/** Draft-only proportional edit. Source data, rules and pose are never rewritten. */
export function resizeDraft(draft: Draft, newLength: string): Draft {
  const positive = (text: string | undefined, id: string, label: string) => {
    const value = Number(text);
    if (!text?.trim() || !Number.isFinite(value) || value <= 0)
      throw new DraftError(
        id,
        label,
        `Enter a positive finite number for ${label}. Resize was not applied.`,
      );
    return value;
  };
  const length = positive(newLength, "resize-length", "new model length"),
    oldLength = positive(
      draft["foot-length"],
      "foot-length",
      "current working length F",
    ),
    oldWidth = positive(
      draft["foot-width"],
      "foot-width",
      "current reference width basis W",
    ),
    width = oldWidth * (length / oldLength);
  if (!Number.isFinite(width) || width <= 0)
    throw new DraftError(
      "resize-length",
      "new model length",
      "This resize produces an invalid width. Resize was not applied.",
    );
  return {
    ...draft,
    "foot-length": String(length),
    "foot-width": String(width),
  };
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

/** Recover the accepted authored shape without resetting to the example or reusing stale tickets. */
export function discardPendingDraft(
  accepted: FootFirstInput,
  gate: RequestGate,
): Draft {
  gate.edit();
  return toDraft(accepted);
}

export function passingResult(result: {
  reports: Partial<LastState["reports"]>;
}): boolean {
  return (
    result.reports.foot?.passed === true &&
    result.reports.top?.passed === true &&
    result.reports.bottom?.passed === true &&
    result.reports.contour?.passed === true &&
    result.reports.section?.passed === true
  );
}

export function viewState(phase: Phase, hasResult: boolean) {
  return phase === "valid"
    ? "LAST EXPLICIT REBUILD · matches validated 2D"
    : hasResult
      ? "LAST EXPLICIT REBUILD · out of date for editable 2D"
      : "No explicit 3D/report Rebuild yet";
}
