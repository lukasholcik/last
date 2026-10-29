# Heel-aware designed centre section

The approved model adds a closed section in the **x=0 centre plane**, not the side envelope of a full last.
The existing posed bottom is now explicitly adopted as its **designed lower boundary**. Previously it was only an open guide;
this new construction assumption does not turn it into a measured bottom surface, anatomical centreline, or featherline.
The section has a designed upper roof, toe cap, two heel-back cubics, and a top cut that tilts with the rear sole. It is neither source-foot dorsum nor a full surface,
printable solid, cutting operation, or proof that a future last divides into symmetric halves. A possible future centre-plane cut
through a surface is not implemented or established by this closed drawing.

## Required schema-4 controls and ownership

Canonical input is `schema_version: 4`, `kind: "foot_first_last"`, `units: "mm"`. The required root `centre_section` retains
these seven F-based anchor/depth fields and requires the six heel/instep controls below; `design` also requires both arch reaches:

| Field | Synthetic default | Resolved at F=250 mm |
| --- | ---: | ---: |
| `top_rear_station_ratio` | .04 | c=10 mm |
| `top_front_station_ratio` | .28 | a=70 mm |
| `toe_roof_station_ratio` | .92 | b=230 mm |
| `top_front_height_ratio` | .30 | 75 mm local design depth |
| `waist_height_ratio` | .22 | 55 mm local design depth |
| `ball_height_ratio` | .12 | 30 mm local design depth |
| `toe_roof_height_ratio` | .06 | 15 mm local design depth |

The depth values are **synthetic engineering choices**, not measured foot heights, population norms, vendor proportions, or
calibration defaults. Depth is now a local design control: the rear depth rotates with the rear sole and blends back to vertical at the ball.
it is not height above ground, a standard foot-height measurement, instep/ball girth, or an observation added to source data.
The default top cut is 75 mm along the rear frame's upward normal, not 75 mm above ground. Reported point `height` is the actual vertical offset from B(reference_s), not the authored local depth.

`examples/foot-first-baseline.json` retains its existing reference/foot/template/design/pose values; only its input version
and the new required object change. The complete current JSON example is in [README](../README.md).
Schema 3/2/1 and projected legacy inputs reject explicitly. Missing, partial, or extra section fields and string numbers reject;
there are no hidden fills, coercion, automatic migration, or observation mutation. Older tracked examples, Python, legacy web,
and frozen fixtures remain historical references unchanged.

Original F0/W0, provenance, and width definition remain separate from working F/W and all synthetic design rules.
Section controls show both **%F** and resolved mm. Resize model scales working F/W explicitly while leaving ratios and source
data unchanged; F-based section stations/depths therefore scale with F. W-only edits do not change section depths.
Toe extension can move the existing last-tip cap endpoint, but does not move the F-based roof knots or foot anchors.

Let M be the existing medial-waist reference station and A the existing medial-ball reference station. J is the existing blend arc,
and L0=F+E the unbent reference last length. Require ordered, roundoff-aware 0.01 mm resolved gaps:

```text
0 < c < a < M < A < b < F <= L0
A + J < b
```

F=L0 is allowed when extension is zero; it is not a required positive gap. Each authored depth resolves to at least 0.01 mm.
Existing finite/maximum resolved-unit bounds apply; do not impose a 0.01 minimum on dimensionless ratios.
The cut also has a separate actual-pose clearance requirement below. Invalid controls are rejected descriptively, not adjusted silently.

## Authoritative height and posed-roof geometry

### Eight shape controls (schema 4)

| Field | Default | Units/meaning |
| --- | ---: | --- |
| `centre_section.heel_leave_outward_deg` |10| Degrees from upward rear normal toward outward −t; departure from sole is90+value |
| `centre_section.heel_bulge_ratio` |.02| Middle-guide outward distance/F; zero allowed |
| `centre_section.instep_front_handle_ratio` |.06| Native front handle length/F |
| `centre_section.instep_waist_handle_ratio` |.04| Shared native waist handle length/F |
| `centre_section.instep_front_down_offset_deg` |50| Signed downward tangent offset relative to rear sole |
| `centre_section.instep_waist_down_offset_deg` |35| Signed downward tangent offset relative to rear sole |
| `design.arch_start_reach_ratio` |1/3| Start-handle forward reach/projected waist span |
| `design.arch_contact_reach_ratio` |1/3| Contact-handle backward reach/projected waist span |

Heel outward angle is in[0°,90°); instep angles must yield forward actual tangents. Resolved instep lengths retain .01mm guards, without a .01 floor on ratios. Arch fractions are each strictly between0 and1 and sum to at most1. They reshape the actual lower cubic, with its actual arc solved to unchanged waist/contact/total budgets; fractions are not arc fractions. Nonlinear arch y is inverted on the actual cubic, not treated as a Bézier parameter.

The first two instep pieces are native posed cubics through the existing cut-front C, waist W and ball B anchors. With D(d)=cos(d)t−sin(d)n, their controls are `[C,C+Lf*Dfront,W−Lw*Dwaist,W]` and `[W,W+Lw*Dwaist,B−Lb*DB,B]`, where Lb=distance(B,W)/3 and DB is the forefoot unit tangent at B. Shared waist handles give equal native cubic derivatives; the ball join is G1. Existing boundary names use kind `cubic`, not `roof` or cap. The ball-to-toe roof remains composed and unchanged by these four instep controls. Reference height cubics remain the anchor recipe—not posed instep handles.

The height profile consists of three shape-preserving C1 cubics in **reference (s,h)** with knots:

```text
(a, top_front_height_ratio * F)
(M, waist_height_ratio * F)
(A, ball_height_ratio * F)
(b, toe_roof_height_ratio * F)
```

For each interval, let l be its station length and d its height secant. Endpoint slopes equal the adjacent secants.
At an interior knot, a zero secant or opposing secant signs gives slope zero. Otherwise use the weighted harmonic slope:

```text
w1 = 2*l_next + l_previous
w2 = l_next + 2*l_previous
m  = (w1+w2) / (w1/d_previous + w2/d_next)
```

Hermite-to-Bézier handles use m*l/3; s controls are linear, at one third and two thirds of each interval.
The profile must remain positive and not overshoot the endpoint-height range of an interval. Heights are **not** required
to decrease monotonically across all four knots. The three height cubics are the authoritative depth rules, not posed roof cubics.

For C/W/B anchor placement, let P(u) evaluate the actual posed bottom at arc distance u and reuse reference-to-posed g(s). This blend is the anchor recipe; the first two rendered intervals use the native instep cubics above:

```text
B(s) = P(g(s))
alpha = theta + authored seat-angle offset
t = (cos(alpha), -sin(alpha)); n = (sin(alpha), cos(alpha))
w = 1 - smoothstep((s-a)/(A-a)) on a..A, otherwise 0
beta = alpha*w
C(s) = B0 + s*t - B(s)
Q_anchor(s) = B(s) + w*C(s) + h(s)*(sin(beta), cos(beta))
```

The [foot-first model](foot-first-model.md#reference-to-posed-display-correspondence) defines g as a C1 smoothstep allowance map
from seat S to medial ball A. Its reuse for the section is a **new explicit prototype construction convention**, not dorsal strain.
This explicitly approved prototype rotates the rear block and blends it back to the ball; it is not an anatomical deformation, conserved upper path or extra dorsal allowance.
The ball-to-toe interval remains composed, generally not a posed Bézier cubic. Instep intervals are native posed cubics with their own actual handles; reference height controls are never world handles. Clients render supplied samples/landmarks, not a second solver.

Heel edits rebuild B and therefore the actual upper Q while authored depths, source values, and unbent foot/last models remain fixed.
The rear sole now uses alpha in the actual bottom solver. Regional allowance budgets and reference foot/last models remain unchanged; posed bottom coordinates intentionally change.

## Closed boundary and caps

Traverse the boundary in this exact order:

1. Four bottom curves in the new actual rear pose, heel to toe, retaining their source-curve names and arc budgets.
2. `toe_cap`, from the bottom toe to Q(b).
3. `roof_ball_to_toe`, reversed from b to A.
4. `roof_waist_to_ball`, reversed from A to M.
5. `roof_front_to_waist`, reversed from M to a.
6. `top_cut`, parallel to the actual rear sole from Q(a) to the rear cut point R.
7. `rear_cap_upper`, R to the outward middle guide, then `rear_cap_lower` to the bottom heel.

### Rigid rear frame and natural heel back

The authored seat-angle offset is signed in [-90°,90°); the resulting actual rear angle (theta plus offset) must remain in [0°,90°).

Use local coordinates (u,v) transformed by B0+u*t+v*n. Let h be front depth, bulge=heel_bulge_ratio*F and beta=heel_leave_outward_deg. The bottom-to-middle and middle-to-top controls are:

```text
[(0,0), (-.20h*sin(beta),.20h*cos(beta)), (-bulge,.35h), (-bulge,.50h)]
[(-bulge,.50h), (-bulge,.65h), (c/2,h), (c,h)]
top cut: (c,h) -> (a,h)
```

The heel leaves at90°+beta from the sole, bulges outward at the middle and returns inward at the top. Both cubics and the cut share alpha, retaining relative angles. Negative world y is intentional overhang. Traversal reverses both heel cubics. Native controls, joins and prototype clearance/nofold checks are retained; no continuous extreme-size certificate is claimed.

### Toe cap

Require b on the actual final straight ramp, after A+J. Let U=Q(b), T=P(posed total), and w=T_y−U_y>0.
Since g′(b)=1, the forward roof derivative there is:

```text
v = Q'(b) = [unit_ramp_y, unit_ramp_z + h'(b)]
tau = min(w/(3*v_y), h(b)/(3*abs(h'(b))))
```

Omit the second tau bound when h′(b)=0. The toe-cap cubic T→U is:

```text
[T, [T_y, T_z+h(b)/3], U+tau*v, U]
```

Its y is nonincreasing and never exceeds the existing bottom-toe y. Interior controls have positive clearance over the actual
straight ramp; equality is allowed only at T. The cap meets the reversed roof tangentially. Do not modify bottom length or shape
to manufacture a smooth lower join. Toe extension changes this last-tip closure, not the reference roof-knot positions.

### Required continuity and intentional corners

- **C1 at the shared native instep waist** in cubic parameters; **G1 at the ball/forefoot join**. Reference height-cubic joins remain C1.
- **G1 at roof/toe cap** and **top cut/rear cap**: matching tangent direction, not necessarily equal parameter-speed magnitudes.
- **Intentional corners** at the bottom heel, bottom toe, and roof/top-cut front.

The entire closed section is not claimed C1 or wholly cubic. In particular, the roof pieces are compositions, while the caps are
native posed (y,z) cubics and the top cut is a line. Reference (s,h) controls must not be displayed as posed cubic handles.

## Public result and five-report acceptance

Reference foot/top models and source observations remain pose-independent. Actual bottom pose now follows theta plus the authored offset, so previous posed-bottom values intentionally change. `models.section`, `reports.section`, and `display.section` remain the section outputs.
The authored input is now schema 4; a section model's own `schema_version: 1` is a different internal model-format version.

`models.section` has `axes: ["y","z"]`, `plane_x: 0`, `closed: true`, and:

- `points`: `heel_bottom`, `heel_middle`, `toe_bottom`, `cut_rear`, `cut_front`, `waist_roof`, `ball_roof`, `toe_roof`.
  Each is `{y,z,reference_s,height,kind:"landmark"}`. Height is actual vertical offset from B(reference_s);
  bottom endpoints have height 0, and cut-rear height is derived.
- `height_curves`: `front_to_waist`, `waist_to_ball`, `ball_to_toe`, storing the authoritative reference (s,h) cubics.
- `boundary`: ordered recipes, each either `{name,kind:"bottom",source_curve}`, `{name,kind:"roof",height_curve,reverse:true}`,
  `{name,kind:"cubic",points}` for native instep/heel/toe curves, or `{name:"top_cut",kind:"line",points:[Vec2,Vec2]}`.

`display.section` uses the same names/order with [0,y,z] samples: existing bottom samples are reused, each roof/cap has 65 samples,
and the cut has 2. These are display data only; the public recipes/evaluators are authoritative. No mesh, surface fill, or duplicate
client-side reconstruction is required. Side/3D inspection shows the section distinctly from plan outlines and the lower boundary;
fit/reset must account for the upper extents.

All **five** reports—`foot`, `top`, `bottom`, `contour`, `section`—must pass before accepting a current result.
If base reports fail, section is not evaluated and its report must not claim success. Invalid authored domains/order/cut feasibility
reject descriptively; failed actual-geometry certificates are section report failures. The existing safe tRPC 400/422/sanitized-500
behavior, body limits, and Origin/Host guards remain. Dirty/error states and stale responses must not replace current results
or turn LAST VALID geometry into a false success.

Current prototype checks use actual native rear controls, analytic height monotonicity, closure/fixed-angle checks and dense clearance/roof-nofold probes. They are not a continuous extreme-coordinate certificate or general intersection proof; extreme-input safety remains a prototype limitation.

Validation cases include heels 8/40/60/80 mm and valid flat posture; T=0/10/changed; extension 0/.1/.2; resize F225/W90; W-only
adaptation; individual section controls; min-gap, negative, nonfinite and size-boundary inputs. They must distinguish actual upper
pose response from unchanged source/reference data and preserved base outputs, and enforce the fifth report and revision gates.
Final runtime/test counts and browser acceptance are integration results, not asserted by this specification.

## What the sources establish—and do not

- [3DShoemaker's girth guide](https://3dshoemaker.com/foot-girth-measurements-for-bespoke-and-custom-shoe-lasts/) describes
  semi-weight-bearing tape circumferences, not centre-plane heights. Girth is not an automatic height input or roof reconstruction.
- [ISO 19409's public abstract](https://www.iso.org/standard/81028.html) concerns last dimensions, not necessarily corresponding
  anatomical dimensions. The abstract is not the full standard; no restricted full text or standard-compliant measurement procedure is claimed.
- [The public foot-measurement study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7271427/) describes foot-height/girth methods,
  not this centre-plane shape, its synthetic depths, or universal population norms.
- The existing [heel-elevation report](../reports/Heel%20elevation%20and%20plantar%20length.md) does not provide a biologically
   validated dorsal map. The rear-frame blend, reused g, cap recipes, and defaults are explicit prototype construction choices.

Keep source-foot observations, designed last dimensions, and actual generated section measurements distinct. None of these sources
establishes full-last clearance, symmetric halves, physical upper shape, printing readiness, or fit.
