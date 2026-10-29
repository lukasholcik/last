import { describe, expect, it } from "vitest";
import type {
  SampledCurve,
  SectionPoint,
  Vec3,
} from "../../src/lib/geometry/types";
import {
  sampledPath,
  sectionNativeHandleLabel,
  sectionPointLabel,
  upperSectionCurves,
} from "../../src/app/_components/viewer/section-display";

const curve = (name: string, points: Vec3[]): SampledCurve => ({
  name,
  points,
});

describe("server-sampled centre-section drawing", () => {
  const lower = [
    curve("seat", [
      [0, 0, 8],
      [0, 50, 6],
    ]),
    curve("waist", [
      [0, 50, 6],
      [0, 175, 0],
    ]),
  ];
  const roof = [
    curve("toe_cap", [
      [0, 175, 0],
      [0, 170, 15],
    ]),
    curve("roof_ball_to_toe", [
      [0, 170, 15],
      [0, 100, 55],
    ]),
  ];
  it("retains ordered server samples and closes the section without manufacturing cubic controls", () => {
    const project = ([, y, z]: Vec3): [number, number] => [16 + y, 100 - z];
    expect(sampledPath([...lower, ...roof], project, true)).toBe(
      "M 16 92 L 66 94 L 66 94 L 191 100 L 191 100 L 186 85 L 186 85 L 116 45 Z",
    );
    expect(sampledPath([], project, true)).toBe("");
  });
  it("excludes only shared bottom pieces from the upper stroke, leaving roof/caps/cut in server order", () => {
    const section = [
      ...lower,
      ...roof,
      curve("top_cut", [
        [0, 100, 55],
        [0, 10, 55],
      ]),
      curve("rear_cap", [
        [0, 10, 55],
        [0, 0, 8],
      ]),
    ];
    const before = structuredClone(section);
    expect(upperSectionCurves(section, lower).map((c) => c.name)).toEqual([
      "toe_cap",
      "roof_ball_to_toe",
      "top_cut",
      "rear_cap",
    ]);
    expect(section).toEqual(before);
    expect(upperSectionCurves(section, lower)[0]).toBe(roof[0]);
  });
  it("leaves open upper drawing open and uses supplied world samples, not reference heights", () => {
    const project = ([, y, z]: Vec3): [number, number] => [y, z];
    expect(sampledPath(roof, project)).toBe(
      "M 175 0 L 170 15 L 170 15 L 100 55",
    );
  });
  it("distinguishes reference station, posed world coordinates and vertical depth in point inspection", () => {
    const point: SectionPoint = {
      y: 61.2,
      z: 130,
      reference_s: 70,
      height: 75,
      kind: "landmark",
    };
    expect(sectionPointLabel("cut_front", point)).toBe(
      "section: cut_front · reference s_ref 70 mm · posed y 61.2 mm, z 130 mm · vertical offset from reference guide 75 mm · landmark",
    );
  });
  it("labels native cap handles as derived world y/z controls, not reference roof handles or depth landmarks", () => {
    expect(sectionNativeHandleLabel("toe_cap", 1, [260, 15])).toBe(
      "section: toe_cap.control1 · native posed cap handle · y 260 mm, z 15 mm · derived construction, not editable",
    );
    expect(sectionNativeHandleLabel("rear_cap", 2, [0, 33])).toBe(
      "section: rear_cap.control2 · native posed cap handle · y 0 mm, z 33 mm · derived construction, not editable",
    );
  });
  it("distinguishes native posed instep Bézier handles from toe/rear cap controls", () => {
    expect(sectionNativeHandleLabel("roof_front_to_waist", 1, [80, 65])).toBe(
      "section: roof_front_to_waist.control1 · native posed instep Bézier handle · y 80 mm, z 65 mm · derived construction, not editable",
    );
    expect(
      sectionNativeHandleLabel("roof_waist_to_ball", 2, [150, 35]),
    ).toContain("native posed instep Bézier handle");
  });
});
