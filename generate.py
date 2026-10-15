"""Generate the two SVG views and the independently checked numeric model."""

import argparse
import json
from pathlib import Path
import sys

from last_shape import build_model, validate_model

OUTPUTS = ("silhouette.svg", "diagram.svg", "model.json", "report.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("output"))
    args = parser.parse_args()
    try:
        if args.input.resolve() in {(args.output_dir / name).resolve() for name in OUTPUTS}:
            raise ValueError("input must not be one of the generated output files")
        args.output_dir.mkdir(parents=True, exist_ok=True)
        # Invalidate success first, before another output's cleanup can fail.
        try:
            (args.output_dir / "report.json").unlink(missing_ok=True)
        except OSError as error:
            print("Warning: could not invalidate report.json; any existing report may be stale.",
                  file=sys.stderr)
            raise error
        # Remove files only: never recursively delete a conflicting directory.
        for name in OUTPUTS[:-1]:
            (args.output_dir / name).unlink(missing_ok=True)
        inputs = json.loads(args.input.read_text())
        model = build_model(inputs)
        report = validate_model(model, inputs)
        if not report["passed"]:
            (args.output_dir / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
            raise ValueError("resulting outline failed validation; see report.json")
        from diagram import render_svg
        output = {
            "silhouette.svg": render_svg(model, diagnostic=False),
            "diagram.svg": render_svg(model, diagnostic=True),
            "model.json": json.dumps(model, indent=2, allow_nan=False) + "\n",
            "report.json": json.dumps(report, indent=2, allow_nan=False) + "\n",
        }
        # Write the success report last, only after both SVGs and the model exist.
        for name, content in output.items():
            (args.output_dir / name).write_text(content)
    except (ValueError, OSError, KeyError, TypeError, ImportError) as error:
        print(f"Generation failed: {error}", file=sys.stderr)
        return 1
    print(f"Generated and checked outline in {args.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
