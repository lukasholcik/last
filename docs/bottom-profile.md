# Longitudinal bottom guide — v2 specification and experiment

**Status: numeric/SVG reference guide and production TypeScript contour-length adapter implemented.** This defines an open guide,
not a bottom surface. The current Next.js/React viewer uses Three.js for display and tRPC for the shared TypeScript geometry API.
Python is retained for legacy SVG experiments and parity references, not the production runtime; React/browser acceptance is separate.

Version 2 replaces the rejected S-shaped toe rise: a short rounded contact transition now joins
an exactly straight inclined forepart through the toe. The user chose this shape and an explicit
10 mm development blend length; neither is an anatomical default or an ISO curve recipe.
Legacy projected bottom inputs and generated bottom models use `schema_version: 2`; regenerate v1 projected data with the explicit
`forepart_blend_length` field. Top inputs remain version 1 and unchanged.

## Current browser: a new contour-length target

The browser accepts one `contour_last` schema-1 document from `examples/contour-baseline.json`.
Its designed `last_length: 250` means the actual bottom contour, deliberately **not** the old 250 mm
forward projection or a conversion that preserves the previous shape. `src/lib/geometry` ports the corrected
top/bottom construction and contour mapping from the Python reference; the projected version-2 controls described below remain internal
calculated inputs and remain available in the legacy SVG experiments, not editable browser alternatives.

Enter seat arc S, contact contour station C, blend arc J, total arc A, rear height H, toe spring T,
and seat angle a. The baseline is S=50, C=175, J=10, A=250, H=8, T=10, a=2°.
The fixed regional arcs are S, C−S, J, and A−C−J. All must retain at least 0.01 mm, and 0≤a<90°.
They are 50/125/10/65 mm for the baseline. During heel edits these regions stay fixed, while seat inclination remains user-controlled;
impossible combinations are rejected rather than silently changing the angle or redistributing arc length.
Top `_s` stations are also distances along this bottom guide; their side widths remain entered values.
This anchoring and regional preservation are **our prototype rules**, not anatomical correspondence or vendor algorithms.

Seat projection is S cos(a), and its front height is H−S sin(a). The existing cubic waist is built
repeatedly to solve its forward span for arc C−S. Its projected bracket starts at 0.01 mm and ends
at C−S, limited by the existing nonnegative-handle rule. Unattainable arc/vertical-drop/angle combinations
are rejected; the solver never borrows length from the forepart.

For the existing quadratic blend and straight ramp, let R=A−C−J and k be their shared ramp slope.
Q(k)=(√(1+k²)+asinh(k)/k)/2, with Q(0)=1. Blend projection b=J/Q(k), ramp projection
r=R/√(1+k²), and T=k(b/2+r). A bounded bracket/bisection solve finds k; T=0 gives k=0.
Require T<J+R and both projected forepart spans at least 0.01 mm. No independent ramp angle is added.
This solves the already-approved curve, not a new footwear shape recipe.

Actual cubic chord/control-polygon bounds use a 0.00001 mm gap budget for each measurement, much tighter
than the final 0.01 mm contour checks. Waist bisection has at most 64 steps; slope bracketing/bisection
at most 64/80; station inversion at most 48. Prefix curves use de Casteljau subdivision.
Repeated stations share cached mappings. Each top station maps individually onto the actual guide;
the top is not uniformly shortened. Its derived projected gaps must still satisfy the unchanged top builder.

The new report checks total and regional arcs plus station round trips from resulting curves, not derived labels.
Legacy top/bottom shape reports still check their projected dimensions and actual contact; all three reports
must pass before the API returns models. Projected length remains labelled as projected in legacy model metadata.
No 3D last, fit guarantee, or validated heel-posture transformation follows from preserving these arcs.
The typed `last.defaults` query and `last.rebuild` mutation are mounted at `/api/trpc`; invalid inputs return 400,
failed checks return 422 with reports and no successful models, and unexpected errors return sanitized 500 responses.
The production module is independent of React/Three.js and transport. Nine frozen Python parity fixtures and independent
TypeScript invariant tests cover the port; optional reference regeneration and current pnpm commands are in [README](../README.md).

## Legacy projected-coordinate construction

## What this curve describes

A single open guide in the **y–z plane**, in millimetres: y runs forward from the rear
endpoint, z runs upward, and the horizontal ground reference is **z = 0**. It describes
our intended longitudinal bottom shape in one fixed design orientation. Increasing heel
height moves the rear endpoint; it does not rotate an unchanged last.

This is **not yet** a measured 3D bottom centreline, a medial or lateral bottom edge,
the lowest side-view silhouette of a surface, an arch section, or a sole outline.
Those curves can differ on a real last. No x coordinate, transverse crown, twist,
feather edge, sole thickness, or upper surface is defined here. A later surface must
establish which spatial curve this guide controls; setting x = 0 would be a new assumption.

The existing top curve remains the **outer silhouette seen from above**, not the bottom
edge. Its baseline projected length is 250 mm (`examples/baseline.json`). Reuse its y range
provisionally for alignment, without changing any top inputs. This is a shared coordinate
range, not evidence that the guide endpoints are anatomical counterparts of the top tips.
In particular top `heel_tip`, `medial_heel`, and `lateral_heel` are outer-silhouette
landmarks, not bottom rear or seat-front landmarks. Do not reuse their point identities
or derive seat length from their stations. The top ball landmarks likewise do not locate
bottom contact. Any future bottom-to-top endpoint offsets need an explicit correspondence
decision; the provisional 0–250 mm alignment does not settle that geometry.

## Sources and what we take from them

1. [ISO 19408:2023 preview](https://cdn.standards.iteh.ai/sist-preview/83107/cb5f303e387a42a6842831f8721fb244/ISO-19408-2023.pdf):
   §3.2.6 relates last heel height to the rear underside; §3.2.7 identifies the heel seat;
   §3.2.13 treats toe spring as the toe underside's height above the ground in the last's
   normal orientation. Here these motivate ground-normal **distances**, not toe angles
   or shoe-stack heights. The preview is not a complete measurement procedure or a claim
   that our guide is ISO-compliant. Its §3.2.1 bottom-arc length is not our projected y length.
2. [Bill Bird, The Anatomy of a Shoe Last](https://shoemaking.wiki/The_Anatomy_of_a_Shoe_Last):
   the breast line is the front edge of the heel seat; the base plane locates the tread
   point, and the tread point is where the forepart crown contacts it. The heel-seat
   diagrams/terminology motivate distinguishing a seat from a waist. This source also uses
   shoe/heel terms including top-piece allowances; do **not** import those into our last's
   rear-endpoint height. Use the ISO last terminology for that distinction.
3. [3DShoemaker measurements](https://3dshoemaker.com/measurements-in-shoe-last-maker/)
   explicitly measures last length along the bottom profile and distinguishes functional
   from full length, with template/adapt choices. Its primary length, girths, ball width
   and heel height are not five numbers that uniquely determine arbitrary last geometry.
   [Its introduction](https://3dshoemaker.com/parametric-shoe-last-design-software-introduction-to-shoelastmaker/)
   explains separate body/toe and component templates: templates supply otherwise missing
   shape. The published measurement diagrams are
   [Primary-Measurements-in-Shoe-Last-Maker.jpg](https://3dshoemaker.com/wp-content/uploads/2022/05/Primary-Measurements-in-Shoe-Last-Maker.jpg)
   and [Shoe-Last-Maker-Measurements.png](https://3dshoemaker.com/wp-content/uploads/2022/05/Shoe-Last-Maker-Measurements.png).
   We do not copy their proportions, allowances, wedge calculation, or sizing rules.
4. [MDN, cubic Bézier paths](https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorials/SVG_from_scratch/Paths)
   describes two endpoint-direction control points per cubic. This supports the curve
   representation, not footwear suitability. The particular interpolation below is **our
   explicit prototype assumption**, not a published last-design algorithm.

Thus the sources support the named regions and height/length distinctions. They do not
provide the following seat angle, contact position, tangent choices, or a ballet-flat fit
formula. Every example value below is made up. Any later shoemaking control or change to
these meanings must be checked against a named source, with unsupported choices marked
as assumptions rather than presented as established practice.

## Smallest control set

All are **designed, entered** values, not measured foot data. Lengths are mm; angle is
explicitly degrees. There are six bottom controls plus the shared projected length.

| Stable control name | Meaning | Editable versus derived |
| --- | --- | --- |
| `projected_length` (L) | Forward separation of rear and toe-bottom endpoints | Shared from current top `design.length`; do not create a competing length input |
| `heel_height` (H) | z of the rear underside guide endpoint above ground | Entered; not an external heel/sole stack |
| `toe_spring` (T) | z of the toe-bottom endpoint above ground | Entered height, not angle |
| `seat_projected_length` (S) | y of the front heel-seat/breast guide point | Entered horizontal projection, not seat arc length |
| `seat_inclination_deg` (a) | Downward-forward angle of the straight seat to horizontal | Entered; zero means horizontal |
| `contact_forward` (C) | y of the designated forepart ground-contact guide point | Entered independently of top ball landmarks |
| `forepart_blend_length` (b) | Forward length of the rounded transition after contact | Entered; 10 mm is only the chosen development example |

The current medial/lateral ball stations (175 and 165 mm) do **not** determine C, nor does
their mean. A 2D contact guide is not a measured 3D tread point or a contact patch.
Toe spring begins rising immediately forward of C, rounds into a straight ramp, and does not
flatten again at a positive-height toe. There is no independent ramp angle: it follows from
the chosen height, remaining length, and blend length. The seat remains straight, not a claim
that real heel seats lack slope variation or curvature.

## Stable geometry names and derived points

Write coordinates as **(y, z)**, not the top renderer's (x, y). Let m = −tan(a), with degree
conversion explicit. Let B = H + mS be the front-seat height; W = C − S and F = L − C.
Let k = T / (F − b/2), the derived ramp slope.

| Point name | Kind | Coordinate |
| --- | --- | --- |
| `bottom_heel_rear` | landmark | (0, H) |
| `bottom_seat_front` | landmark | (S, B) |
| `bottom_forepart_contact` | landmark | (C, 0) |
| `bottom_forepart_blend_end` | landmark | (C + b, kb/2) |
| `bottom_toe_end` | landmark | (L, T) |
| `bottom_heel_ground` | reference | (0, 0) |
| `bottom_toe_ground` | reference | (L, 0) |
| `bottom_seat_horizontal_front` | reference | (S, H) |
| `bottom_forepart_blend_ground_end` | reference | (C + b, 0) |

The four curves, ordered rear to front, are:

- `bottom_heel_seat`: `bottom_heel_rear` → `bottom_seat_front`.
- `bottom_waist`: `bottom_seat_front` → `bottom_forepart_contact`.
- `bottom_forepart_blend`: `bottom_forepart_contact` → `bottom_forepart_blend_end`.
- `bottom_forepart_ramp`: `bottom_forepart_blend_end` → `bottom_toe_end`.

Every curve has derived points named `<curve>_handle_start` and `<curve>_handle_end`.
No handles are independently editable. Name all straight construction connectors
`<curve>_start_to_handle_start`, `<curve>_handle_start_to_handle_end`, and
`<curve>_handle_end_to_end`; each refers to the corresponding named points above.

Reference lines have these exact endpoint references:

| Reference line | Start → end | Meaning |
| --- | --- | --- |
| `bottom_ground_projected_length` | `bottom_heel_ground` → `bottom_toe_ground` | z = 0 over the design range; projected L |
| `bottom_heel_height` | `bottom_heel_ground` → `bottom_heel_rear` | H |
| `bottom_toe_spring` | `bottom_toe_ground` → `bottom_toe_end` | T |
| `bottom_seat_horizontal` | `bottom_heel_rear` → `bottom_seat_horizontal_front` | Projected S; horizontal angle reference |
| `bottom_seat_chord` | `bottom_heel_rear` → `bottom_seat_front` | Seat chord; inclination measured downward from the horizontal reference |
| `bottom_contact_forward` | `bottom_heel_ground` → `bottom_forepart_contact` | C; intentionally overlaps part of ground reference |
| `bottom_forepart_blend_projection` | `bottom_forepart_contact` → `bottom_forepart_blend_ground_end` | b along ground |

Coincident reference points/lines at zero heights retain their names. A diagnostic must
key overlapping construction in a readable legend rather than hide or anonymously merge it.

## Implemented cubic rule

Use four cubic Bézier segments. For endpoints P = (y0, z0), Q = (y1, z1), interval
h = y1 − y0, and endpoint slopes u and v (dz/dy), define:

- Start handle: (y0 + h/3, z0 + uh/3).
- End handle: (y1 − h/3, z1 − vh/3).

Apply these slope pairs:

| Curve | Start slope u | End slope v |
| --- | --- | --- |
| `bottom_heel_seat` | m | m |
| `bottom_waist` | m | 0 |
| `bottom_forepart_blend` | 0 | k |
| `bottom_forepart_ramp` | k | k |

This makes y linear in each local Bézier parameter. The seat is exactly straight; the
waist eases from its inclination into a horizontal ground tangent. With s = y − C, the blend is
z = ks²/(2b) for 0 ≤ s ≤ b; the ramp is z = k(s − b/2) for b ≤ s ≤ F.
The blend bends upward only, then joins the exact straight incline. Positive T gives a positive
toe-end slope, not the superseded version-1 horizontal toe tangent. These are our approved
shape assumptions, not a sourced universal last shape.

All three internal joins have the same dz/dy from each side. Consequently the combined graph
z(y) is **C1 in global forward coordinate y**, with a nonzero tangent (1, dz/dy), including
(1, 0) at contact. Separate segment-local t derivatives have magnitude proportional to h:
do not claim they are equal when intervals differ. A local-t check must compare normalized
directions with matching forward orientation; a global-y check compares dz/dy. This is
not C2: curvature can jump at seat front, contact, and blend end. No corner or cusp is acceptable.

### Admissible inputs and no-ground-crossing rule

Require finite values, L > 0, 0 < S < C < L, H ≥ 0, T ≥ 0, and 0° ≤ a < 90°.
Require S, C − S, b, and F − b each to be at least 0.01 mm, a numerical separation rule rather
than a plausible-foot limit. Additionally require:

- B = H − S tan(a) ≥ 0.
- B − W tan(a)/3 ≥ 0 (the waist start handle must not fall below ground).

Reject conflicts with the names and failed inequality shown; **never silently alter an
entered height, angle, contact station, or top input**. In particular not every seat
inclination is possible for a given H, S and C under this minimal rule.

These constraints order the waist's z controls B, B − W tan(a)/3, 0, 0. The blend's controls
are 0, 0, kb/6, kb/2; the straight ramp continues at slope k. Thus the waist descends and
the forepart rises monotonically, with
no control or curve below ground. Every segment is strictly forward because y is linear
with h > 0; the whole guide is a graph and cannot self-intersect. Contact is a global
minimum at zero with a horizontal nonzero tangent. It need not be a **unique** minimum:
H = 0 with a = 0 gives a flat seat/waist, and T = 0 gives a flat forepart. Report ground
intervals in these cases, not an invented unique tread point.

## Made-up design example — not a fit model

Keep all existing top inputs unchanged. Use L = 250 mm from the top baseline, with
H = 8 mm, T = 10 mm, S = 50 mm, a = 2°, C = 175 mm, and b = 10 mm **only for this development experiment**.
C happens to equal the current medial ball station here; that coincidence is not a rule.

Then m ≈ −0.034921, B ≈ 6.254 mm, W = 125 mm, and F = 75 mm. The seat-front point is
(50, 6.254), contact (175, 0), blend end (185, 0.714), and toe end (250, 10).
k ≈ 0.142857. Rounded diagnostic handle values:

| Curve | Start handle (y, z), mm | End handle (y, z), mm |
| --- | --- | --- |
| `bottom_heel_seat` | (16.667, 7.418) | (33.333, 6.836) |
| `bottom_waist` | (91.667, 4.799) | (133.333, 0) |
| `bottom_forepart_blend` | (178.333, 0) | (181.667, 0.238) |
| `bottom_forepart_ramp` | (206.667, 3.810) | (228.333, 6.905) |

Retain full precision for future calculation. These are not sourced ballet-flat defaults,
personal measurements, anatomical estimates, or a prescription for external shoe parts.

## Derived quantities and checks

- Report projected L separately from `bottom_arc_length`, the sum of integrals of
  √(1 + (dz/dy)²) dy along the actual four curves. Arc length is derived, never another
  simultaneous editable length target. It will exceed 250 mm for this nonflat example;
  do not substitute it for top `design.length` or vendor functional/full length.
- Check actual curve endpoints, forward span, heights, contact minimum, seat projection,
  and seat angle with dz/dy checks, not merely copied inputs. Length/height discrepancies
  must be ≤0.1 mm; this is a **software tolerance**, not a fit/manufacturing standard.
  Use a separate numerical angle tolerance of 0.001°; the straight seat's vertical
  rise over S must also match the entered inclination to ≤0.1 mm.
- Inspect analytic cubic extrema for below-ground excursions; verify strict forward motion,
  closure of each internal join, nonzero tangent, matching global-y slopes and no crossings.
  Do not drop tangent checks to disguise corners. Check each derived handle by name.
  Independently check the ramp's zero second differences (straightness), the blend's nonnegative
  second derivative and quadratic form, and the positive toe-end slope when T > 0.
  Actual zero-height contact at C is required separately from the 0.1 mm dimensional tolerance.
- Compute arc length with an error bound: absolute numerical error ≤0.01 mm
  for the total, checked by tighter integration and the exactly known straight-seat length.
  A dense polyline alone is not a certified error bound. The implementation recursively splits each cubic
  at its midpoint: endpoint-chord length is a lower bound and control-polygon length an upper bound.
  Each split halves its allotted gap budget; the four curve budgets sum to 0.01 mm.
  Report both bounds and their midpoint (uncertainty at most 0.005 mm); fail after 30 levels rather than
  claim convergence. Floating-point arithmetic still applies. A known curved integral and independent
  tighter Simpson integration provide separate test evidence, not the stopping rule.
- Change one input at a time: initial trials H 8→12 mm, T 10→15 mm, S 50→60 mm,
  a 2→3°, C 175→185 mm, and b 10→20 mm; also test zero-height flat cases and rejected conflicts.
  Test L through the shared length input separately. Audit dependent handles/curves; moving
  contact affects both waist and forepart, and changing seat settings affects the waist.
  Do not promise that unrelated whole regions remain identical without comparing geometry.
- Generate clean and named diagnostics, and before/after overlays at the same physical
  scale. Actually inspect rendered images for awkward bends, curvature jumps, or flat
  spots; passing C1 and dimensional checks is not visual approval. Correct defects before
  expanding scope, then obtain the user's approval before a 3D surface or app work.

For the legacy projected-coordinate experiment, `bottom_profile.py` implements the numeric guide; `generate_bottom.py` writes baseline/variant models,
reports and SVGs using the separate renderer. Commands and output layout are in [README](../README.md).
Version-2 JSON accepts exactly the six bottom controls and takes L only from the version-1 top input. Heights may be zero;
lengths/heights above 10000 mm are rejected as a numerical guard, not a physical limit.
Reports check actual cubic extrema, slopes, stations, handles and ground intervals, not dimension labels.
The current application provides a browser-viewer path, not a 3D surface. Numeric/API checks alone do not approve the React UI or visual quality. Bottom shape, top-to-bottom
correspondence, forepart crown, toe clearance and posture response remain separate questions.
