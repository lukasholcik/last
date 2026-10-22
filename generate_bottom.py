"""Generate the specified bottom guide, optionally with single-control comparisons."""

import argparse
import copy
import json
from pathlib import Path
import sys

from bottom_profile import FIELDS, build_bottom_model, bottom_curve_points, validate_bottom_model


def _simple_name(name):
    return isinstance(name,str) and bool(name) and name != "baseline" and all(c in "abcdefghijklmnopqrstuvwxyz0123456789_" for c in name)


def _remove_report(path):
    try:
        path.unlink(missing_ok=True)
    except OSError:
        print(f"Warning: could not invalidate {path}; any existing report may be stale.",file=sys.stderr)
        raise


def _invalidate(output):
    # The previous audit identifies only our own variant folders, not unrelated files.
    audit = output / "comparison-report.json"
    old_names = []
    if audit.is_file():
        try:
            previous = json.loads(audit.read_text())
            old_names = [e["name"] for e in previous.get("variants",[]) if _simple_name(e.get("name"))]
        except (OSError,ValueError,KeyError,TypeError,AttributeError):
            pass
    _remove_report(audit)
    _remove_report(output / "baseline" / "report.json")
    for name in old_names:
        _remove_report(output / name / "report.json")


def _write_json(path,value):
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+"\n")


def generate_bottom(top_inputs,bottom_inputs,output_dir,specifications=None):
    """Direct calls also clear the previous success before validating numeric data."""
    output = Path(output_dir)
    output.mkdir(parents=True,exist_ok=True)
    _invalidate(output)
    specs = [] if specifications is None else specifications
    if not isinstance(specs,list) or (specifications is not None and not specs):
        raise ValueError("variants must be a nonempty list when requested")
    names = []
    for spec in specs:
        if not isinstance(spec,dict) or set(spec) != {"name","input","value"}:
            raise ValueError("each variant requires name, input, value")
        if not _simple_name(spec["name"]) or spec["name"] in names:
            raise ValueError("variant names must be unique lowercase names, not paths or baseline")
        if spec["input"] not in FIELDS:
            raise ValueError("variant input must name one of the six bottom controls")
        names.append(spec["name"])
        _remove_report(output/spec["name"]/"report.json")
    baseline = build_bottom_model(top_inputs,bottom_inputs)
    entries = []
    baseline_report = validate_bottom_model(baseline,top_inputs,bottom_inputs)
    if not baseline_report["passed"]:
        raise ValueError("baseline failed bottom geometry checks")
    models = [("baseline",bottom_inputs,baseline,baseline_report)]
    for spec in specs:
        inputs = copy.deepcopy(bottom_inputs)
        field = spec["input"]
        old = inputs["design"][field]
        if old == spec["value"]:
            raise ValueError(f"{spec['name']} must change exactly one entered control")
        inputs["design"][field] = spec["value"]
        model = build_bottom_model(top_inputs,inputs)
        report = validate_bottom_model(model,top_inputs,inputs)
        if not report["passed"]:
            raise ValueError(f"{spec['name']} failed bottom geometry checks")
        changed = [n for n in baseline["profile"] if bottom_curve_points(baseline,n) != bottom_curve_points(model,n)]
        identical = [n for n in baseline["profile"] if n not in changed]
        entries.append(dict(name=spec["name"],label=spec["name"].replace("_"," "),
                            change=dict(field=field,**{"from":old,"to":spec["value"]}),model=model,
                            changed_curves=changed,identical_curves=identical,report=report))
        models.append((spec["name"],inputs,model,report))
    from bottom_diagram import render_bottom_svg
    # No success reports until all requested geometry and rendering have succeeded.
    files = []
    for name,inputs,model,report in models:
        folder = output/name
        folder.mkdir(exist_ok=True)
        files.extend(((folder/"clean.svg",render_bottom_svg(model,False)),
                      (folder/"diagram.svg",render_bottom_svg(model,True)),
                      (folder/"input.json",json.dumps(inputs,indent=2,allow_nan=False)+"\n"),
                      (folder/"model.json",json.dumps(model,indent=2,allow_nan=False)+"\n")))
    audit = dict(baseline_passed=baseline_report["passed"],passed=True,
                 top_projected_length=top_inputs["design"]["length"],
                 description="Made-up bottom guides; unchanged top inputs and provisional alignment only.",
                 variants=[{k:v for k,v in e.items() if k != "model"} for e in entries])
    if specifications is not None:
        from bottom_diagram import render_bottom_comparison
        files.append((output/"comparison.svg",render_bottom_comparison(baseline,entries)))
    for path,content in files:
        path.write_text(content)
    for name,_,_,report in models:
        _write_json(output/name/"report.json",report)
    if specifications is not None:
        _write_json(output/"comparison-report.json",audit)
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top-input",type=Path,required=True)
    parser.add_argument("--input",type=Path,required=True)
    parser.add_argument("--output-dir",type=Path,default=Path("output/bottom"))
    parser.add_argument("--variants",type=Path)
    args = parser.parse_args()
    try:
        sources = [args.top_input,args.input]+([args.variants] if args.variants else [])
        if any(p.resolve().is_relative_to(args.output_dir.resolve()) for p in sources):
            raise ValueError("input paths must be outside the generated output directory")
        args.output_dir.mkdir(parents=True,exist_ok=True)
        _invalidate(args.output_dir)
        # Audit invalidation deliberately precedes all input reads and JSON parsing.
        top = json.loads(args.top_input.read_text())
        bottom = json.loads(args.input.read_text())
        specs = None
        if args.variants:
            configuration = json.loads(args.variants.read_text())
            if (not isinstance(configuration,dict) or not isinstance(configuration.get("variants"),list)
                    or not configuration["variants"]):
                raise ValueError("variants configuration must be an object with a nonempty variants list")
            specs = configuration["variants"]
        audit = generate_bottom(top,bottom,args.output_dir,specs)
    except (OSError,ValueError,KeyError,TypeError,ImportError) as error:
        print(f"Bottom generation failed: {error}",file=sys.stderr)
        return 1
    print(f"Generated checked baseline and {len(audit['variants'])} variants in {args.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
