"""Verification-only Python goldens; never called by the TypeScript runtime."""

import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from viewer_server import build_state, load_defaults


def main():
    baseline = load_defaults()
    cases = [("baseline", {})]
    cases += [(f"heel-{h}", {"heel_height": h}) for h in (40,60,80)]
    cases += [("flat", {"heel_height":0,"seat_inclination_deg":0,"toe_spring":0}),
              ("flat-minimum-gap", {"heel_height":0,"seat_inclination_deg":0,"toe_spring":0}),
              ("waist-cap", {"heel_height":40,"seat_inclination_deg":35,"contact_s":99}),
              ("length-260", {}), ("width-54", {})]
    destination = ROOT / "tests-ts/fixtures"
    destination.mkdir(parents=True,exist_ok=True)
    for name, edits in cases:
        inputs = copy.deepcopy(baseline)
        inputs["design"]["bottom"].update(edits)
        if name == "flat-minimum-gap":
            inputs["design"]["top"]["medial_waist_s"] = 30.01
        if name == "length-260":
            inputs["design"]["last_length"] = 260
        if name == "width-54":
            inputs["design"]["top"]["lateral_ball_width"] = 54
        state = build_state(inputs)
        assert all(r["passed"] for r in state["reports"].values())
        (destination / f"{name}.json").write_text(json.dumps(dict(input=inputs,expected=state),indent=2,allow_nan=False)+"\n")
        print(name)


if __name__ == "__main__":
    main()
