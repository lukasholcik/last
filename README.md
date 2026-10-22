# Last guide viewer and numeric experiments

A local TypeScript application for the **outer silhouette seen from above** and an open longitudinal bottom guide.
It does not model the sole edge, upper surface, foot, or shoe fit.
Python numeric/SVG experiments remain as legacy references, not the production geometry runtime.
The example is made-up design data, not a measured foot or a population average.

## Browser viewer

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:3000**. Use **pnpm 10.28.2**, pinned in `package.json`.
The tested Node version is 22.23.1. The development/test toolchain supports Node `^22.12.0 || ^24.0.0 || >=26.0.0`;
not every newer odd-numbered release is supported by Vitest 5.

The application is based on an actual [create-t3-app](https://create.t3.gg/en/installation) scaffold,
adapted to **Next.js 16 App Router, React, TypeScript, Tailwind CSS, and tRPC**.
Three.js **0.186.1** displays reference guides. Fonts use local system fallbacks; no font/CDN fetch or Python service is required.
There is no authentication, database, or persistence layer.

```sh
pnpm build && pnpm start
pnpm check
pnpm test
```

The first line builds and runs the local production application; `check` runs ESLint and strict TypeScript,
and `test` runs the current TypeScript/Vitest suite. Neither runtime nor these checks requires Python.

The viewer now uses **250 mm along the bottom contour**, not a 250 mm forward projection.
`examples/contour-baseline.json` is a new designed target, deliberately not a migration preserving the old shape.
It is the single input document: `design.last_length`, top `_s` contour stations and side widths,
and bottom heel height, toe spring, seat arc length/angle, contact contour station, and blend arc length.
Forward projection and all `_y` stations are calculated, not competing editable numbers.

The single production geometry module, `src/lib/geometry` (`~/lib/geometry`), adapts those inputs to the ported constructors.
It is independent of React, Three.js, transport, and filesystem access. Raising the heel preserves each region's
contour length and maps each top station separately, keeping entered widths—not a uniform scaling of the top.
The baseline's seat/waist/blend/ramp arcs are 50/125/10/65 mm. Keeping these regions fixed is our explicit
prototype rule, not a vendor algorithm, anatomical law, or validated high-heel posture transformation.
Seat inclination remains a user control. Impossible combinations are rejected; length is not borrowed from another region.

The React viewer interaction contract covers numeric edits, the existing top/side guides, and rotatable 3D reference lines;
browser acceptance of that port is a separate check from numeric/API validation.
These are made-up **design** values, not foot measurements. Edits exist only in the browser;
rebuilding does not overwrite examples or save files. Reloading starts from the example defaults. No save feature yet.
Every edit invalidates the previous passed state and is marked as unapplied. Last-valid results may stay visible as reference,
but only a successful explicit rebuild for the current revision may restore passed status; stale responses must not replace newer edits.
The two 2D views use a shared uniform scale. The 3D view uses sampled curves, not dimensional measuring tools.
Placing the top at z=0 and the bottom guide at x=0 is **display-only embedding**: it does not define
a 3D last, anatomical centreline, upper/bottom surface, or bottom perimeter.

The `dev` and `start` scripts bind only to 127.0.0.1. Next serves the application; tRPC is mounted at `/api/trpc`.
`last.defaults` is a GET query returning the single `contour_last` document (schema 1);
`last.rebuild` is a POST mutation whose typed domain input is that document, not a separate top/bottom wrapper.
Use the generated tRPC client for its wire envelope rather than the old REST endpoints.
POST requests require JSON and matching supplied Origin/Host values; the 64 KiB body limit is enforced while reading the stream,
including when Content-Length is absent or understated.
The old `{top, bottom}` payload is rejected clearly, not silently converted.
Successful rebuilds return that input, models, derived projection/station mapping, three validation reports,
and 65-point samples per named curve. Actual contour lengths and station round trips are checked to 0.01 mm
using tight cubic arc-length bounds; top/bottom shape reports retain their existing meanings and tolerances.
Invalid inputs return 400; failed geometry checks return 422 with reports rather than successful models.
Unexpected errors return a sanitized 500 without private exception messages or development stacks.
This is a local experiment, not a public deployment setup.

[Three.js fundamentals](https://threejs.org/manual/#en/fundamentals) describes the display library,
not a source of last geometry or fit rules. If dependencies are missing, run `pnpm install --frozen-lockfile`.

### Verification and reference boundary

Nine frozen Python-generated fixtures in `tests-ts/fixtures` check cross-language parity of models, reports, derived data,
and curve samples. Independent TypeScript tests also check integration, regional lengths, station mapping, widths, joins,
ground contact, and boundary regressions. Passing fixture comparisons alone is not a general proof for arbitrary inputs.
The historical 86-test Python suite remains optional reference coverage, not a claim that every Python test was ported to TypeScript.

Only when intentionally regenerating the reference fixtures, run:

```sh
python3 scripts/generate-reference-fixtures.py
```

This optional reference operation rewrites the frozen fixtures; it is not part of install, build, runtime, or ordinary tests.
`viewer_server.py`, `web/`, and the Python geometry are retained temporarily for comparisons, not as a second supported production viewer.
The current startup is the pnpm/Next workflow above, not the old Python server.

Dependency note: the production dependency audit is clean. A known unpatched `braces` advisory remains in development-only
ESLint tooling; pnpm reports it as one high advisory. This is not a claim that the full development dependency tree is audit-clean.

## Run the legacy SVG experiments (optional Python reference)

The commands and examples below remain **legacy projected-length experiments**, unchanged for comparison.
Their `length: 250` still means 250 mm in the forward direction; the viewer's contour target does not relabel it.

Python 3.14 is available in the development environment. The numeric/SVG commands need only the standard library.

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

## Legacy SVG entered numbers

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

There is no free handle editing, toe-space guarantee, or 3D geometry yet.
Printing a matching shape does not establish fit. Fit must eventually be checked in an actual shoe.
See [the concept](docs/concept.md) and [software research](docs/software-research.md) for later questions.

## Bottom-guide experiment

The [bottom-profile specification](docs/bottom-profile.md) now has a separate numeric/SVG implementation.
It uses sourced last heel-height and toe-spring meanings, with our explicitly assumed four-curve rule.
There is no sole-thickness input. It is a y–z guide, not a bottom edge, complete bottom surface, or foot model.
No personal foot data or wrong-size high-heel last is used; entered dimensions stay authoritative.

```sh
python3 generate_bottom.py --top-input examples/baseline.json --input examples/bottom-baseline.json --output-dir output/bottom
python3 generate_bottom.py --top-input examples/baseline.json --input examples/bottom-baseline.json --output-dir output/bottom --variants examples/bottom-variants.json
```

The first command writes `baseline/clean.svg`, `baseline/diagram.svg`, `baseline/input.json`,
`baseline/model.json`, and `baseline/report.json` under `output/bottom`.
The second adds six named variant folders, `comparison.svg`, and `comparison-report.json`.
The recorded variant configuration changes one bottom control per example. Reports compare actual curve controls,
not guessed region dependencies. Top inputs are not changed; only `design.length` supplies the shared projected span.
The shared span is provisional alignment, not proof that top and bottom endpoints correspond on a real last.

Bottom JSON version 2 uses mm, with exactly six entered `design` fields:
`heel_height`, `toe_spring`, `seat_projected_length`, `seat_inclination_deg` (degrees), `contact_forward`, and `forepart_blend_length`.
The made-up baseline is 8, 10, 50, 2, 175, and 10 respectively. No independent bottom length is accepted.
Version 1 is deliberately rejected: regenerate with version 2 and an explicit blend length.
The top input is still version 1 and unchanged. The added variant changes blend length from 10 to 20 mm.
Heights may be zero; all lengths/heights are bounded by 10000 mm for numerical safety, not plausible-foot limits.
Require `0 < seat_projected_length < contact_forward < top length`, separated by at least 0.01 mm,
and an angle from 0 inclusive to 90 exclusive. Reject a below-ground seat front or waist start handle;
errors name the failed inequality. Blend length and the straight ramp's remaining forward length must
each be at least 0.01 mm. No input is silently corrected.

Four cubic curves follow the specification, with forward handle offsets of one third of each interval.
Seat slopes are (m,m), waist (m,0), contact blend (0,k), and straight forepart (k,k).
m is minus the tangent of the entered seat angle. With F = top length − contact position and b = blend length,
k = toe spring / (F − b/2). After a short upward-bending transition, the incline is exactly straight through the toe.
There is no separate ramp angle or flattening at a positive-height toe. The user approved the rounded transition
and explicit 10 mm development blend, replacing the rejected S-shaped version-1 rise—not an anatomical default.
The check measures resulting heights, stations, analytic minima, seat angle, and named handle positions.
It requires strictly forward curves, connected joins, and matching nonzero global `dz/dy` tangents—not equal
segment-local derivative magnitudes. Dimensions use 0.1 mm, angle 0.001 degree, as software tolerances only.
Flat zero-height regions are reported as ground intervals rather than a unique contact point.
Independent actual-curve checks require straightness of the ramp and upward-only curvature of the blend;
actual ground contact remains mandatory even when a small clearance would pass a size tolerance.

`bottom_arc_length` is derived separately from projected length. Recursive midpoint subdivision bounds each
cubic's length between its endpoint chord and control-polygon length. Each subdivision halves its error budget;
the total upper-minus-lower gap is at most 0.01 mm (midpoint uncertainty at most 0.005 mm), with a depth limit of 30.
These are floating-point geometric bounds, not manufacturing tolerances. Tests also compare a known curved integral,
a straight line, and tighter independent Simpson integration. Nonconvergence is an error, not a successful report.

Previous baseline and comparison success reports are invalidated before CLI input reading, plus old variant reports
listed in the previous comparison audit. Conflicting directories are preserved with a stale-report warning;
no recursive cleanup occurs. Inputs must be outside the output folder. Success reports are written after all requested
models and SVGs. Failed runs leave no new overall success claim; older SVGs without current reports may remain.

The production browser viewer uses one TypeScript geometry implementation independent of its React/Three.js display.
The Python implementations above remain legacy comparison tools, not runtime dependencies.
Three.js displays reference guides only. Blender remains an optional future export destination.
