"""Undistorted, open y-z guide diagrams; no geometry generation or fit claims."""

import textwrap
import xml.etree.ElementTree as ET

from diagram import _id, _n


def _validate(model):
    if model.get("schema_version") != 2:
        raise ValueError("Bottom renderer requires schema_version 2 (contact blend and inclined ramp); version 1 is not supported")
    if (model["units"] != "mm" or model["axes"] != ["y", "z"]
            or model["kind"] != "bottom_profile" or model["closed"] is not False):
        raise ValueError("Expected an open bottom_profile with axes ['y', 'z'] in mm")
    if not model["profile"]:
        raise ValueError("A profile needs curves")
    for point in model["points"].values():
        _n(point["y"])
        _n(point["z"])
    previous = None
    for name in model["profile"]:
        curve = model["curves"][name]
        for field in ("start", "control1", "control2", "end"):
            model["points"][curve[field]]
        if previous is not None and curve["start"] != previous:
            raise ValueError("Profile curves must be connected in order")
        previous = curve["end"]
    first = model["curves"][model["profile"][0]]["start"]
    if first == previous:
        raise ValueError("Bottom guide must be open")
    for reference in model["reference_lines"].values():
        model["points"][reference["start"]]
        model["points"][reference["end"]]
    for dimension in model["dimensions"].values():
        _n(dimension["expected"])
        if dimension["units"] not in ("mm", "deg"):
            raise ValueError("Dimension units must be mm or deg")
        model["reference_lines"][dimension["reference_line"]]


def _xy(model, name):
    p = model["points"][name]
    return f'{_n(p["y"])} {_n(p["z"])}'


def _curve_path(model, name):
    c = model["curves"][name]
    return ("M " + _xy(model, c["start"]) + " C "
            + " ".join(_xy(model, c[k]) for k in ("control1", "control2", "end")))


def _profile_path(model):
    first = model["curves"][model["profile"][0]]["start"]
    return ("M " + _xy(model, first) + " "
            + " ".join("C " + _curve_path(model, name).split(" C ", 1)[1]
                       for name in model["profile"]))


def _add(parent, tag, text=None, **attrs):
    node = ET.SubElement(parent, tag, {k.replace("_", "-"): str(v) for k, v in attrs.items()})
    node.text = text
    return node


def _text(root, x, y, value, size=13, **attrs):
    return _add(root, "text", value, **{"x": _n(x), "y": _n(y), "font_family": "Georgia, serif",
                                       "font_size": size, "fill": "#293d40", **attrs})


def _root(width, height, title, scale=3, physical=False):
    root = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg",
                              "viewBox": f'0 0 {_n(width)} {_n(height)}',
                              "width": _n(width/scale if physical else width) + ("mm" if physical else "px"),
                              "height": _n(height/scale if physical else height) + ("mm" if physical else "px"),
                              "role": "img", "aria-labelledby": "title description"})
    _add(root, "title", title, id="title")
    _add(root, "desc", "Made-up design example — not a fit model. Longitudinal guide, not a bottom surface. Forward y points right; z points up. Ground z=0. Equal axis scales; print scale is not guaranteed.", id="description")
    _add(root, "rect", width="100%", height="100%", fill="#faf9f6")
    return root


def _bounds(models):
    points = [p for m in models for p in m["points"].values()]
    return (min(p["y"] for p in points), max(p["y"] for p in points),
            min(0, min(p["z"] for p in points)), max(0, max(p["z"] for p in points)))


def _line(model, reference):
    return "M " + _xy(model, reference["start"]) + " L " + _xy(model, reference["end"])


def render_bottom_svg(model, diagnostic=True):
    """Render model coordinates unchanged. Clean output has physical mm dimensions."""
    _validate(model)
    scale = 3
    ymin, ymax, zmin, zmax = _bounds([model])
    width = max(1200 if diagnostic else 900, (ymax-ymin)*scale+100)
    tx, ty = 50-ymin*scale, 145+zmax*scale
    ground_y = ty
    plot_bottom = ty-zmin*scale
    points, curves, refs = model["points"], model["curves"], model["reference_lines"]
    pk = {name: f'P{i:02d}' for i, name in enumerate(sorted(points), 1)}
    ck = {name: f'C{i:02d}' for i, name in enumerate(sorted(curves), 1)}
    rk = {name: f'R{i:02d}' for i, name in enumerate(sorted(refs), 1)}
    connectors = []
    for name in sorted(curves):
        c = curves[name]
        for suffix, a, b in (("start_to_handle_start", c["start"], c["control1"]),
                             ("handle_start_to_handle_end", c["control1"], c["control2"]),
                             ("handle_end_to_end", c["control2"], c["end"])):
            connectors.append((name+"_"+suffix, a, b))
    columns = [[], []]
    columns[0].append("DESIGN TARGETS · not measured results")
    for name in sorted(model["dimensions"]):
        d = model["dimensions"][name]
        label = f'{rk[d["reference_line"]]}  {name}' if diagnostic else name.replace("_deg", "").replace("_", " ").capitalize()
        columns[0].append(f'{label}: {_n(d["expected"])} {d["units"]}')
    if diagnostic:
        columns[0].append("POINTS · (y, z) mm · displayed to 0.001")
        for name in sorted(points):
            p = points[name]
            columns[0].append(f'{pk[name]}  {name} [{p["kind"]}] ({_n(round(p["y"], 3))}, {_n(round(p["z"], 3))})')
        columns[1].append("CURVES · start / handle / handle / end")
        for name in sorted(curves):
            c = curves[name]
            columns[1].append(f'{ck[name]}  {name}: ' + " / ".join(pk[c[k]] for k in ("start", "control1", "control2", "end")))
        columns[1].append("REFERENCE LINES · overlaps retain separate names")
        for name in sorted(refs):
            r = refs[name]
            columns[1].append(f'{rk[name]}  {name}: {pk[r["start"]]} → {pk[r["end"]]}')
        columns[1].append("CONTROL CONNECTORS")
        for i, (name, a, b) in enumerate(connectors, 1):
            columns[1].append(f'K{i:02d}  {name}: {pk[a]} → {pk[b]}')
    # Keep clean labels below the very shallow actual profile; never exaggerate z.
    legend_y = plot_bottom + (145 if diagnostic else 65)
    wrapped = [[line for row in column for line in textwrap.wrap(row, 76 if diagnostic else 95,
                                                               break_long_words=True, break_on_hyphens=False)]
               for column in columns]
    height = legend_y + max(map(len, wrapped))*19 + 45
    root = _root(width, height, "Longitudinal bottom guide", scale, not diagnostic)
    _text(root, 28, 34, "Longitudinal bottom guide", 23)
    _text(root, 28, 58, "Made-up design example — not a fit model · guide, not a bottom surface", 14)
    _text(root, 28, 80, "mm · forward y → / up z ↑ · equal axis scales, no height exaggeration · C1, not C2", 13)
    _text(root, 50, 115, "Rear", 12)
    _text(root, tx+ymax*scale-25, 115, "Toe", 12)
    group = _add(root, "g", id="bottom-geometry", transform=f'translate({_n(tx)} {_n(ty)}) scale(3 -3)')
    for name in sorted(refs):
        if diagnostic or name == "bottom_ground_projected_length":
            path = _add(group, "path", id=_id("reference", name), d=_line(model, refs[name]),
                        stroke="#84969b", stroke_width=".35", stroke_dasharray="1.5 1.5", fill="none")
            _add(path, "title", f'{rk[name]} {name}')
    if diagnostic:
        for i, (name, a, b) in enumerate(connectors, 1):
            path = _add(group, "path", id=_id("connector", name), d=f'M {_xy(model, a)} L {_xy(model, b)}',
                        stroke="#b18b66", stroke_width=".3", fill="none")
            _add(path, "title", f'K{i:02d} {name}')
    _add(group, "path", id="bottom-profile", d=_profile_path(model), stroke="#245f55", stroke_width=".7", fill="none")
    if diagnostic:
        for name in sorted(curves):
            path = _add(group, "path", id=_id("curve", name), d=_curve_path(model, name), stroke="#245f55", stroke_width=".7", fill="none")
            _add(path, "title", f'{ck[name]} {name}')
        ordered = sorted(points, key=lambda n: (points[n]["y"], points[n]["z"], n))
        for i, name in enumerate(ordered):
            p = points[name]
            color = {"landmark": "#245f55", "handle": "#a66b38", "reference": "#667f94"}[p["kind"]]
            marker = _add(group, "circle", id=_id("point", name), cx=_n(p["y"]), cy=_n(p["z"]), r=".9", fill=color)
            _add(marker, "title", f'{pk[name]} {name}')
            x, y = tx+p["y"]*scale, ty-p["z"]*scale
            lx, ly = 50 + i*(width-100)/max(1, len(ordered)-1), plot_bottom+58+(i%2)*24
            _add(root, "path", id=_id("callout", name), d=f'M {_n(x)} {_n(y)} L {_n(lx)} {_n(ly-13)}', stroke="#c3cdc7", stroke_width=".6", fill="none")
            _text(root, lx, ly, pk[name], 12, text_anchor="middle")
    _text(root, 50, ground_y+22, "Ground z = 0 · datum, not a sole", 12)
    for col, lines in enumerate(wrapped):
        for i, line in enumerate(lines):
            _text(root, 28+col*600, legend_y+i*19, line, 12, font_family="monospace")
    return ET.tostring(root, encoding="unicode") + "\n"


def render_bottom_comparison(baseline, variants):
    """Overlay each variant with one baseline; every panel shares one uniform scale."""
    models = [baseline] + [v["model"] for v in variants]
    for model in models:
        _validate(model)
    ymin, ymax, zmin, zmax = _bounds(models)
    scale = 3
    width = max(1100, (ymax-ymin)*scale+100)
    panel_height = 170+(zmax-zmin)*scale
    root = _root(width, 140+len(variants)*panel_height, "Bottom guide single-input comparisons")
    _text(root, 28, 34, "Bottom guide · one number at a time", 23)
    _text(root, 28, 58, "Made-up designs — not fit models · longitudinal guides, not bottom surfaces", 14)
    _text(root, 28, 80, "mm · forward y → / up z ↑ · every panel uses equal scales, without height exaggeration", 13)
    _add(root, "path", id="baseline-legend", d="M 28 104 H 65", stroke="#87969a", stroke_width="2", stroke_dasharray="5 4")
    _text(root, 75, 109, "Baseline", 13)
    _add(root, "path", id="variant-legend", d="M 180 104 H 217", stroke="#267166", stroke_width="2")
    _text(root, 227, 109, "Variant · small or coincident differences need the numeric report", 13)
    for i, variant in enumerate(variants):
        y = 140+i*panel_height
        name, change = variant["name"], variant["change"]
        _text(root, 28, y+22, variant["label"], 18)
        unit = baseline["dimensions"].get(change["field"], {}).get("units", "mm")
        _text(root, 28, y+45, f'{change["field"]}: {_n(change["from"])} → {_n(change["to"])} {unit}', 13, font_family="monospace")
        tx, ty = 50-ymin*scale, y+75+zmax*scale
        group = _add(root, "g", id=_id("panel", name), transform=f'translate({_n(tx)} {_n(ty)}) scale(3 -3)')
        ref = baseline["reference_lines"]["bottom_ground_projected_length"]
        _add(group, "path", id=_id("ground", name), d=_line(baseline, ref), stroke="#bfcac6", stroke_width=".3", fill="none")
        _add(group, "path", id=_id("variant", name), d=_profile_path(variant["model"]), stroke="#267166", stroke_width=".8", fill="none")
        _add(group, "path", id=_id("baseline", name), d=_profile_path(baseline), stroke="#87969a", stroke_width=".5", stroke_dasharray="1.5 1.5", fill="none")
        _text(root, 50, y+panel_height-20, "Ground z = 0 · C1 joins; curvature can change · no fit or contact-patch claim", 12)
    return ET.tostring(root, encoding="unicode") + "\n"
