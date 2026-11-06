import { createCurve } from "./edit";
import type { EditableCurve } from "./types";

export interface CurvePreset {
  readonly id: string;
  readonly label: string;
  readonly curve: () => EditableCurve;
}

export const PRESETS: readonly CurvePreset[] = [
  {
    id: "s-curve",
    label: "S-curve (open)",
    curve: () =>
      createCurve(
        [
          { pos: [-120, -40] },
          { pos: [-40, 50] },
          { pos: [40, -50] },
          { pos: [120, 40] },
        ],
        false,
      ),
  },
  {
    id: "oval",
    label: "Oval (closed)",
    curve: () =>
      createCurve(
        [
          { pos: [0, 50] },
          { pos: [-80, 0] },
          { pos: [0, -50] },
          { pos: [80, 0] },
        ],
        true,
      ),
  },
  {
    id: "section",
    label: "Section-like (closed)",
    curve: () =>
      createCurve(
        [
          { pos: [-44, 14] },
          { pos: [-34, 46] },
          { pos: [0, 62] },
          { pos: [34, 44] },
          { pos: [46, 14] },
          { pos: [38, 0], mode: "corner" },
          { pos: [-38, 0], mode: "corner" },
        ],
        true,
      ),
  },
  {
    id: "blank",
    label: "Blank (two points)",
    curve: () => createCurve([{ pos: [-60, 0] }, { pos: [60, 0] }], false),
  },
];
