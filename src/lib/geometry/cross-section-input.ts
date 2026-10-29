import { InputError, type Vec2 } from "./types";
import { record } from "./contour";
import {
  CROSS_SECTION_IDS,
  CROSS_SECTION_ANCHORS,
  type CrossSectionsInput,
  type CrossSectionDefinition,
  type HeelWrapRoute,
} from "./section-types";

function fields(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    throw new InputError("Unknown or malformed cross_sections fields");
  return value;
}
function finite(value: unknown, lo = -10000, hi = 10000): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < lo ||
    value > hi
  )
    throw new InputError("Invalid cross-section numeric value");
  return value;
}
function vector(value: unknown, normalized = false): Vec2 {
  if (!Array.isArray(value) || value.length !== 2)
    throw new InputError("Expected section vector pair");
  return [
    finite(value[0], normalized ? 0 : -10, normalized ? 1 : 10),
    finite(value[1], normalized ? 0 : -10, normalized ? 1 : 10),
  ];
}
export function parseCrossSections(value: unknown): CrossSectionsInput {
  const root = fields(value, ["split_midfoot", "sections", "heel_wraps"]),
    result: CrossSectionsInput = {};
  if (Object.hasOwn(root, "split_midfoot")) {
    if (typeof root.split_midfoot !== "boolean")
      throw new InputError("split_midfoot must be boolean");
    result.split_midfoot = root.split_midfoot;
  }
  if (Object.hasOwn(root, "sections")) {
    const sections = fields(root.sections, CROSS_SECTION_IDS);
    result.sections = {};
    for (const id of CROSS_SECTION_IDS) {
      if (!Object.hasOwn(sections, id)) continue;
      const source = fields(sections[id], [
          "station_offset_ratio",
          "tilt_deg",
          "side_depth_ratios",
          "handles",
        ]),
        entry: CrossSectionDefinition = {};
      if (Object.hasOwn(source, "station_offset_ratio"))
        entry.station_offset_ratio = finite(
          source.station_offset_ratio,
          -0.2,
          0.2,
        );
      if (Object.hasOwn(source, "tilt_deg"))
        entry.tilt_deg = finite(source.tilt_deg, -30, 30);
      if (Object.hasOwn(source, "side_depth_ratios")) {
        entry.side_depth_ratios = vector(source.side_depth_ratios, true);
        if (entry.side_depth_ratios.some((v) => v <= 0 || v >= 1))
          throw new InputError(
            "Side anchors must be strictly inside the section depth",
          );
      }
      if (Object.hasOwn(source, "handles")) {
        const handles = fields(source.handles, CROSS_SECTION_ANCHORS);
        entry.handles = {};
        for (const anchor of CROSS_SECTION_ANCHORS) {
          if (!Object.hasOwn(handles, anchor)) continue;
          const h = fields(handles[anchor], ["incoming", "outgoing"]),
            out: { incoming?: Vec2; outgoing?: Vec2 } = {};
          if (Object.hasOwn(h, "incoming")) out.incoming = vector(h.incoming);
          if (Object.hasOwn(h, "outgoing")) out.outgoing = vector(h.outgoing);
          entry.handles[anchor] = out;
        }
      }
      result.sections[id] = entry;
    }
  }
  if (Object.hasOwn(root, "heel_wraps")) {
    const paths = fields(root.heel_wraps, ["short_heel", "long_heel"]);
    result.heel_wraps = {};
    for (const id of ["short_heel", "long_heel"] as const) {
      if (!Object.hasOwn(paths, id)) continue;
      const p = fields(paths[id], ["protocol", "route", "target_mm", "foot"]);
      if (
        typeof p.protocol !== "string" ||
        !p.protocol.trim() ||
        !Array.isArray(p.route) ||
        p.route.length < 3 ||
        p.route.length > 64
      )
        throw new InputError(
          "Heel route requires protocol and 3–64 ordered surface anchors",
        );
      const path: HeelWrapRoute = {
        protocol: p.protocol,
        route: p.route.map((v) => vector(v, true)),
      };
      const first = path.route[0]!,
        last = path.route.at(-1)!;
      if (first[0] !== last[0] || Math.abs(first[1] - last[1]) % 1 !== 0)
        throw new InputError("Heel wrap route must explicitly close");
      if (Object.hasOwn(p, "target_mm"))
        path.target_mm = finite(p.target_mm, 0.01);
      if (Object.hasOwn(p, "foot")) {
        const f = fields(p.foot, ["value_mm", "conditions"]);
        if (typeof f.conditions !== "string" || !f.conditions.trim())
          throw new InputError("Foot wrap needs capture conditions");
        path.foot = {
          value_mm: finite(f.value_mm, 0.01),
          conditions: f.conditions,
        };
      }
      result.heel_wraps[id] = path;
    }
  }
  return result;
}
