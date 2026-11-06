# Studio: parametric last model (top and side views)

Status: working prototype at `/studio` (the curve primitive alone is at `/curve`). It is a **fresh document, independent of the
foot-first schema** (`docs/foot-first-model.md`): nothing here reads or writes that schema, and the old viewer is unchanged. The 3D
surface is not ported yet (top, side and cross-section views exist). Every number below is synthetic and **designed**, not measured, unless stated.

Why it exists: the earlier model fixed which points were editable and derived the rest, so the instep, the ball and the heel seat
could not be shaped, and handles broke tangent continuity. The studio makes every curve a generic editable Bezier and makes the
_dependencies between curves explicit and visible_ instead of buried in a solver.

## The curve primitive (`src/lib/curves/`)

- A curve is points with `pos`, `handleIn`/`handleOut` (offsets from the point), a **mode**, an optional landmark `role`, and an
  optional `lineToNext` flag. Open or closed. Cubic Bezier segments pass _through_ their points; handles only set direction and pull.
- **Modes.** `auto` (handles derived from neighbours), `smooth` (collinear, independent lengths), `symmetric` (collinear, equal),
  `corner` (independent; the only mode that can kink). Dragging an auto handle makes that point `smooth`.
- **Auto rule (our choice, not Hobby or Catmull-Rom).** Tangent along the bisector of the two neighbouring chords, each handle a
  third of its own chord. Chosen because it never kinks and does not overshoot like uniform Catmull-Rom. Curvature is _not_ continuous
  at auto points (G1, not G2); the curvature comb shows this.
- **`lineToNext`** makes the following segment a straight line: its handles are forced onto the chord and follow the end points,
  and smooth/symmetric neighbours are re-coupled so a tilted line never leaves a kink. It is **stated, never inferred** from handle
  geometry: an earlier inference treated a flat waist (all handles horizontal) as a line and tilted the ground-contact tangent when
  the heel rose. Dragging one of its handles turns it back into a curve.
- `normalize` (`constrain.ts`) is the single place that recomputes derived handles; every edit ends in it.
- History is one generic stack (`history.ts`) over the whole document so undo cannot desynchronise linked views.

## Three kinds of values, and where measurements fit

| Kind          | Meaning                                                        | Examples                                                                     | Can a curve edit change it?                          |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Parameter** | Entered, designed number                                       | heel height H, toe spring T, seat length S, blend, hinge radius, seat offset | No. Only by editing it.                              |
| **Derived**   | Calculated, read-only, with its source shown                   | length L, ball station A, hinge angle θ, allowance δ, rear sole angle        | No.                                                  |
| **Drive**     | A point coordinate that _follows_ a parameter or derived value | heel rear height = H; seat front; contact; toe end                           | Locked on the canvas; **unlock** to override by hand |
| **Check**     | A requirement reported against the geometry                    | arc to contact = A + δ; total arc = L + δ; seat above ground                 | Never changes geometry                               |

This keeps the standing rule in `docs/concept.md`: _chosen dimensions stay in charge; a curve edit must not quietly change them._
Dragging a driven point moves only its free axis; typing into a driven field is disabled until it is unlocked. Exception: a section's crossing points with a rail or the contour can be dragged and typed while locked; the owner is edited (see Rails).

**Foot measurements are not applied yet.** The plan, so the model is ready for them: a recorded measurement is a **reference
dimension** (a _check_ with a target, the actual value read from the curves, and a signed delta), never a silent driver, and recorded
values are never edited by the shapes. Acting on a mismatch is an explicit user action (for example resize or fit), which is how the
earlier model already treated Resize. Until measurement import exists, the only "foot" input is the synthetic top outline.

## Dependencies between views

```text
Top outline ──► length L = overall y-extent
            └─► ball station A = medial_ball y − heel back
                  │
parameters H, T, S, blend, radius, offset
                  ├─► pose (θ, δ, rear angle) ─► Side · sole (posed) drives
                  └──────────────────────────────► Side · upper (stored flat): ball_top and toe_tip stations
```

Editing the top outline therefore moves driven points in the side view; the side view shows where each driven value comes from.
`reconcileDoc` (`src/lib/studio/document.ts`) restores the invariant _every locked drive is true_ after any change, so no view can
display stale driven geometry. Named landmarks that carry a drive or a station cannot be deleted (the top outline's ten landmarks,
and the side sole's five), including while the pose is invalid.

## Side view (`src/lib/studio/side.ts`, `pose.ts`)

Axes: x = station from the heel back (the top view's y), y = height above flat ground; toe at +x.

**One closed contour, edited elevated.** The side view shows the sole and the upper (heel counter, instep, toe roof) as ONE closed
Bezier loop and edits it in the elevated pose, so it can be traced over a side photo. This replaces the earlier flat/posed toggle,
which made tracing impossible. Internally they remain two curves (decision and maths in `src/lib/studio/contour.ts`):

- `bottom` (sole) is stored **posed**.
- `dorsal` (upper) is stored **flat** as (station, height) and shown through the pose map. Editing a point in the elevated view
  inverts the map for that point only (`splitContour`); untouched points are never re-solved, so nothing drifts.
- The sole affects the upper **only through the pose parameters** (heel height H, seat S, seat offset, radius, toe spring T, and the
  top view's L and A). The map uses a _reference sole_ built from the parameters, not the sole the user drew, so reshaping the sole
  never drags the upper. Inspiration/precedent: CAD last systems treat heel height and toe spring as held properties of the last
  (the "heel-height/toe-spring holding" used when grading); PolyU's heel-height foot-deformation work also finds only modest shape
  change. No source gives our upper-placement rule; it is our convention.
- The loop order is sole heel→toe, a straight "toe wall" from `toe_end` to `toe_tip`, then the upper reversed back to the heel. The
  upper's `heel_back` is merged into the sole's `heel_rear` (flat station 0/ground maps onto it); its tangent becomes that corner's
  in-handle. Points inserted on the toe wall are dropped on split (limitation).

**Pose.** Uses the production solver `solvePosture` (`src/lib/geometry/foot-first.ts`), not a copy:
`H = A·sin θ + r(1 − cos θ)`, allowance `δ = r·θ`, with `r = radiusRatio × L`. This is a user-approved **synthetic allowance
heuristic**, not a physiological law (see `docs/foot-first-model.md`). Domain `0 ≤ H < A + r`. The actual rear sole angle is
`θ + seat offset` and must be in `[0°, 90°)`. The offset is never adapted: `H = 0` with a positive offset puts the seat below ground and
is reported.

**Allowance map.** Reference station s → posed arc distance `g(s)`: identity up to the seat end S, `s + δ(3t² − 2t³)` between S and A
(`t = (s − S)/(A − S)`), `s + δ` from A onward. Same C1 smoothstep as `referenceToPosed` in the foot-first model.

**Heel counter.** The flat curve (`dorsal`) starts at `heel_back` (station 0, height 0, driven) and runs up the back of the heel
(`heel_bulge`, seeded at (−3, .17 L)) before the instep points. It is modelled on the **flat** foot, as agreed; the pose carries it.
Negative stations (heel overhang behind the sole start) are extrapolated along the sole's start tangent. Old saves without it are
upgraded by `upgradeDoc` (prepends the seed; idempotent).

**Frame rule** (our convention, not strain or anatomy): a flat point (s, h) goes to `Q = B(s) + h·[sin β, cos β]`, B the reference sole at
arc `g(s)` (extended along the end tangents beyond the sole), and β the direction "up" is carried to. The foot is one rigid body that
turns about the ball (the hinge of the allowance) with only the toes staying flat: β is the rear sole angle α up to the **seat end S**,
eases (C1 smoothstep) from α to the hinge angle θ between S and the ball A (they differ only by the seat offset), stays θ at the ball, and
eases from θ to 0 over `HINGE_ZONE` = 60 mm past the ball. Toes lift, the rest of the foot turns with the heel, the arc stretches by δ.
The seat end S is a parameter, not the old `cut_front` point: tying the blend to that point moved every other upper point when it was dragged.
**Sections turn with the foot (user request, item 2).** β is also how far a section tilts: a section is measured on the flat foot and
keeps its place on the foot when the heel rises, so its plane stands along "up". Before, β eased from α to 0 BETWEEN the seat and the ball,
so at 80 mm the waist section stood 11° from vertical and the ball section 0°, while the sole under the waist leans 30°. Now, at 80 mm
(θ 22.6°, offset 0): heel 22.6°, waist 22.6°, ball 22.6°, the toe section (46 mm past the ball) about 3°, the toe box 0°. Measured on
the default model; with the user's −5° offset the heel section is 5° less than the waist and ball. `HINGE_ZONE` is **designed**: the top of
the foot is the inside of the bend, so the offset surface folds where height × (angle change per mm) exceeds 1; at 60 mm and a 100 mm heel
that is above 80 mm over the sole, above any height near the ball (default 36 mm, user's model 56 mm). Rejected: β = the sole's own
normal (sections square to the posed sole): the sole is bowed by the allowance and leans 32° at the waist at 80 mm, more than the heel
seat, and the changing direction folds the upper above about 100 mm; β = the rigid angle all the way to the toe (the toe section would
tilt 22° on a flat sole). Limits: the section's SHAPE is still applied in a y = const slice (see the 3D limits); heights above about 80 mm at
the ball fold the map; the test suite checks the round trip up to 60 mm over the sole at a 100 mm heel. Anchors round-trip exactly (flat →
80 mm → flat); handles are carried as points, so the curve between anchors is an approximation at large heel changes. The plan view does
not reflect side-view heel overhang.

**Drives on the sole** (all unlockable):

| Point      | Axis             | Follows                                         | Kind       |
| ---------- | ---------------- | ----------------------------------------------- | ---------- |
| heel_rear  | station / height | 0 / H                                           | value      |
| seat_front | station / height | `S·cos a` / `H − S·sin a` (a = rear sole angle) | value      |
| contact    | height           | 0 (ground)                                      | value      |
| contact    | station          | **arc length** from the heel = A + δ            | arc        |
| blend_end  | station          | contact station + blend length                  | offset     |
| toe_end    | station / height | **arc length** = L + δ / T                      | arc, value |

The contact and toe budgets are **arc** lengths, as in the foot-first model, not horizontal positions; pinning them as x-coordinates
would silently break the allowance. They are solved by bisection against the curve actually drawn. `reconcileCurve` order is fixed:
values, offsets, then arc solves in curve order with offsets re-applied after each. If the pose is invalid every drive is `pending`:
the locks and landmark protection remain, nothing is applied, and the side geometry keeps its last valid shape while the checks explain
why. An arc target that cannot be reached leaves the point where it is; the checks then report the signed delta.

**Defaults (designed, not anatomical or standard).** H 8 mm and T 10 mm (the earlier model's example), S 54 mm (.2 L), blend 10 mm
(the earlier model's chosen development blend), radius 5 % of L (the earlier synthetic choice), **seat offset 0°** (the earlier example
used 2°, which makes H = 0 invalid and would break a continuous flat-to-elevated sweep). The "Flat" heel preset also zeroes the offset
for the same reason. Instep heights are fractions of L adapted from the earlier centre-section defaults. The starting sole is a straight
seat, free waist, horizontal ground contact, short blend and straight toe ramp; after seeding, every point is free to edit.

## Checks shown in the side view

Rear sole angle and allowance (informational), seat front not below ground (error), sole not below ground (warning), arc to contact and
total arc against their budgets with signed deltas. Checks never change geometry.

## Cross sections (`src/lib/studio/section.ts`)

Four sections (heel, waist, ball, toe), each a closed Bezier in (u, z): u along the cut from the medial to the lateral edge, z up
from the flat sole. Edited in the **Section** view with a station selector; the other three are drawn faint for comparison.

- **Cut plane (decision):** vertical (perpendicular to the flat foot) but NOT perpendicular to the long axis: it passes through the
  top outline's medial and lateral landmark of the same pair, so it is tilted wherever the pair differs in y (the ball line is). This
  matches a contour gauge laid across a foot, and sections are therefore not mirrored. The top view draws the cut lines (active one
  highlighted). Only these four pairs exist; free cutting lines and extra stations are not built.
- **Dependencies:** width W, tilt and station come from the top outline; the crown comes from the flat upper at the station where the cut
  meets the centre plane x = 0. Sections live in the flat reference frame like the upper, so **heel height does not change their shape**; the pose turns them with the foot (frame rule, Side view).
  This follows the "sections where section planes meet profile curves" idea (Rhino CSec, section-built last patents); landmark choice
  is ours.
- **Drives** (locked, unlockable; ids prefixed `ball/…`): `medial` u = 0, `lateral` u = W, `crown` u = u_c and z = upper height,
  `sole` z = 0, and u and z of the rail roles (bottoms, shoulders; z of medial/lateral) from the rails (see Rails). Crown drives are `pending` if the cut misses x = 0 or the upper has no height there. All other points are free.
- **Starting shape:** designed (not measured), from W and the crown height; "Reset section" restores it. The bottom is **flat** (rails are seeded flat) so the
  sole can be nailed on: the two bottom points are corners and the segments around `sole` are straight lines. The corners are tucked
  in 3 mm from the medial/lateral edge (`BOTTOM_INSET`) and the widest points sit 12 mm up (`WALL_RISE`, capped at 30 % of the crown
  height), because a last is widest at or just above its bottom and widens only slightly (user observation, not measured). Both
  numbers are free to edit; only the corner height is locked. Saves made before this change keep their old rounded sections until
  "Reset section" is pressed.
- **Girth** (perimeter as drawn, sole included) is shown as a read-only check; ball/instep/heel girth targets are not entered yet.
- **Gauge tracings:** each section has its own reference image (see below); the intended workflow is to photograph the contour-gauge
  tracing, scale it to the section, and trace over it. Two-point scale calibration has no UI yet.
- **Persistence:** `sections` is stored in the document (version 2, optional field); older saves get seeded sections on load.
- **Limits:** no 3D/loft yet, so sections are not yet connected into a surface; no mirror editing; the tilt is shown but cannot be
  entered, it follows the landmarks.

## Rails (`rails.ts`, `rail-loop.ts`) — editable, grouped under Top and Side

A **rail** follows one role (sole, lateral_bottom, lateral, lateral_shoulder, crown, medial_shoulder, medial, medial_bottom) from the
heel through the four sections to the toe. Each rail is two independent projections, **plan** (x over y) and **elevation** (z over y),
each an ordinary editable Bezier, so a curve is fine-tuned in space by editing its two views separately (user request).

- **Paired rails are connected (user request):** the medial and lateral rail of a pair meet at heel back and toe tip, so in plan a pair
  is ONE closed outline. The **Top** view has an outline picker: _widest outline_ (medial + lateral = the top outline), _sole edge_
  (medial + lateral bottom) and _upper edge_ (the shoulders). Storage stays two open curves per pair (`doc.rails.plan`); the loop is a
  derived editing view joined/split in `rail-loop.ts` (same idea as the side contour). Its two shared points are corners, follow the top
  outline's heel back / toe tip (drives, one id per pair so unlocking unlocks both), and points inserted in the loop go to the half they
  fall in. The sole edge is where the shoe sole outline is defined.
- **Elevation is in the Side view:** its curve picker edits the centre contour (sole + crown) or one of six rail elevations
  (`doc.rails.elev`; sole/crown stay the contour). A rail is stored FLAT, like the upper, and shown and edited with the heel height applied
  through the same frame rule (`upperToPosed` / `upperFromPosed`), so it matches the contour when the heel is raised. All other rails are
  dotted guides; dots mark where the sections meet the rail. No lock icons are shown for a posed rail: its ends are re-applied in the flat
  frame after an edit and cannot be deleted. The elevation of a pair is not joined into a loop (the two curves overlap in the side view).
- **Rails are the authority for sections (decision, to be judged in use):** a section point's u is where its cutting line crosses the
  rail's plan curve, its z is the elevation curve at the crossing's y. These are ordinary drives (ids `ball/lateral_bottom:0|1`, …), so
  a section point of a rail role stays locked to the rail, and dragging it writes the move back to the rail locally (see "Crossings are written back" below); the only free coordinate left is the sole point's u. This replaces the
  earlier flat-bottom drive: rails are **seeded flat** and raising the waist's medial-bottom elevation models the arch.
- **Crossings are written back (decision, user, replaces "unlock to edit"):** a section's point where it meets a rail or the side contour is
  the same 3D point as that rail's. The rail/contour stays the OWNER, but dragging the section's point now edits it, LOCALLY (user
  decision: only at that crossing). `writeBackSection` (`crossing.ts`, called by `withSection` before the drives re-apply) pulls the owner
  through the new point: an anchor within 1.5 mm of the crossing moves, otherwise a point is inserted at the crossing by de Casteljau
  subdivision (shape unchanged) and moved; only the segments beside it change (plus the handles of `auto` neighbours). Bottoms and
  shoulders write u to the PLAN rail and z to the ELEVATION rail (the cut is tilted, so a new u also moves the crossing's station and
  the elevation anchor moves with it); medial/lateral write z to their elevation rail; the crown writes z to the side contour's upper.
  The u of medial/lateral (the top outline's landmark) and of the crown (the centre plane) stay locked: their owner is edited elsewhere.
  Why: with the old rule a section point could only be moved after unlocking it, which detached it; the section line moved, the surface
  (built from the rails) did not, and they silently disagreed (11, 15 and 28 mm at heel, waist and ball in the user's model, 23
  drives unlocked). In other tools this is the "shared point" (Blender vertices, sketch coincident constraints) or the
  "owner and derived" pattern (Grasshopper, Houdini) combined, as chosen. Rejected: moving the whole rail or a least-squares refit (changes
  what the user did not touch); making the section the owner (the rails carry the chosen dimensions).
  - **Unlocking** now means "detach": nothing is written, the section point is the user's, and the surface ignores it. The Section
    inspector lists such points with their gap in mm (`sectionGaps`, a check, it never moves geometry). Locking a point again
    re-applies the rail's value (the rail wins), as before.
  - **3D:** a node shared by rails and a section is dragged through the rails; the section's copy follows via its drive (it is only dragged
    itself when detached or alone), so the move is not applied twice.
  - **Limits:** only positions are written, a section's handles are not carried to the rail's tangent; no write when the rail misses the
    cut; a rail that doubles back along y is not supported; contour anchors with a drive (heel back, ...) and rail end points are never
    moved (a point is inserted next to them); existing documents keep their unlocked points until locked again.
- **Ends:** every rail curve's first/last point follows the outline's heel back / toe tip (x and y), as drives that can be unlocked.
  - **Toe: ONE point (user request, designed).** All eight rails end at the same 3D point: the outline's toe tip, at half the flat
    upper's height there (`TOE_FRACTION` = 0.5 in `rails.ts`, a convention, calculated from the dorsal's toe wall). That is where the loft
    closes its rounded nose, so the end markers now sit on the surface instead of floating above it. Before, the toe ends sat at the
    per-role heights below, a vertical column of eight markers whose coordinates were not tied to each other. The bottom rails therefore
    rise from the ball to that point (the default model's sole is lifted 0.4 mm at y = 209 and 2.5 mm at y = 267 in the flat frame).
  - **Heel: a seam.** Each rail starts at its own height (`END_FRACTION`: bottoms 0, medial/lateral 40 %, shoulders 75 %, crown 100 % of
    the flat upper's height there), so the pairs meet on the back seam one above the other. Convention, not measurement.
  - **Never outside the outline (decision):** the derived rails (bottoms, shoulders) are free Beziers whose first millimetres, taken at a
    given y, could lie outside the lateral/medial rail (the outline): in `debug/heel-strip.json` the lateral shoulder was 1.7 mm outside
    at the heel back and the ring folded into a creased strip. `buildLoft` now clamps their x to the outline's extent at each slice. The
    stored curve is not changed (a shoulder handle that pokes out is still shown where it is), and the clamp hides, not fixes, a rail drawn
    outside the outline.
- **Seeding (designed):** a smooth curve through the four section points and the two ends as they are when the rails are created; old
  saves get rails seeded from their saved sections.
- **Dependency order:** top outline + params → side curves → rail ends → rails → sections.
- **Limits:** derived plan rails do not follow the top outline, so a big outline edit can leave a bottom rail outside it; a rail is
  treated as a single-valued function of y (no doubling back); where a cut crosses a rail more than once the crossing nearest the rail's
  own side is used.

## 3D view (`loft.ts`, `space-edit.ts`, `Viewer3D.tsx`)

The **Model → 3D** tab shows a lofted surface and lets the rails and the top outline be edited in space.

**Surface** (designed; see the doc comment in `loft.ts`): sampled on planes y = const; on each the eight rails give the eight anchor
points; between two anchors each section contributes its OWN curve between the same two points, scaled onto the slice (x by the slice's
width over the section's, z by its height over the section's), with the leftover to the slice's next anchor eased in by a smoothstep (zero
slope at both ends), and blended between neighbouring sections with a smoothstep so each section's shape is reproduced at its station.
Decision: the earlier version stored the curve relative to the chord between anchors and re-applied it to the slice's chord, which rotated
the section's tangent at an anchor by the chord difference, differently for the two stretches that meet there; near a toe that is tall
and narrow it made a 67-degree ridge along the crown and notches at the shoulders (measured on `debug/toe-chopped.json`, now 19 and under 10
degrees, the rest being the tight crown the narrow shoulder rails imply). Scaling the section as a whole keeps the tangent direction it was
drawn with at every anchor: smooth anchors stay smooth, corners (the flat bottom's) stay corners. The straight bottom stays flat. Closing: see "End caps" below (the first and last slices are no longer the ends of the surface). Sole and crown stay in the centre plane
x = 0 where the outline reaches it and otherwise on the nearest outline edge (the toe tip is off-centre). Optionally the heel height is
applied with the side view's frame rule.

**End caps** (user reports: a vertical groove down the heel back, then a pinched toe; designed, `end-cap.ts`): on slices y = const the first
and last slices are narrow lenses (a few mm wide) that take the section's shape scaled to that width, which narrows to nothing at the crown;
the end closed as a pinched seam (heel) or a funnel (toe). So the slices beyond a BOUNDARY slice are dropped and each end is built from
horizontal half-rings, one per pair of boundary-ring vertices at the same height (lateral side, medial side). A row has the plan outline's own
end arc as its shape (scaled across by the pair's distance, lengthwise by the row's depth), and reaches the side contour's end point at that
height: the rear-most point (heel) or front-most point (toe; below the tip's height the toe is a wall whose underside is rounded back to the
sole by a quarter ellipse of the wall's height). The boundary is the first slice from the end whose plan width reaches 0.8 of the widest within
30% of the length (designed), but never beyond the end-most section's station minus 2 mm, because a section inside a cap would not be reproduced;
a pointed toe never gets that wide near its tip, so the limit decides (boundary 41 mm from the tip on `debug/toe-chopped.json`, section at 46).
A blunt end (boundary within 3 slices of the end) keeps the fan to the centroid. Rejected: more or denser slices, a different closing of the
first slice, slice scaling that keeps the lens height (moves the pinch). Limits: the cap interpolates, it does not reproduce a drawn section
(there is none inside it); the rails still run through the cap region as the slices would have placed them and can differ from the cap by a few
mm; rows are horizontal in the flat frame; the cap meets the slices with a position match and an approximate (not exact) tangent match, which
shows as a faint shading line at the boundary; the corner where a drawn roof meets the toe wall stays as drawn.

**Top cut edge** (designed): the top face is exactly the plane, and the 8 mm rounding lies on the wall below it (`capTo`, `loft.ts`). The first
version used a polynomial smooth minimum, which lowers the result below both inputs near the crossing; where the roof grazes the plane (behind
a heel counter) the 2 mm dip spread over tens of mm and showed as a crater in the face.

**Heel overhang** (user report, designed): the side contour's heel counter may lean out behind the sole start (negative stations). A slice
cannot go behind the first slice, so the back of the surface was a vertical wall at the sole start while the contour showed the bulge
and the top of the counter 4 to 15 mm behind it (`debug/heel-contour.json`: contour −4 / −5 / −9 / −15 mm rear at heights 10–110 mm,
surface 0.2 everywhere). `rearOverhang` shifts every vertex backwards by the contour's overhang at that vertex's height, fading
(smoothstep) to nothing over max(30, 3 × the largest overhang) mm in front, so the back of the centre plane follows the drawn counter
(after the fix within 1 mm in every height band). The fade length keeps the shift from folding the slices. Limits: it is a shear of the
back (the whole back leans the same at every x), exact only at the centre plane and where the counter is single-valued in height; a
counter that never leaves the sole start is not touched. The plan view does not show it.

**Top cut: the flat top** (user request; `cut.ts`). A last is cut flat at the top; the face is the "cone island" of last-making
vocabulary (patent US 5,661,864 names it and says only that the last is terminated at the cone height; no source found gives a standard
height, angle or shape, so the numbers here are designed). The user's decision: a PLAIN planar cut through the shape, whatever is above
it removed; not something to model with curves (it matters little for the structure of the last). The mounting hole is not built.
- **Stored** (`doc.cut = { height, tiltDeg }`, entered numbers): the plane's height above the sole at the heel back (station 0) and its
  slope against the sole (+ rises towards the toe), both on the FLAT foot, so the cut keeps its place on the foot when the heel rises
  (same rule as the sections). Edited in the 3D view's left panel (**Flat top cut**: Height, Tilt; undoable) and shown as a read-only
  dashed line in the Side pane. Default (designed): 0.30 L high, −5° (the default roof peaks at 0.34 L, so a fresh model shows a face
  over the heel and the start of the instep). Tilt is limited to ±60°, height to at least 1 mm.
- **In the pose** the plane is carried by the rigid heel block (the frame rule is a rigid rotation up to the seat end S) and then simply
  continued as a plane: the line through the images of the plane's points at stations 0 and S. It is applied to the posed vertex heights
  with an 8 mm edge rounding below the plane (`CUT_BLEND`, `capTo` in `loft.ts`; a hard minimum left a razor edge). Pushing the flat plane through the whole pose
  map would bend it wherever the map bends, so the top would not be flat.
- **Whole last, no stop:** the plane cuts front to back. An earlier version of this change released it over 40 mm in front of a point
  (a ramp rising 60 mm), which left a ridge in front of the flat face (user report); that ramp is gone. Consequence: with a high heel
  the plane descends towards the toe at about the seat angle and can reach a low forefoot; lower its tilt, raise it, or switch it
  off. No check reports this.
- **Old saves:** read from either older form: the upper's `cut_rear`/`cut_front` points (renamed `roof_rear`/`roof_front` on load, now
  ordinary roof points) or the 2-point `cut` curve of the previous version; both are lines through two (station, height) points and become a
  height at station 0 and a slope. With the front point missing (it could be deleted, as in `debug/heel-contour.json`, where the cut
  silently did nothing) the cut is level at the rear point's height.
- **Rejected:** drawing the cut as a curve or two points in the Side pane (done in an earlier version of this change: more to model than the cut is
  worth, and the roof was forced through it); a height in the posed frame (heel changes would move the cut relative to the foot);
  stopping the cut at a front point.
- **Limits:** the face is whatever the plane leaves of the rounded top, so its outline follows from the shape and cannot be drawn; the plane
  is not tilted across the foot; the edge is the fixed blend, not a drawn radius.

**Rounded nose** (designed): if the side view ends the toe in a wall (the dorsal's toe tip above the sole, 8.1 mm in
`debug/toe-chopped.json`), the last rings would be a vertical sliver of that height and almost no width, a blade that read as a "chopped-off"
toe. The last `nose` mm (equal to the wall's height) shrink each ring's height about its mid-height with a half-ellipse, so the toe ends in a
rounded nose of radius half the wall. This departs from the drawn side silhouette in those last millimetres (it rounds the wall's two
corners) and lifts the sole there; a toe tip drawn on the sole is unaffected, and the heel end is not rounded. The rail end markers
end at half the wall's height now (see Rails, Ends), which is where the nose closes, so they sit on the tip.

### Workspace: 3D, Top and Side at once (user request)

The **Workspace** tab (the default) lays the 3D view out beside the Top and Side panes, like Blender's multi-view layouts: 3D on the
left (three rows), Top, Side and Section stacked on the right. Each 2D pane is the same editor as its full tab (same curve, drives, locks, guides,
reference image), has its own curve picker (outline, side curve), its own point selection, and a button to open it full size. The Section pane is exactly the Section tab's editor for the one section picked (its picker is in the pane bar). The pane
last clicked is the ACTIVE one (amber frame) and owns the left browser, the right inspector, the keyboard shortcuts and the image panel;
the 3D pane shows the 3D options and notes. The single tabs stay as they were. `Studio.tsx` computes one model per edit space
(`useSpace`) instead of one for the current tab, so the 2D panes never share a curve or a selection.

**Lines and focus** (`focus.ts`, tested in `focus.test.ts`):

- A _line_ is a rail, the top outline or a section. Click a rail or section line in 3D (screen-space pick, 7 px) to select the whole
  line: it is lit amber and the panes show it. The top outline is lit as its two rails, lateral and medial.
- Select a point and the panes show a line through it. A point lies on several lines (its rail, the outline if it is the widest rail, its
  section, at the toe tip all eight rails); the first (a rail) is shown by default and the inspector lists the others to choose from.
- Showing a line points each pane at it: the widest rails (lateral, medial) use the top outline as plan; the four derived rails show their
  pair's closed loop (sole edge, upper edge) in Top, with the selected point's index mapped into the loop (`loopIndex`); sole and crown
  show the centre contour in Side; the elevation rails show their elevation curve in Side. The selected point is selected in each pane.
- Selecting a point in the Top pane (top outline) or Side pane (an elevation rail) selects it in 3D. Selecting a point in the Section pane selects it in 3D as well. Limit: not for the loop outlines or the
  centre contour (the curves differ from the 3D members).
- Selecting a section line, or a point that lies on a section, shows that section in the Section pane with the point selected (one
  Section pane only, by request: it follows the selection). Limits: a selected
  whole line is shown and highlighted, it cannot be moved as one; the pane sizes are fixed (no splitter).

**Picking** (decision): markers are picked in screen space, not by ray: the nearest marker centre within 16 px (anchors; 12 px for handle
knobs, anchors win a near tie) is picked, so the click target has the same size at every zoom and depth. Before, the target was the
sprite's quad against a ray and the visible glyph was about 10 px. The marker sprite is now 40 px (was 29), the glyph about 14 px.

**Handles while dragging** (fixed): handles are drawn only for the selected anchor (their `owner`). Picking a handle used to select the
handle itself, so the anchor's handles disappeared the moment a drag began; picking a handle now keeps its anchor selected
(`pick3d` in `Studio.tsx`). Not run in a real mouse drag (the debug click is synthetic); checked by reading the code path and the
selection state after a synthetic anchor click.

**Line style** (decision, designed, widths not measured): rails, sections and handle lines copy the 2D canvas (`curve.module.css`: a
2.25 px stroke over a 6 px halo in the canvas colour). They are screen-width lines (`Line2`, since a WebGL line is always 1 px): 2.5 px
(3.5 px when selected) over a halo 3.5 px wider, handle lines 1.5 px. Each line is also drawn a second time at 50 % opacity ignoring
depth. The reason is that a rail is not always on the mesh: inside an end cap the surface is interpolated, so a rail can run a few mm
under it (see End caps, limits); the toe box showed almost no rail lines before this. The faint copy also shows lines on the far side
of the model through it, like the markers. The surface's polygon offset was raised (1 → 2) so lines that skim it win the depth test.
Not done: putting the rail lines ON the cap surface (they would then no longer be the rail curves the handles edit).

The standard views switch to orthographic and stay there until toggled (no auto-perspective).

Limits: the section's shape is applied in the y-slice, not in the tilted section plane (anchors are exact, the drawn section curve is
approximated between them, and its tangents are kept as directions up to the anisotropic x/z scale); the mesh is a surface, not a trimmed solid; no surface-quality checks, no export, no measurements from the surface.

Reproducing a flaw from the user's own model (live model and camera, screenshots, headless numbers): `docs/debugging.md`.

The view tabs are grouped **Workspace**, **Outlines** (Top, Side), **Sections** and **Model** (3D).

## Reference images (`reference-image.ts`, `image-file.ts`, `ImagePanel.tsx`)

A photo or drawing can be placed behind either view (top, side) to trace over. **It is a workspace aid, not model
data:** it is never read by geometry or checks, is excluded from the document JSON and the undo history, and moving it cannot change
the last. One image per view (top, side) and per section.

- **Placement** is in world mm: centre, width (height from the fixed aspect), rotation (counter-clockwise), mirror, opacity.
  New images are fitted around the current curve at 50 % opacity (designed default).
- **Tool** `I` (needs an image): drag the body to move, corners scale about the opposite corner keeping aspect, the top knob rotates
  (Shift snaps 15°), Alt + wheel scales about the cursor. Esc cancels a drag. Lock stops accidental edits; numeric fields also exist.
- **Privacy / storage:** read with canvas in the browser, downscaled to 1600 px (assumed trade-off), re-encoded as JPEG 0.85 on white
  (transparency is lost), stored in `localStorage` keys `last-studio.image.v1.<target>`. Nothing is uploaded. If the quota is
  exceeded the image still shows for the session and a message says it will not persist. Only PNG/JPEG/WebP/GIF are accepted (no SVG).
- **Slots:** one per view for top and side, and one per section (`section-heel`, …).
- **Limits:** `calibrateImage` (two points of known distance → scale) exists and is tested but has no UI yet; scale is matched by
  hand. The image is not re-fitted when the curve changes.

## Persistence

The document autosaves to browser `localStorage` (`last-studio.document.v2`, schema version 2, validated with zod on load). `cut` (the top cut, `{height, tiltDeg}`) is an optional field; a save without it, or with the earlier 2-point curve form, is converted as described under the 3D view, and the upper's `cut_rear`/`cut_front` points are renamed `roof_rear`/`roof_front` on load. A version-1
save (the bare top-outline curve) is migrated by keeping the outline and rebuilding the side view. Corrupt or missing storage falls back
to the default document. The page is client-only (`ssr: false`) so storage is read during initialisation, not in an effect.

## Known limits

- While the pose is invalid there is no upper to place, so only the sole is shown and edited.
- The view is not re-fitted when heel height changes (use Fit); a very high heel can leave the heel back off screen.
- Arc budgets assume the arc grows with the point's station; a degenerate sole may be unsolvable and is then reported, not forced.
- The heel seat is a straight chord of length S; if the seat is bent by hand its arc differs from S.
- `blend_end` height is free (not derived from the ramp slope); the earlier model derived it.
- No measurement import, and no mirror editing.

## Verification actually run

Toe of `debug/toe-chopped.json` (the user's model: heel 100, an 8.1 mm toe wall): measured before the change, the toe ring at y = 265
had a 67-degree turn at the crown and 16 to 19 degrees (reversed) at the shoulders, and the last ring was 2.6 mm wide and 9.6 mm tall; after,
19 and 5 to 7 degrees, and the last ring has zero height. Two regression tests assert this (`loft.test.ts`). In the Orca browser tab the toe
was screenshotted from the same angles before and after: the crease along the toe box is a soft highlight and the vertical face at the tip is
a rounded nose. `pnpm check` clean, `pnpm exec vitest run` 463 tests (two probes skipped). Not run: the other saved models, other browsers.

`pnpm check` (lint and types) and `pnpm exec vitest run tests-ts/curves` (107 tests, incl. heel counter, reference-image geometry, the contour map/split, sections, rails, the loft and 3D editing): mode constraints, straight lines, history, JSON,
pose parity with `solvePosture`, allowance-map properties, budgets at H = 0, 8, 40, 80, flat → 80 → flat returning exactly, propagation
from the top view, unlocking, invalid heights, and pending drives. In Chromium: top-view landmark drag, heel presets (flat, 8, 80),
invalid height (500) with held geometry and visible check, drive chips and locked fields, the earlier flat/posed edit spaces (since replaced by the single contour), and a reload restoring the
saved document. Not run: any test of the old viewer, cross-browser checks, or touch input.

Reference images, in Chromium: injected a generated PNG through the file input; it rendered behind the grid, the `I` tool showed
handles, body drag and corner drag changed the image only (curve unchanged), and the image restored after reload. Not run: rotate
knob and Alt+wheel by hand, side-view images, heel-counter checks in the browser, quota-exceeded path.

Side contour, in Chromium: one closed loop at 8 mm; heel preset 50 leaned the heel counter forward with the sole; dragging
`instep_waist` at 50 mm then returning to Flat kept the edit; point labels in the side view. Not run: dragging every upper point, the
toe wall insert case, the invalid-pose fallback in the browser, old saves with a posed/flat split (the storage format is unchanged).
Reference images are now one per view (top, side); images saved under the old per-curve keys are ignored.

Sections, in Chromium: the Section tab showed the ball section with the tilted cut (−18° with this save's landmarks), locked medial
edge and crown, faint neighbours, and the top view's cut lines; dragging the locked medial point moved only its free axis. Not run:
other stations in the browser, a gauge-image workflow, the pending-crown case.

Known limit: the control-point markers of sections whose crown lies above the cut are not clamped to the cut, so such a marker can float above the flat top.

Heel and toe ends (`debug/heel-strip.json`, the user's model looking at the heel from below and behind): the lateral shoulder rail's ring
vertex at the first slice was 5.3 mm across against the outline's 3.6, which made the narrow strip and creases down the heel back; with the
clamp the shoulder is at 3.6 and the strip is gone (screenshot before and after in the Orca tab, same camera). Regression test in
`loft.test.ts` (fails without the clamp, checked by removing it), plus a test that every rail's stored end is one point at the toe.
The flat-bottom test now only covers slices behind the ball, because the bottoms rise to the toe tip point. The workspace was driven in
the Orca tab: a click on the lateral shoulder rail line opened "Upper edge (shoulders)" in Top and "Lateral shoulder rail" in Side.
Not run: dragging in the workspace panes, selecting a marker in 3D by a real mouse (the debug click is synthetic and skips pointer
capture), 2D-to-3D selection, other browsers.

Panels and hover (user reports): the left (browser) and right (properties) panels collapse with the two buttons at the right of the view
bar (remembered in `last-studio.panels.v1`); the 3D view and the panes use the room. The 2D panes blinked on hover and could not be used
because `Pane` was a component defined inside `Studio`: a new component type each render remounted the canvas on every cursor update.
It is now module-level; checked in the Orca tab by moving a synthetic pointer over a pane and finding the same svg node afterwards.

Section tilt, top cut and heel overhang: `pnpm check` clean, `pnpm exec vitest run` 487 passed / 5 skipped. Tests: `contour.test.ts` "sections turn with
the foot" (tilt of the heel, waist, ball and toe sections at 40 / 80 / 100 mm heels, smoothness, no fold up to 60 mm over the sole, flat
foot unchanged), `side.test.ts` (the instep over the ball is raised along the turned foot's up, replacing the old "vertical depth" test, which
encoded the previous rule), `loft.test.ts` (heel overhang follows `debug/heel-contour.json`; nothing above the posed plane at 8 / 40 / 80 mm
and a face on it; no step in the top height along the last; the cut lifts with the foot), `cut.test.ts` (plane maths flat and posed, clamping,
migration from both older save forms). In the Orca tab, on the user's model (heel 100 mm): the side view shows the top as one straight
plane with no step in front of it; the Side pane shows the dashed cut line. Probes: `tests-ts/debug/tilt.test.ts`, `heelmatch.test.ts`.
The heel groove and the pinched toe (below) are fixed: `tests-ts/curves/loft.test.ts` checks the heel back is one convex arc at every height
(it fails without the cap), that both ends are caps, that the mesh has no open or flipped edge, and that the toe has no crease above the sole.
Probe: `tests-ts/debug/creases.test.ts` lists the sharpest creases by region.
Not run: dragging the cut fields' values with a real mouse beyond typing, the cut at extreme heel/offset combinations in the
browser, the new tilt on a hand-traced photo, other browsers.
