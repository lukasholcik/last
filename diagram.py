"""Render a named, millimetre-based cubic model without changing its geometry."""

import math
import textwrap
import xml.etree.ElementTree as ET


def _id(kind, name):
    """Names remain collision-free even when they contain XML punctuation."""
    return kind + "-" + name.encode("utf-8").hex()


def _n(value):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Coordinates must be finite")
    return format(value, ".12g")


def render_svg(model, diagnostic=True):
    """Return an SVG. Clean viewBox units are mm; diagnostic units are pixels.

    Both outputs contain the identical model-coordinate silhouette path. SVG
    transforms only place it on the page and turn longitudinal +y upward.
    Physical page dimensions do not guarantee true-scale printing.
    """
    if model["units"] != "mm":
        raise ValueError("The renderer expects model units 'mm'")
    points = model["points"]
    curves = model["curves"]
    references = model["reference_lines"]
    outline = model["outline"]
    if not points or not outline:
        raise ValueError("A model needs points and a closed outline")
    for point in points.values():
        _n(point["x"])
        _n(point["y"])

    def xy(name):
        p = points[name]
        return f'{_n(p["x"])} {_n(p["y"])}'

    def cubic(name):
        c = curves[name]
        return f'C {xy(c["control1"])} {xy(c["control2"])} {xy(c["end"])}'

    first = curves[outline[0]]["start"]
    previous = first
    for name in outline:
        c = curves[name]
        if c["start"] != previous:
            raise ValueError("Outline curves must be connected in order")
        previous = c["end"]
    if previous != first:
        raise ValueError("Outline must be closed")
    path = "M " + xy(first) + " " + " ".join(cubic(n) for n in outline) + " Z"
    xs = [float(p["x"]) for p in points.values()]
    ys = [float(p["y"]) for p in points.values()]
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    spanx, spany = xmax - xmin, ymax - ymin
    rows = []
    wrapped = []
    legend_columns = []
    plot_width = 0
    point_keys = {name: f'P{i:02d}' for i, name in enumerate(sorted(points), 1)}
    curve_keys = {name: f'C{i:02d}' for i, name in enumerate(sorted(curves), 1)}
    ref_keys = {name: f'R{i:02d}' for i, name in enumerate(sorted(references), 1)}
    connectors = []
    for name in sorted(curves):
        c = curves[name]
        for suffix, start, end in (("start_to_control1", c["start"], c["control1"]),
                                   ("control1_to_control2", c["control1"], c["control2"]),
                                   ("control2_to_end", c["control2"], c["end"])):
            connectors.append((name + "." + suffix, start, end))

    if diagnostic:
        dimensions = model.get("dimensions", {})
        if dimensions:
            rows.append(("DESIGN DIMENSIONS · entered targets, not fit checks", True))
            for name in sorted(dimensions):
                d = dimensions[name]
                ref = ref_keys[d["reference_line"]]
                label = name.replace("_half_width", " side extent").replace("_", " ").capitalize()
                value = f'{label}: {_n(d["expected"])} mm'
                if d["kind"] == "side_extent":
                    value += f' at y={_n(d["station_y"])} mm'
                elif d["kind"] == "length":
                    value += f' (y={_n(d["start_y"])} to {_n(d["end_y"])} mm)'
                rows.append((f'{ref}  {value}', False))
        rows.append(("POINTS · coordinates in mm, rounded to 0.001", True))
        for name in sorted(points):
            p = points[name]
            x, y = _n(round(p["x"], 3)), _n(round(p["y"], 3))
            rows.append((f'{point_keys[name]}  {name} [{p["kind"]}]  ({x}, {y})', False))
        first_column = rows
        rows = []
        rows.append(("CURVES · start / handle / handle / end", True))
        for name in sorted(curves):
            c = curves[name]
            keys = " / ".join(point_keys[c[k]] for k in ("start", "control1", "control2", "end"))
            rows.append((f'{curve_keys[name]}  {name}: {keys}', False))
        rows.append(("REFERENCE LINES", True))
        for name in sorted(references):
            r = references[name]
            rows.append((f'{ref_keys[name]}  {name}: {point_keys[r["start"]]} → {point_keys[r["end"]]}', False))
        rows.append(("CONTROL CONNECTORS · straight construction lines", True))
        rows.append(("Cxx.suffix means the full curve name plus that suffix.", False))
        for i, (name, start, end) in enumerate(connectors, 1):
            curve_name, suffix = name.rsplit(".", 1)
            rows.append((f'K{i:02d}  {curve_keys[curve_name]}.{suffix}: {point_keys[start]} → {point_keys[end]}', False))
        for column in (first_column, rows):
            legend_columns.append([(line, heading) for value, heading in column
                                   for line in textwrap.wrap(value, width=66, break_long_words=True, break_on_hyphens=False)])
        wrapped = max(legend_columns, key=len)
        scale = 2.6
        plot_width = max(500, spanx * scale + 240)
        width = plot_width + 1200
        count_side = max(sum(p["x"] < (xmin + xmax) / 2 for p in points.values()),
                         sum(p["x"] >= (xmin + xmax) / 2 for p in points.values()))
        plot_height = max(620, spany * scale + 150, count_side * 22 + 150)
        height = max(plot_height, 150 + len(wrapped) * 19)
        tx = plot_width / 2 - (xmin + xmax) / 2 * scale
        ty = 120 + ymax * scale
    else:
        scale = 1
        width, height = max(140, spanx + 24), spany + 48
        tx = width / 2 - (xmin + xmax) / 2
        ty = 30 + ymax

    root = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg", "viewBox": f'0 0 {_n(width)} {_n(height)}',
                              "width": _n(width) + ("px" if diagnostic else "mm"),
                              "height": _n(height) + ("px" if diagnostic else "mm"),
                              "role": "img", "aria-labelledby": "diagram-title diagram-description"})

    def element(tag, attrs=None, parent=None, text=None):
        e = ET.SubElement(root if parent is None else parent, tag, {k: str(v) for k, v in (attrs or {}).items()})
        if text is not None:
            e.text = text
        return e

    element("title", {"id": "diagram-title"}, text="Outer top silhouette of a shoe last")
    element("desc", {"id": "diagram-description"}, text="Made-up design example — not a fit model. Not a sole outline. Coordinates in mm; medial is negative x, lateral positive x, forward positive y. Printing scale is not guaranteed.")
    element("rect", {"width": "100%", "height": "100%", "fill": "#faf9f6"})

    def text(x, y, value, size: float = 13, color="#293d40", **attrs):
        return element("text", {"x": _n(x), "y": _n(y), "font-family": "Georgia, serif", "font-size": size, "fill": color, **attrs}, text=value)

    text(28 if diagnostic else 8, 34 if diagnostic else 9, "Outer top silhouette", 23 if diagnostic else 5)
    text(28 if diagnostic else 8, 57 if diagnostic else 16, "Made-up design example — not a fit model", 14 if diagnostic else 3.5)
    text(28 if diagnostic else 8, 78 if diagnostic else 22, "Not a sole outline · mm · medial −x / lateral +x · forward +y ↑", 12 if diagnostic else 2.8)
    geometry = element("g", {"id": "model-geometry", "transform": f'translate({_n(tx)} {_n(ty)}) scale({_n(scale)} -{_n(scale)})'})
    element("path", {"id": "outline", "d": path, "fill": "#dce9e5" if diagnostic else "#293d40",
                     "stroke": "#245b54" if diagnostic else "none", "stroke-width": "0.65", "stroke-linejoin": "round"}, geometry)
    if diagnostic:
        for name in sorted(references):
            r = references[name]
            e = element("path", {"id": _id("reference", name), "d": f'M {xy(r["start"])} L {xy(r["end"])}',
                                 "stroke": "#768c99", "stroke-width": ".5", "stroke-dasharray": "2 2", "fill": "none"}, geometry)
            element("title", parent=e, text=f'{ref_keys[name]} {name}')
            a, b = points[r["start"]], points[r["end"]]
            rx = tx + (a["x"] + b["x"]) / 2 * scale
            ry = ty - (a["y"] + b["y"]) / 2 * scale
            text(rx + (8 if a["x"] == b["x"] else 0), ry - 6, ref_keys[name], 10,
                 color="#526c7c", **{"id": _id("reference-label", name), "text-anchor": "middle"})
        for i, (name, start, end) in enumerate(connectors, 1):
            e = element("path", {"id": _id("connector", name), "d": f'M {xy(start)} L {xy(end)}',
                                 "stroke": "#ba9373", "stroke-width": ".35", "fill": "none"}, geometry)
            element("title", parent=e, text=f'K{i:02d} {name}')
        for name in sorted(curves):
            e = element("path", {"id": _id("curve", name), "d": "M " + xy(curves[name]["start"]) + " " + cubic(name),
                                 "stroke": "#245b54", "stroke-width": ".7", "fill": "none"}, geometry)
            element("title", parent=e, text=f'{curve_keys[name]} {name}')
        for name in sorted(points):
            p = points[name]
            color = {"landmark": "#245b54", "handle": "#a66b38", "reference": "#667f94"}[p["kind"]]
            e = element("circle", {"id": _id("point", name), "cx": _n(p["x"]), "cy": _n(p["y"]),
                                   "r": "1.2", "fill": color, "stroke": "#faf9f6", "stroke-width": ".4"}, geometry)
            element("title", parent=e, text=f'{point_keys[name]} {name}')
        # Callouts use independent, vertically spaced rails; model points never move.
        for left in (True, False):
            names = [n for n in sorted(points) if (points[n]["x"] < (xmin + xmax) / 2) == left]
            names.sort(key=lambda n: (-points[n]["y"], n))
            last_y = 105
            for name in names:
                p = points[name]
                px, py = tx + p["x"] * scale, ty - p["y"] * scale
                label_y = max(py, last_y + 22)
                last_y = label_y
                label_x = 45 if left else plot_width - 45
                element("path", {"id": _id("callout", name), "d": f'M {_n(px)} {_n(py)} L {_n(label_x)} {_n(label_y)}',
                                 "fill": "none", "stroke": "#bfc9c5", "stroke-width": ".7"})
                text(label_x - 5 if left else label_x + 5, label_y + 4, point_keys[name], 12,
                     **{"text-anchor": "end" if left else "start"})
        # Extend the page if low-lying points require additional callout rows.
        max_callout_y = max(float(e.attrib["y"]) for e in root.findall("text"))
        height = max(height, max_callout_y + 40)
        root.set("height", _n(height) + "px")
        root.set("viewBox", f'0 0 {_n(width)} {_n(height)}')
        element("path", {"d": f'M {_n(plot_width)} 100 V {_n(height - 24)}', "stroke": "#d8dfda"})
        for column_index, column in enumerate(legend_columns):
            for i, (line, heading) in enumerate(column):
                text(plot_width + 24 + column_index * 600, 117 + i * 19, line, 12,
                     **{"font-family": "monospace", "font-weight": "bold" if heading else "normal"})
    return ET.tostring(root, encoding="unicode") + "\n"
