"""Generate and audit single-input examples using the existing model and renderer."""

import argparse
import copy
import json
import math
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

from diagram import render_svg
from last_shape import build_model, curve_points, validate_model

NS = {"s": "http://www.w3.org/2000/svg"}


def compare_models(baseline, variant):
    """Exact control-coordinate comparison, not sampled similarity."""
    changed, identical, shifts = [], [], {}
    for name in baseline["outline"]:
        a, b = curve_points(baseline, name), curve_points(variant, name)
        if a == b:
            identical.append(name)
        else:
            changed.append(name)
            # Convex Bezier weights bound equal-parameter displacement by this.
            shifts[name] = max(math.dist(p, q) for p, q in zip(a, b))
    return {"changed_curves": changed, "identical_curves": identical,
            "max_control_displacement_mm": shifts,
            "magnitude_definition": "Per curve: maximum control-point displacement; bounds equal-parameter curve displacement, not a measured width change."}


def _outline_path(model):
    root = ET.fromstring(render_svg(model, False))
    path = root.find('.//s:path[@id="outline"]', NS)
    assert path is not None
    return path.attrib["d"]


def render_comparison(baseline, entries):
    """All panels use one uniform mm-to-pixel scale, origin and bounds."""
    models = [baseline] + [entry["model"] for entry in entries]
    points = [p for model in models for p in model["points"].values()]
    xmin, xmax = min(p["x"] for p in points), max(p["x"] for p in points)
    ymin, ymax = min(p["y"] for p in points), max(p["y"] for p in points)
    scale = 2.1
    panel_width = max(540, (xmax-xmin) * scale + 120)
    panel_height = (ymax-ymin) * scale + 175
    width, height = 2 * panel_width + 48, math.ceil(len(entries)/2) * panel_height + 128
    root = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg", "viewBox": f"0 0 {width} {height}",
                              "width": str(width), "height": str(height), "role": "img"})

    def add(tag, parent=None, text=None, **attrs):
        node = ET.SubElement(root if parent is None else parent, tag, {k.replace("_", "-"): str(v) for k,v in attrs.items()})
        node.text = text
        return node

    def text(x, y, value, size=14, **attrs):
        return add("text", text=value, **{"x": x, "y": y, "font_family": "Georgia, serif",
                                         "font_size": size, "fill": "#293d40", **attrs})

    add("title", text="Single-input outer top silhouette comparisons")
    add("rect", width="100%", height="100%", fill="#faf9f6")
    text(24, 32, "One number at a time", 24)
    text(24, 56, "Made-up design examples — not fit models. Outer top silhouette, not sole.")
    text(24, 78, "Same scale and origin in every panel · mm · medial −x / lateral +x · forward +y ↑")
    add("path", d="M 24 100 H 60", stroke="#87969a", stroke_width=2, stroke_dasharray="6 4")
    text(70, 105, "Baseline")
    add("path", d="M 185 100 H 221", stroke="#267166", stroke_width=2)
    text(231, 105, "Variant · see report for exact changes")
    for i, entry in enumerate(entries):
        x, y = 24 + (i % 2) * panel_width, 128 + (i // 2) * panel_height
        name, change = entry["name"], entry["input_change"]
        text(x+16, y+24, name.replace("_", " ").capitalize(), 19)
        text(x+16, y+47, f'{change["name"]}: {change["old"]:g} → {change["new"]:g} mm', 14,
             font_family="monospace")
        text(x+16, y+69, f'{len(entry["changed_curves"])} changed curves · all dimensions pass ≤0.1 mm', 13)
        tx = x + panel_width/2 - (xmin+xmax)/2 * scale
        ty = y + 110 + ymax * scale
        g = add("g", id=f"panel-{name}", transform=f"translate({tx} {ty}) scale({scale} -{scale})",
                data_scale_px_per_mm=scale)
        add("path", g, id=f"axis-{name}", d=f"M 0 {ymin} L 0 {ymax}", stroke="#d5ded9", stroke_width=".4", fill="none")
        add("path", g, id=f"baseline-{name}", d=_outline_path(baseline), fill="#e7eeea",
            stroke="none")
        add("path", g, id=f"variant-{name}", d=_outline_path(entry["model"]), fill="none",
            stroke="#267166", stroke_width=".8")
        # Baseline stroke last keeps both outlines legible where they coincide.
        add("path", g, id=f"baseline-stroke-{name}", d=_outline_path(baseline), fill="none",
            stroke="#87969a", stroke_width=".55", stroke_dasharray="2 2")
        for label, model, color in (("old", baseline, "#87969a"), ("new", entry["model"], "#267166")):
            landmark = change["name"].rsplit("_", 1)[0]
            p = model["points"][landmark]
            add("circle", g, id=f"{label}-{name}-{landmark}", cx=p["x"], cy=p["y"], r="1.7", fill=color)
        text(x+16, y+panel_height-22, "C1 joins; curvature may change. No bottom, toe-clearance or fit claim.", 12)
    return ET.tostring(root, encoding="unicode") + "\n"


def invalidate_report(output_dir):
    """Remove only the old audit file, never a conflicting directory."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        (output_dir / "comparison-report.json").unlink(missing_ok=True)
    except OSError:
        print("Warning: could not invalidate comparison-report.json; any existing report may be stale.",
              file=sys.stderr)
        raise


def generate_comparisons(baseline_inputs, specifications, output_dir):
    output_dir = Path(output_dir)
    # Keep this safeguard for callers that bypass the CLI.
    invalidate_report(output_dir)
    baseline = build_model(baseline_inputs)
    entries = []
    names = [spec["name"] for spec in specifications]
    if not names or len(names) != len(set(names)):
        raise ValueError("Use at least one variant, with unique names")

    def write_model(name, inputs, model):
        report = validate_model(model, inputs)
        if not report["passed"]:
            raise ValueError(f"{name} failed geometry checks")
        directory = output_dir / name
        directory.mkdir(exist_ok=True)
        for filename, value in (("input.json", inputs), ("model.json", model), ("report.json", report)):
            (directory / filename).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
        (directory / "silhouette.svg").write_text(render_svg(model, False))
        (directory / "diagram.svg").write_text(render_svg(model))
        return report

    baseline_report = write_model("baseline", baseline_inputs, baseline)
    for spec in specifications:
        name = spec["name"]
        if not name or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789_" for c in name) or name == "baseline":
            raise ValueError("Variant names must be simple lowercase names, not paths")
        inputs = copy.deepcopy(baseline_inputs)
        field = spec["input"]
        old = inputs["design"][field]
        inputs["design"][field] = spec["value"]
        inputs["description"] = f'Made-up design variant {name}; not measured foot data or a fit model.'
        model = build_model(inputs)
        report = write_model(name, inputs, model)
        dimensions = [c for c in report["checks"] if c["name"] == "longitudinal_length" or c["name"].endswith("_half_width")]
        entries.append({"name": name, "model": model, "input_change": {"name": field, "old": old, "new": spec["value"]},
                        **compare_models(baseline, model), "dimension_checks": dimensions,
                        "max_dimension_error_mm": max(abs(c["actual"]-c["expected"]) for c in dimensions),
                        "passed": report["passed"]})
    (output_dir / "comparison.svg").write_text(render_comparison(baseline, entries))
    audit = {"description": "Made-up designs, not fit models; exact named-curve dependency audit.",
             "baseline_passed": baseline_report["passed"],
             "variants": [{k:v for k,v in e.items() if k != "model"} for e in entries]}
    (output_dir / "comparison-report.json").write_text(json.dumps(audit, indent=2, allow_nan=False) + "\n")
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=Path("examples/baseline.json"))
    parser.add_argument("--variants", type=Path, default=Path("examples/variants.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("output/variants"))
    args = parser.parse_args()
    try:
        report_path = (args.output_dir / "comparison-report.json").resolve()
        if report_path in (args.baseline.resolve(), args.variants.resolve()):
            raise ValueError("inputs must not be the generated comparison report")
        # Input reading/parsing can fail too: remove the old success beforehand.
        invalidate_report(args.output_dir)
        audit = generate_comparisons(json.loads(args.baseline.read_text()),
                                     json.loads(args.variants.read_text())["variants"], args.output_dir)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"Comparison generation failed: {error}", file=sys.stderr)
        return 1
    print(f'Generated baseline and {len(audit["variants"])} checked variants in {args.output_dir}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
