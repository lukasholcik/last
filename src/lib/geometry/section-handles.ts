import {
  InputError,
  type SectionHandleInput,
  type SectionHandleVector,
  type NativeSectionCurveId,
  type BaseLastState,
  type SectionModel,
} from "./types";
import { record, keys } from "./contour";
import { number } from "./math";
import { sectionControlFrame } from "./section-frame";

export const NATIVE_SECTION_CURVES: readonly NativeSectionCurveId[] = [
  "rear_cap_lower",
  "rear_cap_upper",
  "toe_cap",
  "roof_front_to_waist",
  "roof_waist_to_ball",
];
export function parseSectionHandles(value: unknown): SectionHandleInput {
  if (
    !record(value) ||
    Object.keys(value).some(
      (k) => !NATIVE_SECTION_CURVES.includes(k as NativeSectionCurveId),
    )
  )
    throw new InputError("section_handles contains unknown native curve IDs");
  const result: SectionHandleInput = {};
  for (const id of NATIVE_SECTION_CURVES) {
    if (!Object.hasOwn(value, id)) continue;
    const entry = value[id];
    if (
      !record(entry) ||
      Object.keys(entry).some((k) => k !== "control1" && k !== "control2")
    )
      throw new InputError(
        "native section handles allow only control1 and control2",
      );
    const parsed: NonNullable<SectionHandleInput[NativeSectionCurveId]> = {};
    for (const control of ["control1", "control2"] as const) {
      if (!Object.hasOwn(entry, control)) continue;
      const v = entry[control];
      if (!record(v) || !keys(v, ["tangent_ratio", "normal_ratio"]))
        throw new InputError(
          "section handle requires tangent_ratio and normal_ratio",
        );
      parsed[control] = {
        tangent_ratio: number(
          "section tangent ratio",
          v.tangent_ratio,
          -Number.MAX_VALUE,
          Number.MAX_VALUE,
        ),
        normal_ratio: number(
          "section normal ratio",
          v.normal_ratio,
          -Number.MAX_VALUE,
          Number.MAX_VALUE,
        ),
      };
    }
    result[id] = parsed;
  }
  return result;
}
export function hasSectionControl(
  input: BaseLastState["inputs"],
  id: NativeSectionCurveId,
  control: 1 | 2,
) {
  return !!input.section_handles?.[id]?.[
    control === 1 ? "control1" : "control2"
  ];
}
export function applySectionHandles(
  base: Pick<BaseLastState, "inputs" | "models" | "resolved">,
  model: SectionModel,
) {
  if (!base.inputs.section_handles) return;
  const state = { ...base, models: { ...base.models, section: model } },
    F = base.inputs.foot.length;
  for (const id of NATIVE_SECTION_CURVES)
    for (const control of [1, 2] as const) {
      const v: SectionHandleVector | undefined =
        base.inputs.section_handles[id]?.[
          control === 1 ? "control1" : "control2"
        ];
      if (!v) continue;
      const frame = sectionControlFrame(state, id, control),
        piece = model.boundary.find((p) => p.name === id);
      if (piece?.kind !== "cubic")
        throw new InputError("native section override source is unavailable");
      piece.points[control] = [
        number(
          "native handle y",
          frame.anchor[0] +
            F * (v.tangent_ratio * frame.t[0] + v.normal_ratio * frame.n[0]),
          -10000,
        ),
        number(
          "native handle z",
          frame.anchor[1] +
            F * (v.tangent_ratio * frame.t[1] + v.normal_ratio * frame.n[1]),
          -10000,
        ),
      ];
    }
}
