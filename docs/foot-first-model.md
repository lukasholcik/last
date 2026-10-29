# Foot-first reference model and posture allowance

This is the schema-4 production contract for the local TypeScript viewer. It describes inferred reference silhouettes,
a four-cubic lower boundary, and a [closed designed centre section](centre-section.md), not a measured foot trace, bottom perimeter/featherline, upper surface, printable solid,
or fit prediction. The allowance and 3D correspondence are user-approved prototype conventions, not vendor algorithms or physiology.

## Inputs, ownership, and units

The canonical document has `schema_version: 4`, `kind: "foot_first_last"`, and `units: "mm"`.
Defaults come from `examples/foot-first-baseline.json`. The following complete compact example uses its synthetic dimensions
and rules; description strings are descriptive metadata, not measurements:

```json
{
  "schema_version": 4,
  "kind": "foot_first_last",
  "units": "mm",
  "description": "Synthetic foot-first development example",
  "reference": {
    "provenance": "synthetic",
    "description": "Engineering values, not personal measurements or population averages",
    "width_definition": "Transverse forefoot width basis at the medial-ball reference station; not a measured tracing",
    "foot_length": 250,
    "foot_width": 100
  },
  "foot": { "length": 250, "width": 100 },
  "template": {
    "medial_heel": { "station_ratio": 0.12, "side_extent_ratio": 0.28 },
    "lateral_heel": { "station_ratio": 0.12, "side_extent_ratio": 0.29 },
    "medial_waist": { "station_ratio": 0.40, "side_extent_ratio": 0.29 },
    "lateral_waist": { "station_ratio": 0.40, "side_extent_ratio": 0.32 },
    "medial_ball": { "station_ratio": 0.70, "side_extent_ratio": 0.46 },
    "lateral_ball": { "station_ratio": 0.66, "side_extent_ratio": 0.48 },
    "medial_toe": { "station_ratio": 0.88, "side_extent_ratio": 0.33 },
    "lateral_toe": { "station_ratio": 0.88, "side_extent_ratio": 0.31 }
  },
  "design": {
    "toe_extension_ratio": 0.10,
    "seat_arc_ratio": 0.20,
    "blend_arc_ratio": 0.04,
    "bend_radius_ratio": 0.05,
    "arch_start_reach_ratio": 0.3333333333333333,
    "arch_contact_reach_ratio": 0.3333333333333333
  },
  "pose": { "heel_height": 8, "toe_spring": 10, "seat_inclination_deg": 2 },
  "centre_section": {
    "top_rear_station_ratio": 0.04,
    "top_front_station_ratio": 0.28,
    "toe_roof_station_ratio": 0.92,
    "top_front_height_ratio": 0.30,
    "waist_height_ratio": 0.22,
    "ball_height_ratio": 0.12,
    "toe_roof_height_ratio": 0.06,
    "heel_leave_outward_deg": 10,
    "heel_bulge_ratio": 0.02,
    "instep_front_handle_ratio": 0.06,
    "instep_waist_handle_ratio": 0.04,
    "instep_front_down_offset_deg": 50,
    "instep_waist_down_offset_deg": 35
  }
}
```

| Owner | Meaning and permitted changes |
| --- | --- |
| `reference` | Original F0/W0, `provenance` (`synthetic` or `measured`), description, and named width definition. Working edits, resize, and pose never overwrite these values. |
| `foot` | Independent working dimensions F=`length`, W=`width`, in mm. These are targets, not automatic replacements for observations. |
| `template` | Eight named side/region rules. `station_ratio` is a fraction of **foot F**; `side_extent_ratio` is a fraction of **width basis W**. |
| `design` | Extension ratio uses W. Seat, blend, and effective-radius ratios use F. Stored fractions are dimensionless; display percentages must name their denominator. |
| Arch reaches | `arch_start_reach_ratio` and `arch_contact_reach_ratio` use the actual projected waist span, not F or arc length; both are positive and less than1, with sum≤1. The solver preserves actual regional arcs. |
| `pose` | Heel rise H and toe spring T in mm; seat angle is an offset added to calculated theta for actual rear-sole pose. No independent bend/contact input. |
| `centre_section` | Seven required ratios, **all based on F**, including local design depths. The rear rotates with the sole and blends back to vertical at the ball; these are not source-foot heights or girths. |

W is the named transverse forefoot scaling basis at the medial-ball reference station, not an assertion that the inferred
outline's full width at that station equals W. Actual full sections are measured and reported separately. Medial and lateral
ball stations can differ; adding their side extents is not a measured width across one section. Even with `provenance: "measured"`,
the template-generated silhouette is inferred from rules, not a measured tracing.

Direct editing of F changes F only. **Resize model** accepts a new working length and atomically scales F and W by newF/oldF.
It is an explicit draft action, not a persistent sizing mode, a second authored target, or an automatic source-data update.
Changing ratios or pose likewise leaves `reference` untouched. Resize marks results unapplied until explicit Rebuild succeeds;
Reset example restores example drafts. Dirty/error views may retain LAST VALID results but must not claim they describe new drafts.
Resize also scales the F-based section positions/depths with unchanged ratios; W-only edits do not change those depths.
The synthetic F=250 roof depths are 75/55/30/15 mm, engineering choices rather than observations, population norms, or calibration defaults.

## Resolve the two reference silhouettes

For each template landmark, reference station s=`station_ratio × F` and lateral extent=`side_extent_ratio × W`.
Medial x is negative, lateral x positive. In the 2D reference view, y means intrinsic station s, not posed bottom projection.
The reference foot ends at F. Extension E=`toe_extension_ratio × W`; the unbent reference last ends at L0=F+E.
Both use the existing smooth top-outline constructor and the same internal landmarks. Extension changes the last's terminal
taper; it is not a spike appended after a closed foot tip and does not move foot anchors or change the reference foot model.
Both reference models, including landmarks, handles, cubics, and their reports, are exactly invariant under pose edits.

There is no independent last-length, contact, allowance, resolved station-mm, or bend-angle input. The parser requires exact
schema keys and finite numbers; schema 2, schema-1 `contour_last`, and projected `{top,bottom}` inputs reject without migration or fallback.
The complete `centre_section` object and both arch fractions are required: missing, partial, extra fields and string-number coercion reject. Schema3/2/1 reject explicitly, without migration. See the [eight shape controls](centre-section.md#eight-shape-controls-schema-4); source observations remain unchanged.

## Hinge equation and allowance budget

A is the resolved reference **medial_ball** station. It is not the lateral average, a global width maximum, an extended-last
fraction, a posed projection, or an independent contact control. The .70 default belongs to the existing medial-ball template
rule; there is no additional “70% bend position” knob.

Let r=`bend_radius_ratio × F`. Solve for theta in radians on `0≤theta<π/2`:

```text
H = A sin(theta) + r (1 − cos(theta))
delta = r theta
```

The equation is strictly increasing on this domain. Require `0≤H<A+r`. Use an exact H=0 case (theta=delta=0), and
the stable expression `2r sin(theta/2)^2` for the cosine contribution near zero. Radius zero is allowed and gives delta=0.
H is heel rise above forefoot support at ground z=0, not an anatomical joint angle or a toe-spring angle. T remains separate.
The prototype now reuses theta for physical rear-block pose: actual rear sole angle is theta plus the authored seat-angle offset. It must remain below90°. This is an explicit construction convention, not an anatomical angle or a claim about the curved waist tangent everywhere.
The offset is signed; zero adds no extra angle. The actual result must remain in [0°,90°).

Set S=`seat_arc_ratio × F`, J=`blend_arc_ratio × F`. The approved **allowance-only** budget is:

| Quantity | Arc length or station |
| --- | --- |
| Seat | S |
| Waist | A−S+delta |
| Blend | J |
| Ramp | L0−A−J |
| Posed contact | A+delta |
| Posed total | L0+delta |

All added length belongs to the waist. Seat, blend, and ramp do not receive delta, and delta is not counted twice.
The radius defines allowance only: it is **not** a rendered-curvature constraint, and there is no literal circle added to the guide.
The four existing cubic rules remain: straight seat, waist ending horizontal at contact, upward rounded blend, straight inclined ramp.
See [the bottom construction](bottom-profile.md) for actual curve rules and legacy distinctions.

Hinge validity is necessary but not sufficient. The actual bottom solver must independently satisfy regional arcs, nonnegative
ground/handles, actual rear angle, contact, forward spans, joins, and forepart feasibility. H=0 with a 2° offset remains invalid; flat H0/offset0 is supported. Rear sole, heel back and top cut tilt together. Do not clamp angles or borrow regional length.

Require S<A and A+J<F, with foot station ordering against F rather than L0. Existing resolved-mm gap guards (0.01 mm,
including narrow roundoff handling) remain; **do not impose a 0.01 minimum on dimensionless ratios**.
For example, seat ratio .00004 at F=250 resolves to .01 mm and is not rejected merely for being a small ratio;
all other feasibility checks still apply. Toe extension must be finite and nonnegative, with zero allowed.
Radius must also be finite and nonnegative; negative/nonfinite values reject. Positive resolved regional spans remain required.

## Reference-to-posed display correspondence

For reference station s, set t=(s−S)/(A−S):

```text
g(s) = s                              s ≤ S
g(s) = s + delta (3t² − 2t³)           S < s < A
g(s) = s + delta                      s ≥ A
```

This is a strictly increasing C1 map, with derivative 1 at both joins. It maps 0→0, A→A+delta, and L0→L0+delta.
The 3D copy of the full reference last outline uses it:

```text
(x,s) → (x, bottom_y(g(s)), bottom_z(g(s)))
```

Evaluate actual unbent last cubic samples, then locate g(s) by actual arc distance along the resulting bottom curves.
Preserve x exactly. Do not warp only control points and call the result cubic, use uniform horizontal scaling, or interpret
the distribution as an anatomical skin-strain field. The side guide is displayed at x=0. The 2D views share scale and forward
direction, not necessarily extents or toe endpoints. The 3D lines are inspection-only: no foot height, physical upper surface,
bottom perimeter/featherline, printable last, or fit claim follows.

### New centre-section reuse

Schema 3 explicitly adopts the previously open bottom guide as the **designed lower centre-section boundary**, still not a
measured bottom surface or anatomical centreline. The new roof reuses g as a separate approved construction convention:
`Q(s)=P(g(s))+[0,h(s)]`, where P evaluates the actual posed bottom at arc distance g(s). Three positive shape-preserving C1
height cubics in reference (s,h) define vertical depth h at top front a, existing medial waist M, existing medial ball A, and toe roof b.
The composed roof is generally not a posed Bézier cubic; height controls are reference (s,h), not posed (y,z) handles.
Heel edits rebuild the actual upper geometry while authored depths, source reference data, and unbent models remain unchanged.
This is not a normal offset, virtual-theta rotation, anatomical dorsal-strain field, or conserved upper path.
Toe extension affects the toe-cap closure at the existing last tip without moving F-based roof knots or changing the bottom budget.
The [section specification](centre-section.md) defines cap/cut recipes, ordering/clearance guards, continuity and intentional corners,
actual-descriptor certificates, and why a closed x=0 section is neither a side envelope nor a surface, cutting feature, or printable solid.

## Result and checks

The existing `buildLast(unknown)` public entry parses `FootFirstInput` using `parseFootFirstInput` and returns a `LastState`:

- `inputs`: authored schema-3 values, not mutated by resolution.
- `models`: `foot` (parametric reference foot), `top` (unbent reference last), `bottom` (posed lower boundary), `section` (closed x=0 centre section).
- `reports`: `foot`, `top`, `bottom`, `contour`, `section`. All five must pass before accepting state. If base geometry reports fail,
  section is not evaluated and its report must not claim success.
- `resolved`: `foot_length`, `foot_width`, `toe_extension`, `reference_last_length`, `bend_station`, `effective_radius`,
  `bend_angle_rad`, `posture_allowance`, `posed_last_length`, `seat_arc_length`, `waist_arc_length`, `blend_arc_length`,
  `ramp_arc_length`, `contact_s` (posed contact).
- `derived.projected_length`: posed bottom horizontal span, a secondary diagnostic rather than a design authority.
- `derived.station_map`: each named station has `{reference_s,posed_s,y,z}`.
- `derived.bottom_stations`: posed arc stations `{seat_s,contact_s,blend_end_s}`.
- `display.top`: bent reference-last samples; `display.bottom`: bottom samples; `display.section`: complete centre-section samples.
  These are inspection lines, not surfaces or a client-side geometry solver. Public section recipes are authoritative, not display samples.

Adding section rules does not change existing foot/top/bottom models, their four reports, resolved/derived values, or top/bottom display
values for unchanged existing inputs. `models.section`, `reports.section`, and `display.section` are the new result additions.

Shape dimensions/sections are checked on actual curves, not echoed inputs. The contour report checks actual total/regional arcs
and station round trips to 0.01 mm using tighter cubic chord/control-polygon bounds; it does not merely check allowance labels.
Section checks measure actual depths against the final lower boundary and certify closure, positivity/separation, caps, bounds, and required
tangents on actual descriptors. Dense numerical probes provide independent test evidence, not a substitute for those certificates.
Schema/type errors remain 400; failed geometry reports remain 422; unexpected failures return sanitized 500 responses.
The tRPC defaults/rebuild workflow and pnpm-only commands are in [README](../README.md); there is no Python runtime bridge.

### Examples and validation cases

The synthetic defaults resolve to F=250, W=100, E=10, L0=260, A=175, r=12.5, S=50, J=10 mm.
At H=8 mm, theta and delta are small positive calculated values; total is **260+delta**, not the old 250 mm contour.
The waist is 125+delta and the ramp 75 mm. T=10 mm and seat angle 2° are separate feasibility controls.

Validation must distinguish these cases; final integrated suite counts/results are not asserted here:

- Flat H=0 with seat angle 0 gives exact zero allowance; H=0 with seat angle 2° rejects actual-seat feasibility.
- Radius zero gives zero allowance at otherwise valid pose. Negative/nonfinite radius or extension rejects; zero extension is valid.
- Direct F edits leave W unchanged. Resize scales F/W together and preserves original reference data and normalized rules.
- Every pose edit leaves both reference silhouettes and reports unchanged. Extension edits leave the reference foot/anchors unchanged.
- Medial-ball edits change A and derived contact; lateral-ball-only edits do not redefine A. No average or global maximum substitutes for it.
- H at or beyond A+r rejects; a hinge-valid but bottom-infeasible pose still rejects. Resolved tiny spans use existing mm guards.
- Actual regional arcs, sampled correspondence, closure, x preservation, monotonicity, C1 joins, and no double-counting need independent checks.
- Dirty, failed, or stale requests must not turn LAST VALID geometry into a false current success.
- Section controls require ordered resolved gaps and positive depths; actual upper geometry must respond to heel edits without changing
  source data or the existing base results. Centre-section report failure blocks acceptance even when the four base reports pass.

## Evidence and historical boundaries

The [heel-elevation report](../reports/Heel%20elevation%20and%20plantar%20length.md) found no verified general predictor for the
external heel-to-toe plantar skin path. Its research did not approve a schema or model; the user subsequently approved this
heuristic. The 5% radius is a synthetic adjustable default, **not** a scientific ratio. Neither bone-radius nor fat-pad numbers
are adopted as defaults. [Smith et al.](https://doi.org/10.1016/j.jmbbm.2019.04.012) describe skin deformation in different
conditions; [Kouchi & Tsutsumi](https://doi.org/10.1537/ase.108.331) describe posture-dependent dimensions, not this allowance law.
Do not equate skin strain, internal fascia strain, projected lengths, and external tape-following paths.

The [3DShoemaker measurement guide](https://3dshoemaker.com/measurements-in-shoe-last-maker/) measures length along the bottom
profile; it supplies neither our unbent outline placement nor a heel-invariance, allowance, or display-mapping algorithm.
See [software research](software-research.md) for the established source/convention/assumption distinctions.

Older `examples/baseline.json` uses projected length; `examples/contour-baseline.json` uses the prior schema-1 contour target.
All older examples, Python, legacy `web/`, and frozen fixture JSON retain their meanings unchanged. They are not a second
production input path. Primitive top/bottom and legacy contour-helper parity can remain useful; full historical API snapshots
cannot establish parity for schema 3, the allowance, the display map, or the new section. Earlier schema 2 separated foot-first input
from pose but had no required centre section; it is now an explicitly rejected historical input, not silently upgraded.
No legacy example migration or fixture regeneration is intended.
