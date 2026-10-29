import { describe, expect, it } from "vitest";
import input from "../../examples/foot-first-baseline.json";
import type {
  FootFirstInput,
  ValidationReport,
} from "../../src/lib/geometry/types";
import {
  DraftError,
  RequestGate,
  fmt,
  draftMillimetres,
  editPhysicalDraft,
  discardPendingDraft,
  physicalDraftValue,
  archFields,
  parseDraft,
  passingResult,
  resizeDraft,
  profileAngles,
  profileShapeFields,
  sectionFields,
  toDraft,
  viewState,
} from "../../src/app/_components/viewer/state";

const baseline: FootFirstInput = {
  ...input,
  schema_version: 4,
  kind: "foot_first_last",
  units: "mm",
  reference: { ...input.reference, provenance: "synthetic" },
};

describe("viewer draft parsing", () => {
  it("round trips all 40 schema-4 authored dimensions, displaying ratios as percentages and degrees unchanged", () => {
    const before = JSON.stringify(baseline),
      draft = toDraft(baseline);
    expect(baseline).toEqual(input);
    expect(Object.keys(draft)).toHaveLength(40);
    expect(draft["template-medial_ball-station_ratio"]).toBe("70");
    expect(draft["template-medial_ball-side_extent_ratio"]).toBe("46");
    expect(draft["design-toe_extension_ratio"]).toBe("10");
    expect(draft["design-bend_radius_ratio"]).toBe("5");
    expect(draft["section-top_rear_station_ratio"]).toBe("4");
    expect(draft["section-top_front_height_ratio"]).toBe("30");
    expect(draft["section-heel_leave_outward_deg"]).toBe("10");
    expect(draft["section-instep_front_down_offset_deg"]).toBe("50");
    expect(Number(draft["design-arch_start_reach_ratio"])).toBeCloseTo(
      100 / 3,
      12,
    );
    expect(parseDraft(baseline, draft)).toEqual(baseline);
    draft["pose-heel_height"] = "80";
    expect(parseDraft(baseline, draft).pose.heel_height).toBe(80);
    expect(JSON.stringify(baseline)).toBe(before);
  });
  it.each(["", " ", "Infinity", "NaN", "not a number"])(
    "rejects %j without coercion to zero",
    (value) => {
      const draft = toDraft(baseline);
      draft["foot-length"] = value;
      expect(() => parseDraft(baseline, draft)).toThrow(DraftError);
      expect(draft["foot-length"]).toBe(value);
    },
  );
  it("preserves zero and impossible finite dimensions for authoritative server validation", () => {
    const draft = toDraft(baseline);
    draft["pose-heel_height"] = "0";
    draft["template-medial_ball-station_ratio"] = "-3";
    expect(parseDraft(baseline, draft).pose.heel_height).toBe(0);
    expect(parseDraft(baseline, draft).template.medial_ball.station_ratio).toBe(
      -0.03,
    );
  });
  it("edits F independently, preserving W, source data, pose and dimensionless rules", () => {
    const draft = toDraft(baseline);
    draft["foot-length"] = "225";
    const parsed = parseDraft(baseline, draft);
    expect(parsed.foot).toEqual({ length: 225, width: 100 });
    expect(parsed.reference).toEqual(baseline.reference);
    expect(parsed.reference).not.toBe(baseline.reference);
    expect(parsed.template).toEqual(baseline.template);
    expect(parsed.design).toEqual(baseline.design);
    expect(parsed.pose).toEqual(baseline.pose);
    expect(parsed.centre_section).toEqual(baseline.centre_section);
  });
  it("converts each percentage independently without complementary side shares", () => {
    const draft = toDraft(baseline);
    draft["template-medial_ball-station_ratio"] = "72";
    draft["template-medial_ball-side_extent_ratio"] = "48";
    draft["design-toe_extension_ratio"] = "12";
    const parsed = parseDraft(baseline, draft);
    expect(parsed.template.medial_ball).toEqual({
      station_ratio: 0.72,
      side_extent_ratio: 0.48,
    });
    expect(parsed.template.lateral_ball).toEqual(
      baseline.template.lateral_ball,
    );
    expect(parsed.design.toe_extension_ratio).toBe(0.12);
    expect(parsed.reference).toEqual(baseline.reference);
  });
  it("preserves zero and tiny valid ratio values without imposing a UI ratio floor", () => {
    const input = structuredClone(baseline);
    input.design.toe_extension_ratio = 0;
    input.design.bend_radius_ratio = 0;
    input.design.seat_arc_ratio = 0.00004;
    expect(parseDraft(input, toDraft(input))).toEqual(input);
  });
  it("never serializes a transient resize length or any derived dimensions", () => {
    const draft = {
      ...toDraft(baseline),
      "resize-length": "225",
      "posed-last-length": "999",
    };
    expect(parseDraft(baseline, draft)).toEqual(baseline);
  });
});

describe("compact physical dimension adapters", () => {
  it("preserves sparse last-anchor and independent curve overrides through draft parsing and resize", () => {
    const authored: FootFirstInput = {
      ...structuredClone(baseline),
      last_outline: {
        anchors: {
          medial_heel: { station_offset_ratio: 0.01, side_offset_ratio: -0.02 },
        },
        handles: {
          toe_tip: {
            incoming: { forward_ratio: -0.08, side_ratio: -0.12 },
            outgoing: { forward_ratio: -0.06, side_ratio: 0.1 },
          },
        },
      },
      section_handles: {
        roof_front_to_waist: {
          control1: { tangent_ratio: 0.04, normal_ratio: -0.01 },
        },
      },
    };
    const draft = resizeDraft(toDraft(authored), "225");
    const parsed = parseDraft(authored, draft);
    expect(parsed.last_outline).toEqual(authored.last_outline);
    expect(parsed.section_handles).toEqual(authored.section_handles);
    expect(parsed.reference).toEqual(authored.reference);
    expect(Object.keys(draft)).toHaveLength(40);
  });
  it("edits independent side extents in millimetres while preserving all hidden rules", () => {
    const draft = toDraft(baseline),
      before = { ...draft };
    expect(physicalDraftValue(draft, "extent-medial_heel")).toBe("28");
    const changed = editPhysicalDraft(draft, "extent-medial_heel", "32");
    expect(draft).toEqual(before);
    const parsed = parseDraft(baseline, changed);
    expect(parsed.template.medial_heel.side_extent_ratio).toBe(0.32);
    expect(parsed.template.lateral_heel).toEqual(
      baseline.template.lateral_heel,
    );
    expect(parsed.centre_section).toEqual(baseline.centre_section);
    expect(parsed.design).toEqual(baseline.design);
    expect(parsed.reference).toEqual(baseline.reference);
  });
  it("converts toe extension using W and responds to W edits without rewriting normalized rules", () => {
    const draft = toDraft(baseline);
    expect(physicalDraftValue(draft, "toe-extension-mm")).toBe("10");
    const changed = editPhysicalDraft(draft, "toe-extension-mm", "15");
    expect(parseDraft(baseline, changed).design.toe_extension_ratio).toBe(0.15);
    changed["foot-width"] = "120";
    expect(physicalDraftValue(changed, "toe-extension-mm")).toBe("18");
    expect(physicalDraftValue(changed, "extent-medial_heel")).toBe("33.6");
    expect(changed["template-medial_heel-side_extent_ratio"]).toBe(
      draft["template-medial_heel-side_extent_ratio"],
    );
  });
  it("keeps incomplete and zero physical edits truthful, without introducing authored UI fields", () => {
    const draft = toDraft(baseline);
    const empty = editPhysicalDraft(draft, "extent-medial_ball", "");
    expect(physicalDraftValue(empty, "extent-medial_ball")).toBe("");
    expect(() => parseDraft(baseline, empty)).toThrow(DraftError);
    const zero = editPhysicalDraft(draft, "toe-extension-mm", "0");
    expect(parseDraft(baseline, zero).design.toe_extension_ratio).toBe(0);
    expect(Object.keys(zero)).toHaveLength(40);
  });
  it("refuses nonfinite input or unusable W without mutating the source draft", () => {
    const draft = toDraft(baseline),
      before = { ...draft };
    expect(() =>
      editPhysicalDraft(draft, "toe-extension-mm", "Infinity"),
    ).toThrow(DraftError);
    expect(() =>
      editPhysicalDraft(
        { ...draft, "foot-width": "" },
        "extent-medial_heel",
        "30",
      ),
    ).toThrow("positive width basis");
    expect(draft).toEqual(before);
  });
});

describe("draft-only proportional resize", () => {
  it("scales F250/W100 to F225/W90 atomically without changing source, rules, or pose", () => {
    const original = JSON.stringify(baseline),
      draft = toDraft(baseline),
      before = { ...draft };
    const resized = resizeDraft(draft, "225");
    expect(resized).not.toBe(draft);
    expect(draft).toEqual(before);
    expect(resized["foot-length"]).toBe("225");
    expect(resized["foot-width"]).toBe("90");
    expect(Object.keys(resized)).toHaveLength(40);
    const parsed = parseDraft(baseline, resized);
    expect(parsed.reference).toEqual(baseline.reference);
    expect(parsed.template).toEqual(baseline.template);
    expect(parsed.design).toEqual(baseline.design);
    expect(parsed.pose).toEqual(baseline.pose);
    expect(parsed.centre_section).toEqual(baseline.centre_section);
    expect(draftMillimetres(resized, "section-top_front_height_ratio")).toBe(
      67.5,
    );
    expect(JSON.stringify(baseline)).toBe(original);
  });
  it("uses current draft dimensions, not the last valid result or original source", () => {
    const draft = {
      ...toDraft(baseline),
      "foot-length": "200",
      "foot-width": "96",
      "pose-heel_height": "80",
    };
    const resized = resizeDraft(draft, "250");
    expect(resized["foot-width"]).toBe("120");
    expect(resized["pose-heel_height"]).toBe("80");
  });
  it("preserves other incomplete draft fields rather than secretly rebuilding", () => {
    const draft = {
      ...toDraft(baseline),
      "template-medial_ball-station_ratio": "",
    };
    const resized = resizeDraft(draft, "225");
    expect(resized["template-medial_ball-station_ratio"]).toBe("");
    expect(() => parseDraft(baseline, resized)).toThrow(DraftError);
  });
  it.each(["", " ", "NaN", "Infinity", "-1", "0"])(
    "rejects invalid new length %j without mutation",
    (value) => {
      const draft = toDraft(baseline),
        before = { ...draft };
      expect(() => resizeDraft(draft, value)).toThrow("Resize was not applied");
      expect(draft).toEqual(before);
    },
  );
  it.each(["foot-length", "foot-width"])(
    "rejects an invalid current %s",
    (id) => {
      const draft = { ...toDraft(baseline), [id]: "0" },
        before = { ...draft };
      expect(() => resizeDraft(draft, "225")).toThrow(DraftError);
      expect(draft).toEqual(before);
    },
  );
  it("rejects overflow rather than storing an infinite resized width", () => {
    const draft = {
      ...toDraft(baseline),
      "foot-length": "1e-300",
      "foot-width": "1e300",
    };
    expect(() => resizeDraft(draft, "1e300")).toThrow("invalid width");
  });
});

describe("centre-section draft editing", () => {
  it.each(sectionFields)(
    "converts %s independently and preserves original source observations",
    (key) => {
      const draft = toDraft(baseline),
        before = structuredClone(baseline);
      draft[`section-${key}`] = "17.5";
      const parsed = parseDraft(baseline, draft);
      expect(parsed.centre_section).toEqual({
        ...baseline.centre_section,
        [key]: 0.175,
      });
      expect(parsed.reference).toEqual(before.reference);
      expect(parsed.foot).toEqual(before.foot);
      expect(parsed.template).toEqual(before.template);
      expect(baseline).toEqual(before);
    },
  );
  it.each(["", " ", "Infinity", "NaN"])(
    "rejects incomplete/nonfinite depth %j without changing the draft",
    (value) => {
      const draft = toDraft(baseline),
        id = "section-ball_height_ratio";
      draft[id] = value;
      expect(() => parseDraft(baseline, draft)).toThrow(DraftError);
      expect(draft[id]).toBe(value);
      expect(draftMillimetres(draft, id)).toBeUndefined();
    },
  );
  it("leaves finite invalid depth/order values for authoritative server rejection", () => {
    const draft = toDraft(baseline);
    draft["section-ball_height_ratio"] = "-2";
    draft["section-top_front_station_ratio"] = "99";
    const parsed = parseDraft(baseline, draft);
    expect(parsed.centre_section.ball_height_ratio).toBe(-0.02);
    expect(parsed.centre_section.top_front_station_ratio).toBe(0.99);
  });
  it("resolves vertical depth using F only, not W or the extended last length", () => {
    const draft = toDraft(baseline),
      id = "section-top_front_height_ratio";
    expect(draftMillimetres(draft, id)).toBe(75);
    draft["foot-width"] = "150";
    draft["design-toe_extension_ratio"] = "20";
    expect(draftMillimetres(draft, id)).toBe(75);
    draft["foot-length"] = "225";
    expect(draftMillimetres(draft, id)).toBe(67.5);
    expect(draft[id]).toBe("30");
  });
  it("preserves edited and incomplete section ratios during draft-only resizing", () => {
    const draft = toDraft(baseline);
    draft["section-top_front_height_ratio"] = "32";
    draft["section-toe_roof_height_ratio"] = "";
    const resized = resizeDraft(draft, "225");
    expect(resized["section-top_front_height_ratio"]).toBe("32");
    expect(resized["section-toe_roof_height_ratio"]).toBe("");
    expect(draftMillimetres(resized, "section-top_front_height_ratio")).toBe(
      72,
    );
    expect(() => parseDraft(baseline, resized)).toThrow(DraftError);
  });
  it("does not apply a millimetre floor to fractions while converting draft fields", () => {
    const draft = toDraft(baseline);
    draft["section-top_rear_station_ratio"] = "0.004";
    expect(
      parseDraft(baseline, draft).centre_section.top_rear_station_ratio,
    ).toBe(0.00004);
    expect(draftMillimetres(draft, "section-top_rear_station_ratio")).toBe(
      0.01,
    );
  });
  it("invalidates a request on section edits even if the percentage is later restored", () => {
    const gate = new RequestGate(),
      ticket = gate.begin(),
      draft = toDraft(baseline);
    gate.edit();
    draft["section-top_front_height_ratio"] = "32";
    expect(gate.accepts(ticket)).toBe(false);
    expect(viewState("dirty", true)).toContain("LAST EXPLICIT REBUILD");
    gate.edit();
    draft["section-top_front_height_ratio"] = "30";
    expect(parseDraft(baseline, draft)).toEqual(baseline);
    expect(gate.accepts(ticket)).toBe(false);
  });
});

describe("heel, arch and native instep controls", () => {
  it.each(profileShapeFields)(
    "parses %s using its own units rather than assuming percent F",
    (key, _label, basis) => {
      const draft = toDraft(baseline);
      draft[`section-${key}`] = basis === "deg" ? "-7.5" : "12.5";
      const parsed = parseDraft(baseline, draft);
      expect(parsed.centre_section[key]).toBe(basis === "deg" ? -7.5 : 0.125);
      expect(parsed.reference).toEqual(baseline.reference);
    },
  );
  it.each(archFields)(
    "keeps %s as a fraction of arch span and preserves an untouched exact third",
    (key) => {
      const draft = toDraft(baseline);
      expect(parseDraft(baseline, draft).design[key]).toBe(1 / 3);
      draft[`design-${key}`] = "40";
      expect(parseDraft(baseline, draft).design[key]).toBe(0.4);
    },
  );
  it("resizes lengths without changing the eight shape ratios/angles or observations", () => {
    const draft = toDraft(baseline);
    draft["section-instep_front_down_offset_deg"] = "-5";
    draft["pose-seat_inclination_deg"] = "-6.5";
    const parsed = parseDraft(baseline, resizeDraft(draft, "225"));
    expect(parsed.centre_section).toEqual({
      ...baseline.centre_section,
      instep_front_down_offset_deg: -5,
    });
    expect(parsed.design).toEqual(baseline.design);
    expect(parsed.pose.seat_inclination_deg).toBe(-6.5);
    expect(parsed.reference).toEqual(baseline.reference);
    expect(parsed.foot).toEqual({ length: 225, width: 90 });
  });
  it("distinguishes signed input offsets from actual world angles of the accepted result", () => {
    const inputs = structuredClone(baseline);
    inputs.pose.seat_inclination_deg = -5;
    inputs.centre_section.instep_front_down_offset_deg = 50;
    inputs.centre_section.instep_waist_down_offset_deg = -10;
    inputs.centre_section.heel_leave_outward_deg = 10;
    const angles = profileAngles({
      inputs,
      resolved: { bend_angle_rad: Math.PI / 6 },
    });
    expect(angles?.rearSole).toBeCloseTo(25);
    expect(angles?.instepFront).toBeCloseTo(75);
    expect(angles?.instepWaist).toBeCloseTo(15);
    expect(angles?.heelCounter).toBeCloseTo(75);
    inputs.pose.seat_inclination_deg = 0;
    expect(
      profileAngles({ inputs, resolved: { bend_angle_rad: Math.PI / 6 } })
        ?.rearSole,
    ).toBeCloseTo(30);
    expect(profileAngles(null)).toBeUndefined();
  });
  it("invalidates in-flight results after a new angle or arch reach edit", () => {
    const gate = new RequestGate(),
      ticket = gate.begin(),
      draft = toDraft(baseline);
    draft["section-instep_waist_down_offset_deg"] = "-5";
    gate.edit();
    draft["design-arch_contact_reach_ratio"] = "45";
    gate.edit();
    expect(gate.accepts(ticket)).toBe(false);
    expect(viewState("dirty", true)).toContain("LAST EXPLICIT REBUILD");
  });
});

describe("discard pending recovery", () => {
  it("restores the last accepted non-default shape and hidden rules while invalidating pending tickets", () => {
    const accepted = structuredClone(baseline);
    accepted.design.toe_extension_ratio = 0.12;
    accepted.centre_section.heel_leave_outward_deg = 21;
    const gate = new RequestGate();
    gate.edit();
    const stale = gate.begin();
    const pending = toDraft(accepted);
    pending["section-top_front_height_ratio"] = "0";
    const restored = discardPendingDraft(accepted, gate);
    expect(parseDraft(accepted, restored)).toEqual(accepted);
    expect(restored).not.toEqual(toDraft(baseline));
    expect(pending["section-top_front_height_ratio"]).toBe("0");
    expect(accepted.reference).toEqual(baseline.reference);
    expect(accepted.design.arch_start_reach_ratio).toBe(
      baseline.design.arch_start_reach_ratio,
    );
    expect(gate.accepts(stale)).toBe(false);
    expect(gate.accepts(gate.begin())).toBe(true);
  });
});

describe("request and edit identity", () => {
  it("accepts only the latest unchanged request", () => {
    const gate = new RequestGate(),
      old = gate.begin(),
      current = gate.begin();
    expect(gate.accepts(old)).toBe(false);
    expect(gate.accepts(current)).toBe(true);
  });
  it("discards success and failure after any edits, including editing back", () => {
    const gate = new RequestGate(),
      ticket = gate.begin();
    gate.edit();
    gate.edit();
    expect(gate.latest(ticket)).toBe(true);
    expect(gate.accepts(ticket)).toBe(false);
  });
  it("invalidates requests on unmount and permits a fresh StrictMode mount request", () => {
    const gate = new RequestGate(),
      old = gate.begin();
    gate.invalidate();
    const fresh = gate.begin();
    expect(gate.accepts(old)).toBe(false);
    expect(gate.accepts(fresh)).toBe(true);
  });
  it("rejects an in-flight result after a draft resize, including resizing back", () => {
    const gate = new RequestGate(),
      ticket = gate.begin();
    let draft = toDraft(baseline);
    gate.edit();
    draft = resizeDraft(draft, "225");
    expect(viewState("dirty", true)).toContain("LAST EXPLICIT REBUILD");
    expect(gate.accepts(ticket)).toBe(false);
    gate.edit();
    draft = resizeDraft(draft, "250");
    expect(draft["foot-length"]).toBe("250");
    expect(gate.accepts(ticket)).toBe(false);
    expect(gate.accepts(gate.begin())).toBe(true);
  });
  it("labels the explicit 3D/report checkpoint independently of editable 2D", () => {
    for (const phase of ["loading", "dirty", "busy", "error"] as const)
      expect(viewState(phase, true)).toContain("LAST EXPLICIT REBUILD");
    expect(viewState("valid", true)).toBe(
      "LAST EXPLICIT REBUILD · matches validated 2D",
    );
    expect(viewState("error", false)).toBe("No explicit 3D/report Rebuild yet");
  });
});

describe("result gates and numeric display", () => {
  const passingReport = (): ValidationReport => ({
    passed: true,
    units: "mm",
    checks: [],
    limits: [],
  });
  it.each(["foot", "top", "bottom", "contour", "section"] as const)(
    "requires a passing %s report",
    (report) => {
      const result = {
        reports: {
          foot: passingReport(),
          top: passingReport(),
          bottom: passingReport(),
          contour: passingReport(),
          section: passingReport(),
        },
      };
      expect(passingResult(result)).toBe(true);
      result.reports[report].passed = false;
      expect(passingResult(result)).toBe(false);
    },
  );
  it("rejects a missing foot report", () => {
    const result = {
      reports: {
        top: passingReport(),
        bottom: passingReport(),
        contour: passingReport(),
        section: passingReport(),
      },
    };
    expect(passingResult(result)).toBe(false);
  });
  it("rejects a missing section report instead of accepting a schema-2 four-report result", () => {
    expect(
      passingResult({
        reports: {
          foot: passingReport(),
          top: passingReport(),
          bottom: passingReport(),
          contour: passingReport(),
        },
      }),
    ).toBe(false);
  });
  it("does not print small nonzero tolerances or roundoff as zero", () => {
    expect(fmt(1e-9)).toBe("1e-9");
    expect(fmt(2.84217e-14)).toBe("2.84217e-14");
    expect(fmt(1e8)).toBe("1e+8");
    expect(fmt(250)).toBe("250");
    expect(fmt(0)).toBe("0");
  });
});
