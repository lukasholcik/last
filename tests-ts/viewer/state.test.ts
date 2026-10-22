import { describe, expect, it } from "vitest";
import input from "../../examples/contour-baseline.json";
import type { ContourInput, LastState } from "../../src/lib/geometry/types";
import {
  DraftError,
  RequestGate,
  fmt,
  parseDraft,
  passingResult,
  toDraft,
  viewState,
} from "../../src/app/_components/viewer/state";

const baseline = input as ContourInput;

describe("viewer draft parsing", () => {
  it("round trips all 23 dimensions without mutating the input", () => {
    const before = JSON.stringify(baseline),
      draft = toDraft(baseline);
    expect(Object.keys(draft)).toHaveLength(23);
    expect(parseDraft(baseline, draft)).toEqual(baseline);
    draft["bottom-heel_height"] = "80";
    expect(parseDraft(baseline, draft).design.bottom.heel_height).toBe(80);
    expect(JSON.stringify(baseline)).toBe(before);
  });
  it.each(["", " ", "Infinity", "NaN", "not a number"])(
    "rejects %j without coercion to zero",
    (value) => {
      const draft = toDraft(baseline);
      draft["shared-last_length"] = value;
      expect(() => parseDraft(baseline, draft)).toThrow(DraftError);
      expect(draft["shared-last_length"]).toBe(value);
    },
  );
  it("preserves zero and impossible finite dimensions for authoritative server validation", () => {
    const draft = toDraft(baseline);
    draft["bottom-heel_height"] = "0";
    draft["top-medial_ball_s"] = "-3";
    expect(parseDraft(baseline, draft).design.bottom.heel_height).toBe(0);
    expect(parseDraft(baseline, draft).design.top.medial_ball_s).toBe(-3);
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
  it("labels every noncurrent result as last valid", () => {
    for (const phase of ["loading", "dirty", "busy", "error"] as const)
      expect(viewState(phase, true)).toContain("LAST VALID");
    expect(viewState("valid", true)).toBe("Current rebuilt geometry");
    expect(viewState("error", false)).toBe("No rebuilt geometry yet");
  });
});

describe("result gates and numeric display", () => {
  it.each(["top", "bottom", "contour"] as const)(
    "requires a passing %s report",
    (report) => {
      const result = {
        reports: {
          top: { passed: true },
          bottom: { passed: true },
          contour: { passed: true },
        },
      } as LastState;
      expect(passingResult(result)).toBe(true);
      result.reports[report].passed = false;
      expect(passingResult(result)).toBe(false);
    },
  );
  it("does not print small nonzero tolerances or roundoff as zero", () => {
    expect(fmt(1e-9)).toBe("1e-9");
    expect(fmt(2.84217e-14)).toBe("2.84217e-14");
    expect(fmt(1e8)).toBe("1e+8");
    expect(fmt(250)).toBe("250");
    expect(fmt(0)).toBe("0");
  });
});
