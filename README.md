# Numeric last-outline experiment

A small Python standard-library prototype for the **outer silhouette seen from above**.
It does not model the sole edge, bottom profile, upper surface, foot, or shoe fit.
The example is made-up design data, not a measured foot or a population average.

## Run

Python 3.14 is available in the development environment. No dependencies to install.

```sh
python3 generate.py --input examples/baseline.json --output-dir output
python3 -m unittest discover -s tests -v
```

Geometry generation, verification, and SVG rendering are separated in `last_shape.py`, `generate.py`, and `diagram.py`.
It produces `silhouette.svg`, `diagram.svg`, `model.json`, and `report.json`.
Open the SVGs in a browser to see the images. No PNGs or screenshots are kept in the repository.
Runs remove the previous report first, then this generator's other output files.
Failures return a nonzero exit code. Conflicting directories are never deleted recursively;
if the previous report cannot be removed, a warning says it may be stale.
A failed geometry check writes a failed report; other errors are printed to the terminal.
The success report is written last. Other files in the output folder are left alone.

## Compare variants

To generate single-input comparisons:

```sh
python3 compare_variants.py --output-dir output/variants
```

`examples/variants.json` records labelled made-up changes relative to the unchanged baseline.
Each output folder includes its complete input, clean/diagnostic SVGs, model and validation report.
`comparison.svg` overlays the baseline and each variant at the same scale and origin.
`comparison-report.json` lists every changed and identical curve by exact control coordinates,
the input change, all nine dimension checks, and each changed curve's largest control displacement.
That displacement bounds equal-parameter contour movement; it is not a width or fit measurement.

Changes are local but not necessarily confined to the two segments touching a landmark:
neighbouring slopes depend on three stations, so their handles can change an extra segment.
Both tip caps share a tangent set by the smaller adjacent side width. Changing that minimum
can therefore alter the opposite cap too. Remote unaffected curves remain exactly identical;
the report records actual dependencies rather than promising an artificial two-segment limit.

The four recorded variants change lateral ball extent 48→54 mm and 48→42 mm, medial toe
extent 33→27 mm, and medial ball position 175→185 mm, one value per example.
Visual review of their actual clean silhouettes, diagnostics and shared-scale overlays found
no new corners, loops or unwanted bulges requiring a geometry correction. The wider ball
has a stronger S-shaped waist transition; the narrower medial toe makes the toe box asymmetric.
This is a bounded review of these examples, not a guarantee for arbitrary dimensions or fit.

## Entered numbers

The JSON format is version 1, in millimetres. `design` contains only:
- `length`: heel tip to toe tip along the forward direction.
- `{medial|lateral}_{heel|waist|ball|toe}_y`: forward position of each named region.
- `{medial|lateral}_{heel|waist|ball|toe}_width`: positive distance from the centre line to that side.

Across the shape is x: big-toe/medial is negative, little-toe/lateral positive.
Forward is y: heel tip is 0; toe tip is `length`. This convention does not select a right or left foot.
Each side must have `0 < heel_y < waist_y < ball_y < toe_y < length`.
Input values must be finite and within 0.01–10000 mm, with at least 0.01 mm between positions.
These are numerical safety limits, **not** plausible-foot ranges or fit advice.

The two ball positions may differ. A ball width belongs to its own side's y position.
When the positions differ, adding the two entered widths is **not** a width across one section.
The report instead calculates both outline intersections at each requested y and gives that section's full width.
No total widths, handle positions, or calculated lengths are editable inputs, so there are no competing numbers.
Foot-length-plus-extension remains a possible later input scheme, not part of version 1.

## How the shape is made

There is one rounded toe style. Ten cubic Bézier segments join the heel tip, four lateral regions,
toe tip, and four medial regions back to the heel tip.
At each side region, the tangent follows the neighbouring changes in side width per forward millimetre.
Its slope is the gap-weighted harmonic mean of those two slopes when they have the same sign;
at a true width extremum or a flat interval it is zero. Thus a narrowing toe station is not forced
to become another width extremum. The tangent's longitudinal reach is 1.5 times the shorter y gap,
limited further so each handle uses at most half either neighbouring width change.
At each tip the tangent is horizontal, with length 1.5 times the smaller adjacent side width.
Each handle is one third of its landmark's tangent. Longer tip handles round the caps rather than
pinching them, and the same tangent is used on both sides of every join.
These are simple modelling assumptions, not anatomical rules or copied vendor algorithms.
They give identical first derivatives (C1 continuity), not matching curvature (C2 continuity).
Curvature can still change at landmarks, and almost equal heel/waist widths still produce nearly
straight sides. Extreme input proportions can look awkward despite passing numeric checks.
Visual inspection of the revised baseline shows rounder caps and no previous toe-side shoulders.
The nearly straight heel-to-waist sides remain; visual smoothness does not establish a valid last shape or fit.

Every landmark, handle, curve, and reference line has a stable descriptive name.
`build_model(inputs)` returns the shared JSON-friendly points/curves/reference-lines/outline format.
Curve endpoints and handles refer to names in `points`. References include the centre axis and each side width.
`dimensions` maps stable names to `length` or `side_extent` definitions, their expected mm values,
and named reference lines. Side extents specify `side` and `station_y`; length specifies `start_y` and `end_y`.
These definitions are for diagram labels, not substitutes for the report's independent curve measurements.
The mesh/renderer does not supply dimensions back to the numeric model.

## What the checks establish

The report lists actual, expected, tolerance, and pass/fail for checks.
Dimensions are checked to 0.1 mm on the resulting curves, not by echoing input or measuring landmarks alone.
Longitudinal bounds use analytic cubic extrema. Cross-sections split curves at those extrema,
then find roots by 60 bisection steps. Closure and matching nonzero first derivatives are checked at every join.
Control-point half-planes and monotone y certify that this construction cannot cross itself:
each side is a single-valued curve, and opposite sides meet only at the tips.
Monotone x control polygons also prevent width overshoot between neighbouring landmarks;
tests independently check the actual cubic x extrema on the baseline and modest variations.
An additional test checks nonadjacent chords from 32 samples per curve.
That sampled test is not an exact general-purpose cubic intersection test.

There is no free handle editing, toe-space guarantee, heel elevation, bottom or 3D geometry yet.
Printing a matching shape does not establish fit. Fit must eventually be checked in an actual shoe.
See [the concept](docs/concept.md) and [software research](docs/software-research.md) for later questions.
