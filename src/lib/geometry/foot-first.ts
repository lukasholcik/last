import {
  InputError,
  SIDES,
  REGIONS,
  type FootFirstInput,
  type LastState,
  type BaseLastState,
  type Station,
  type TopModel,
  type ValidationReport,
  type Vec2,
} from "./types";
import { number, gap, sum, arcLengthBounds, ulp, nextafter } from "./math";
import {
  STATIONS,
  record,
  keys,
  jsonValues,
  solveBottom,
  createStationEvaluator,
  arcToY,
} from "./contour";
import { buildTop, validateTop } from "./top";
import { bottomCurvePoints, validateBottom } from "./bottom";
import {
  parseLastOutline,
  buildLastOutline,
  validateLastOutline,
  hasLastOutlineEdits,
  lastAnchorTarget,
} from "./last-outline";
import { parseSectionHandles } from "./section-handles";
import { parseCrossSections } from "./cross-section-input";

type Resolved = LastState["resolved"];

function object(value: unknown, names: readonly string[], label: string) {
  if (!record(value) || !keys(value, names))
    throw new InputError(`${label} requires exactly ${names.join(", ")}`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string")
    throw new InputError(`${label} must be a string`);
  return value;
}
function ratio(value: unknown, label: string): number {
  // Ratios have no .01 floor: dimensional guards apply after resolving units.
  return number(label, value, 0, Number.MAX_VALUE);
}

export function parseFootFirstInput(value: unknown): FootFirstInput {
  jsonValues(value);
  if (
    record(value) &&
    (value.schema_version === 1 ||
      value.schema_version === 2 ||
      value.schema_version === 3 ||
      "top" in value ||
      "bottom" in value)
  )
    throw new InputError(
      "Legacy schema 1/2/3 input is not supported; use foot_first_last schema_version 4 with explicit shape controls",
    );
  const root = object(
    value,
    [
      "schema_version",
      "kind",
      "units",
      "description",
      "reference",
      "foot",
      "template",
      "design",
      "pose",
      "centre_section",
      ...(record(value) && Object.hasOwn(value, "last_outline")
        ? ["last_outline"]
        : []),
      ...(record(value) && Object.hasOwn(value, "section_handles")
        ? ["section_handles"]
        : []),
      ...(record(value) && Object.hasOwn(value, "cross_sections")
        ? ["cross_sections"]
        : []),
    ],
    "foot_first_last",
  );
  if (
    root.schema_version !== 4 ||
    root.kind !== "foot_first_last" ||
    root.units !== "mm"
  )
    throw new InputError("Expected foot_first_last schema_version 4, units mm");
  const reference = object(
    root.reference,
    [
      "provenance",
      "description",
      "width_definition",
      "foot_length",
      "foot_width",
    ],
    "reference",
  );
  if (
    reference.provenance !== "synthetic" &&
    reference.provenance !== "measured"
  )
    throw new InputError("reference.provenance must be synthetic or measured");
  const foot = object(root.foot, ["length", "width"], "foot");
  const template = object(root.template, STATIONS, "template");
  const templateEntries = STATIONS.map((name) => {
    const station = object(
      template[name],
      ["station_ratio", "side_extent_ratio"],
      `template.${name}`,
    );
    return [
      name,
      {
        station_ratio: ratio(station.station_ratio, `${name}.station_ratio`),
        side_extent_ratio: ratio(
          station.side_extent_ratio,
          `${name}.side_extent_ratio`,
        ),
      },
    ] as const;
  });
  const design = object(
    root.design,
    [
      "toe_extension_ratio",
      "seat_arc_ratio",
      "blend_arc_ratio",
      "bend_radius_ratio",
      "arch_start_reach_ratio",
      "arch_contact_reach_ratio",
    ],
    "design",
  );
  const pose = object(
    root.pose,
    ["heel_height", "toe_spring", "seat_inclination_deg"],
    "pose",
  );
  const parsed: FootFirstInput = {
    schema_version: 4,
    kind: "foot_first_last",
    units: "mm",
    description: text(root.description, "description"),
    reference: {
      provenance: reference.provenance,
      description: text(reference.description, "reference.description"),
      width_definition: text(
        reference.width_definition,
        "reference.width_definition",
      ),
      foot_length: number("reference.foot_length", reference.foot_length, 0.01),
      foot_width: number("reference.foot_width", reference.foot_width, 0.01),
    },
    foot: {
      length: number("foot.length", foot.length, 0.01),
      width: number("foot.width", foot.width, 0.01),
    },
    // All eight keys were checked above; no unchecked authored keys are copied.
    template: Object.fromEntries(templateEntries) as FootFirstInput["template"],
    design: {
      toe_extension_ratio: ratio(
        design.toe_extension_ratio,
        "toe_extension_ratio",
      ),
      seat_arc_ratio: ratio(design.seat_arc_ratio, "seat_arc_ratio"),
      blend_arc_ratio: ratio(design.blend_arc_ratio, "blend_arc_ratio"),
      bend_radius_ratio: ratio(design.bend_radius_ratio, "bend_radius_ratio"),
      arch_start_reach_ratio: ratio(
        design.arch_start_reach_ratio,
        "arch_start_reach_ratio",
      ),
      arch_contact_reach_ratio: ratio(
        design.arch_contact_reach_ratio,
        "arch_contact_reach_ratio",
      ),
    },
    pose: {
      heel_height: number("heel_height", pose.heel_height),
      toe_spring: number("toe_spring", pose.toe_spring),
      seat_inclination_deg: number(
        "seat_inclination_deg",
        pose.seat_inclination_deg,
        -90,
        90,
      ),
    },
    centre_section: (() => {
      const fields = [
        "top_rear_station_ratio",
        "top_front_station_ratio",
        "toe_roof_station_ratio",
        "top_front_height_ratio",
        "waist_height_ratio",
        "ball_height_ratio",
        "toe_roof_height_ratio",
        "heel_leave_outward_deg",
        "heel_bulge_ratio",
        "instep_front_handle_ratio",
        "instep_waist_handle_ratio",
        "instep_front_down_offset_deg",
        "instep_waist_down_offset_deg",
      ] as const;
      const section = object(root.centre_section, fields, "centre_section");
      return {
        top_rear_station_ratio: ratio(
          section.top_rear_station_ratio,
          "centre_section.top_rear_station_ratio",
        ),
        top_front_station_ratio: ratio(
          section.top_front_station_ratio,
          "centre_section.top_front_station_ratio",
        ),
        toe_roof_station_ratio: ratio(
          section.toe_roof_station_ratio,
          "centre_section.toe_roof_station_ratio",
        ),
        top_front_height_ratio: ratio(
          section.top_front_height_ratio,
          "centre_section.top_front_height_ratio",
        ),
        waist_height_ratio: ratio(
          section.waist_height_ratio,
          "centre_section.waist_height_ratio",
        ),
        ball_height_ratio: ratio(
          section.ball_height_ratio,
          "centre_section.ball_height_ratio",
        ),
        toe_roof_height_ratio: ratio(
          section.toe_roof_height_ratio,
          "centre_section.toe_roof_height_ratio",
        ),
        heel_leave_outward_deg: number(
          "heel_leave_outward_deg",
          section.heel_leave_outward_deg,
          0,
          90,
        ),
        heel_bulge_ratio: ratio(section.heel_bulge_ratio, "heel_bulge_ratio"),
        instep_front_handle_ratio: ratio(
          section.instep_front_handle_ratio,
          "instep_front_handle_ratio",
        ),
        instep_waist_handle_ratio: ratio(
          section.instep_waist_handle_ratio,
          "instep_waist_handle_ratio",
        ),
        instep_front_down_offset_deg: number(
          "instep_front_down_offset_deg",
          section.instep_front_down_offset_deg,
          -180,
          180,
        ),
        instep_waist_down_offset_deg: number(
          "instep_waist_down_offset_deg",
          section.instep_waist_down_offset_deg,
          -180,
          180,
        ),
      };
    })(),
  };
  if (Object.hasOwn(root, "last_outline"))
    parsed.last_outline = parseLastOutline(root.last_outline);
  if (Object.hasOwn(root, "section_handles"))
    parsed.section_handles = parseSectionHandles(root.section_handles);
  if (Object.hasOwn(root, "cross_sections"))
    parsed.cross_sections = parseCrossSections(root.cross_sections);
  if (parsed.pose.seat_inclination_deg >= 90)
    throw new InputError("seat_inclination_deg must be less than 90");
  const rs = parsed.design.arch_start_reach_ratio,
    rc = parsed.design.arch_contact_reach_ratio;
  if (!(rs > 0 && rs < 1 && rc > 0 && rc < 1 && rs + rc <= 1))
    throw new InputError(
      "arch reach fractions must be >0, <1 and sum to at most 1",
    );
  if (parsed.centre_section.heel_leave_outward_deg >= 90)
    throw new InputError("heel outward angle must be less than 90 degrees");
  number(
    "resolved heel bulge",
    parsed.centre_section.heel_bulge_ratio * parsed.foot.length,
  );
  for (const name of [
    "instep_front_handle_ratio",
    "instep_waist_handle_ratio",
  ] as const) {
    const reach = number(
      name + " resolved length",
      parsed.centre_section[name] * parsed.foot.length,
    );
    if (!gap(reach))
      throw new InputError("instep handle lengths must retain 0.01 mm");
  }
  resolveFootFirst(parsed);
  const F = parsed.foot.length,
    section = parsed.centre_section;
  const c = section.top_rear_station_ratio * F;
  const a = section.top_front_station_ratio * F;
  const M = parsed.template.medial_waist.station_ratio * F;
  const A = parsed.template.medial_ball.station_ratio * F;
  const b = section.toe_roof_station_ratio * F;
  const stations = [0, c, a, M, A, b, F];
  if (
    stations
      .slice(1)
      .some((s, i) => !Number.isFinite(s) || !gap(s - stations[i]!)) ||
    !gap(b - A - parsed.design.blend_arc_ratio * F)
  )
    throw new InputError(
      "centre_section requires 0 < c < a < medial waist < medial ball < b < F and A+J < b with 0.01 mm gaps",
    );
  for (const field of [
    "top_front_height_ratio",
    "waist_height_ratio",
    "ball_height_ratio",
    "toe_roof_height_ratio",
  ] as const) {
    const height = number(
      `centre_section.${field} resolved height`,
      section[field] * F,
    );
    if (!gap(height))
      throw new InputError(
        "centre_section heights must retain 0.01 mm resolved depth",
      );
  }
  return parsed;
}

/** Virtual allowance hinge only: it does not prescribe actual waist curvature. */
export function solvePosture(anchor: number, radius: number, height: number) {
  if (
    !Number.isFinite(anchor) ||
    anchor <= 0 ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    !Number.isFinite(anchor + radius) ||
    !Number.isFinite(height) ||
    height < 0 ||
    height >= anchor + radius
  )
    throw new InputError(
      "heel_height must satisfy 0 <= H < medial_ball reference station + effective radius",
    );
  if (height === 0) return { angle: 0, allowance: 0 };
  if (radius === 0) return { angle: Math.asin(height / anchor), allowance: 0 };
  // Since the radius term is nonnegative, asin(H/A) is an upper bound
  // whenever H<A. This also avoids an absolute angular floor for tiny H.
  let lo = 0,
    hi = height < anchor ? Math.asin(height / anchor) : Math.PI / 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const rise = anchor * Math.sin(mid) + 2 * radius * Math.sin(mid / 2) ** 2;
    if (rise < height) lo = mid;
    else hi = mid;
  }
  let angle = (lo + hi) / 2;
  if (angle === Math.PI / 2) {
    // A strictly interior height can round the final average onto the excluded
    // angle endpoint. Use the adjacent interior float only if its forward
    // residual is arithmetic-scale; the strict height domain above still holds.
    const interior = nextafter(Math.PI / 2, 0);
    const rise =
      anchor * Math.sin(interior) + 2 * radius * Math.sin(interior / 2) ** 2;
    const budget = 8 * (ulp(anchor) + ulp(radius) + ulp(height));
    if (!Number.isFinite(rise) || Math.abs(rise - height) > budget)
      throw new InputError(
        "posture endpoint cannot satisfy height within arithmetic roundoff",
      );
    angle = interior;
  }
  if (!(angle < Math.PI / 2))
    throw new InputError("posture angle is outside the finite hinge domain");
  return { angle, allowance: radius * angle };
}

export function resolveFootFirst(input: FootFirstInput): Resolved {
  const F = input.foot.length,
    W = input.foot.width;
  for (const side of SIDES) {
    const stations = [
      0,
      ...REGIONS.map(
        (region) => input.template[`${side}_${region}`].station_ratio * F,
      ),
      F,
    ];
    if (stations.slice(1).some((station, i) => !gap(station - stations[i]!)))
      throw new InputError(
        `${side} reference foot stations must be ordered within foot.length with 0.01 mm gaps`,
      );
  }
  for (const name of STATIONS)
    number(
      `${name} resolved side extent`,
      input.template[name].side_extent_ratio * W,
      0.01,
    );
  const extension = number(
    "resolved toe extension",
    input.design.toe_extension_ratio * W,
  );
  const last = number("reference last length", F + extension, 0.01);
  const anchor = number(
    "medial_ball reference station",
    input.template.medial_ball.station_ratio * F,
    0.01,
  );
  const radius = number("effective radius", input.design.bend_radius_ratio * F);
  const seat = number("seat arc length", input.design.seat_arc_ratio * F);
  const blend = number("blend arc length", input.design.blend_arc_ratio * F);
  if (![seat, anchor - seat, blend, F - anchor - blend].every(gap))
    throw new InputError(
      "Require positive seat, waist, blend and foot forepart spans with 0.01 mm resolved gaps; S < A and A+J < F",
    );
  const { angle, allowance } = solvePosture(
    anchor,
    radius,
    input.pose.heel_height,
  );
  return {
    foot_length: F,
    foot_width: W,
    toe_extension: extension,
    reference_last_length: last,
    bend_station: anchor,
    effective_radius: radius,
    bend_angle_rad: angle,
    posture_allowance: allowance,
    posed_last_length: number("posed last length", last + allowance, 0.01),
    seat_arc_length: seat,
    waist_arc_length: anchor - seat + allowance,
    blend_arc_length: blend,
    ramp_arc_length: last - anchor - blend,
    contact_s: anchor + allowance,
  };
}

export function referenceToPosed(station: number, resolved: Resolved): number {
  if (
    !Number.isFinite(station) ||
    station < 0 ||
    station > resolved.reference_last_length
  )
    throw new InputError("reference station is outside the reference last");
  const {
    seat_arc_length: seat,
    bend_station: anchor,
    posture_allowance: allowance,
  } = resolved;
  if (station <= seat) return station;
  if (station >= anchor) return station + allowance;
  const t = (station - seat) / (anchor - seat);
  return station + allowance * t * t * (3 - 2 * t);
}

function referenceModel(
  input: FootFirstInput,
  length: number,
  role: "foot" | "last",
) {
  const dimensions: Record<string, number> = { length };
  for (const name of STATIONS) {
    dimensions[`${name}_y`] =
      input.template[name].station_ratio * input.foot.length;
    dimensions[`${name}_width`] =
      input.template[name].side_extent_ratio * input.foot.width;
  }
  const model = buildTop(dimensions);
  model.source = `Parametric reference ${role}; unbent y is reference_s. Template inferred from named ratios, not a measured tracing or posed projection.`;
  model.dimensions.length!.definition =
    role === "foot"
      ? "Working reference foot length F; source observations remain separate"
      : "Unbent reference last length F+E; excludes posture allowance";
  for (const dimension of Object.values(model.dimensions))
    if (dimension.kind === "side_extent")
      dimension.definition =
        "Positive x extent at reference_s (stored as station_y), scaled from working foot.width; not a total section width";
  return model;
}
function referenceReport(model: TopModel): ValidationReport {
  const report = validateTop(model, model.design);
  report.limits.unshift(
    "Reference station y is intrinsic and pose-independent. The working foot width is a proportional basis, not a promise of actual full section width.",
  );
  return report;
}

/** Validate final public models, resolved targets and correspondence, not a replaced helper model. */
export function validateFootFirst(
  state: Pick<BaseLastState, "models" | "resolved" | "derived">,
  input: FootFirstInput,
): ValidationReport {
  const expected = resolveFootFirst(input);
  const curves = state.models.bottom.profile.map((name) =>
    bottomCurvePoints(state.models.bottom, name),
  );
  const bounds = curves.map((p) => arcLengthBounds(p, 1e-5));
  const lengths = bounds.map(([lo, hi]) => (lo + hi) / 2);
  const supportsTargetArc =
    Math.abs(sum(lengths) - expected.posed_last_length) +
      sum(bounds.map(([lo, hi]) => (hi - lo) / 2)) <=
    0.01;
  // An invalid final guide is a failed report, not a parser exception caused by
  // attempting an inverse outside its actual arc domain.
  const atStation = supportsTargetArc
    ? createStationEvaluator(curves, expected.posed_last_length)
    : null;
  const cache = new Map<number, Vec2>();
  const checks: ValidationReport["checks"] = [];
  const check = (
    name: string,
    actual: number,
    target: number,
    error = 0,
    tolerance = 0.01,
    units = "mm",
  ) => {
    checks.push({
      name,
      actual,
      expected: target,
      tolerance,
      uncertainty_mm: error,
      units,
      passed:
        Number.isFinite(actual) &&
        Math.abs(actual - target) + error <= tolerance,
    });
  };
  for (const [name, target] of Object.entries(expected))
    check(
      `resolved_${name}`,
      state.resolved[name as keyof Resolved],
      target,
      0,
      name === "bend_angle_rad" ? 1e-12 : 0.01,
      name === "bend_angle_rad" ? "rad" : "mm",
    );
  const targets = [
    expected.seat_arc_length,
    expected.waist_arc_length,
    expected.blend_arc_length,
    expected.ramp_arc_length,
  ];
  const names = [
    "seat_arc_length",
    "waist_arc_length",
    "blend_arc_length",
    "ramp_arc_length",
  ];
  targets.forEach((target, i) =>
    check(names[i]!, lengths[i]!, target, (bounds[i]![1] - bounds[i]![0]) / 2),
  );
  const uncertainty = (count: number) =>
    sum(bounds.slice(0, count).map(([lo, hi]) => (hi - lo) / 2));
  check(
    "posed_last_length",
    sum(lengths),
    expected.posed_last_length,
    uncertainty(4),
  );
  check(
    "guide_supports_target_arc_domain",
    Number(supportsTargetArc),
    1,
    0,
    0,
    "boolean",
  );
  check(
    "contact_s",
    sum(lengths.slice(0, 2)),
    expected.contact_s,
    uncertainty(2),
  );
  check(
    "blend_end_s",
    sum(lengths.slice(0, 3)),
    expected.contact_s + expected.blend_arc_length,
    uncertainty(3),
  );
  check(
    "virtual_hinge_height",
    state.resolved.bend_station * Math.sin(state.resolved.bend_angle_rad) +
      2 *
        state.resolved.effective_radius *
        Math.sin(state.resolved.bend_angle_rad / 2) ** 2,
    input.pose.heel_height,
  );
  check(
    "foot_reference_length",
    state.models.foot.points.toe_tip!.y - state.models.foot.points.heel_tip!.y,
    expected.foot_length,
  );
  check(
    "last_reference_length",
    state.models.top.points.toe_tip!.y - state.models.top.points.heel_tip!.y,
    expected.reference_last_length,
  );
  const bottom = state.models.bottom.points;
  check(
    "projected_length",
    state.derived.projected_length,
    bottom.bottom_toe_end!.y - bottom.bottom_heel_rear!.y,
  );
  check(
    "bottom_seat_station",
    state.derived.bottom_stations.seat_s,
    expected.seat_arc_length,
  );
  check(
    "bottom_contact_station",
    state.derived.bottom_stations.contact_s,
    expected.contact_s,
  );
  check(
    "bottom_blend_end_station",
    state.derived.bottom_stations.blend_end_s,
    expected.contact_s + expected.blend_arc_length,
  );
  for (const name of STATIONS) {
    const reference = input.template[name].station_ratio * input.foot.length;
    const posed = referenceToPosed(reference, expected);
    const entry = state.derived.station_map[name];
    const x =
      (name.startsWith("medial") ? -1 : 1) *
      input.template[name].side_extent_ratio *
      input.foot.width;
    for (const role of ["foot", "top"] as const) {
      const own =
        role === "top" ? lastAnchorTarget(input, name) : [x, reference];
      check(
        `${role}_${name}_reference_station`,
        state.models[role].points[name]!.y,
        own[1]!,
      );
      check(
        `${role}_${name}_side_extent`,
        state.models[role].points[name]!.x,
        own[0]!,
      );
    }
    check(`${name}_reference_s`, entry.reference_s, reference);
    check(`${name}_posed_s`, entry.posed_s, posed);
    if (atStation) {
      if (!cache.has(posed)) cache.set(posed, atStation(posed));
      const [y, z] = cache.get(posed)!;
      check(`${name}_posed_y`, entry.y, y);
      check(`${name}_posed_z`, entry.z, z);
    }
    check(
      `${name}_station_roundtrip`,
      arcToY(curves, lengths, entry.y),
      posed,
      4e-5,
    );
  }
  return {
    passed: checks.every((check) => check.passed),
    checks,
    units: "mm",
    last_length_bounds: {
      lower: sum(bounds.map(([lo]) => lo)),
      upper: sum(bounds.map(([, hi]) => hi)),
    },
    limits: [
      "Virtual-hinge radius and added arc are prototype allowance heuristics, not anatomical measurements or a literal circular bottom curve.",
      "Allowance is assigned only to the seat-to-medial-ball waist budget; the four final cubic curves are independently measured.",
      "Reference foot and last remain unbent; the C1 station correspondence is display placement, not skin strain, a last surface or a fit guarantee.",
    ],
  };
}

export function buildFootFirst(
  input: FootFirstInput,
): Omit<BaseLastState, "display"> {
  const resolved = resolveFootFirst(input);
  const foot = referenceModel(input, resolved.foot_length, "foot");
  const top = buildLastOutline(
    input,
    referenceModel(input, resolved.reference_last_length, "last"),
  );
  const effectiveSeatAngle =
    (resolved.bend_angle_rad * 180) / Math.PI + input.pose.seat_inclination_deg;
  if (effectiveSeatAngle < 0)
    throw new InputError(
      "actual rear sole angle theta + seat offset must be nonnegative (>= 0 degrees)",
    );
  if (effectiveSeatAngle >= 90)
    throw new InputError(
      "actual rear sole angle theta + seat offset must be less than 90 degrees",
    );
  const [bottom, projectedLength, bottomInputs] = solveBottom(
    resolved.posed_last_length,
    {
      ...input.pose,
      seat_inclination_deg: effectiveSeatAngle,
      seat_arc_length: resolved.seat_arc_length,
      contact_s: resolved.contact_s,
      blend_arc_length: resolved.blend_arc_length,
      arch_start_reach_ratio: input.design.arch_start_reach_ratio,
      arch_contact_reach_ratio: input.design.arch_contact_reach_ratio,
    },
  );
  bottom.source =
    "Posed four-cubic allowance-only guide; effective radius determines added arc, not the rendered curvature. Not foot measurements or a last surface.";
  bottom.dimensions.projected_length!.definition =
    "Calculated posed-bottom forward span, independent of the intrinsic reference foot/last lengths; not an authored target";
  const bottomReport = validateBottom(bottom, projectedLength, bottomInputs);
  bottomReport.limits = bottomReport.limits.map((limit) =>
    limit.startsWith("Shared top length")
      ? "Posed contour includes the heuristic waist allowance; its forward span is separate from reference foot and last lengths."
      : limit,
  );
  const curves = bottom.profile.map((name) => bottomCurvePoints(bottom, name));
  const atStation = createStationEvaluator(curves, resolved.posed_last_length);
  const cache = new Map<number, Vec2>();
  const entries = STATIONS.map((name) => {
    const reference_s = input.template[name].station_ratio * input.foot.length;
    const posed_s = referenceToPosed(reference_s, resolved);
    if (!cache.has(posed_s)) cache.set(posed_s, atStation(posed_s));
    const [y, z] = cache.get(posed_s)!;
    return [name, { reference_s, posed_s, y, z }] as const;
  });
  const models = { foot, top, bottom };
  const derived = {
    projected_length: projectedLength,
    station_map: Object.fromEntries(entries) as Record<
      Station,
      { reference_s: number; posed_s: number; y: number; z: number }
    >,
    bottom_stations: {
      seat_s: resolved.seat_arc_length,
      contact_s: resolved.contact_s,
      blend_end_s: resolved.contact_s + resolved.blend_arc_length,
    },
  };
  return {
    inputs: structuredClone(input),
    models,
    resolved,
    derived,
    reports: {
      foot: referenceReport(foot),
      top: hasLastOutlineEdits(input)
        ? validateLastOutline(top, input)
        : referenceReport(top),
      bottom: bottomReport,
      contour: validateFootFirst({ models, resolved, derived }, input),
    },
  };
}
