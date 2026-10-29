# Isolated heel loft (provisional)

`/heel` uses `src/lib/heel` independently of the main last editor. Coordinates are
millimetres: x right/lateral, y forward, z up, ground z=0. This is a small explicit
closed loft, **not** arbitrary CAD, anatomical reconstruction, fit prediction,
structural analysis, a manufacturable heel, or a verified mating surface.

## Source and registration

`getHeelSeat(heelHeight = 80, seatOffsetDeg = 2)` copies and parses the schema-v4
`examples/foot-first-baseline.json`, replaces only those two pose fields, and calls
the existing read-only `buildFootFirst`. The default 80 mm is an independent
illustrative pose: the source JSON remains 8 mm and the main viewer's current
state is neither consulted nor modified. Source builder errors propagate to the
caller as recoverable errors.

The actual `bottom_heel_rear` and `bottom_seat_front` y,z coordinates define the
seat projected length and pitch, including the source's heel-height-dependent
bend angle. The offset is **not** the final seat pitch. Heel-local y=0 is the rear
seat point. The plane is `z = H - tan(pitch) * y`. The source medial heel extent
times foot.width is negative x; the lateral equivalent is positive x. Their
asymmetry is preserved (-28 and +29 mm approximately for the current baseline).

There is no source 3D last surface. Only an open longitudinal bottom profile and
centre section exist. Therefore the top perimeter is explicitly a **provisional
closed D/U outline bounded by the heel-region length and heel widths**, not the
full foot outline, a traced perimeter, or measured fit. Provenance and limitation
strings travel with `SeatGuide` for display. Heel width station positions are not
enough to recover a real seat perimeter.

## One model, two starting shapes

`createHeelParameters(seat, 'slender' | 'broad')` supplies two initial values for
the same loft algorithm. Slender has a narrow lower shaft with a flared seat;
broad has a near-full-width/depth footprint. These are not separate surface
models or a preset catalogue. The initial top matches `SeatGuide`, but its four
provisional outline extents are independently editable inside the source heel
bounding box with strictly positive width and depth. The source seat plane stays
fixed: moving top.backY never translates or flattens that plane. The authored top
asymmetry (initially the source's, then the user's edits) must not be overwritten
by a body-symmetry toggle.
At low poses the initial longitudinal handle flare is eased towards linear
controls only as far as needed for the monotone-height certificate below;
transverse flare and both endpoint footprints are unchanged.

Bottom width/depth describe the bounding box of the same closed D outline used
at the top. Each section has a curved rear (-y), two straight sides, and one
straight transverse front (+y). `roundness` is the rear superellipse exponent n,
bounded to [2,4]: 2 is an elliptical rear half; 4 is a squarer rounded rear.
It affects **only the rear**, never rounds the straight front into an ellipse.
The same outline rule and exponent apply to both examples and every section.

Back/front y bounds and left/right x bounds are independent scalar cubics from
bottom (t=0) to top (t=1). The two stored handle values are absolute **Bernstein
control coordinates**, associated with t=1/3 and 2/3, not points the curve passes
through at those parameters. `symmetricBody` preserves each interior control's
authored width but centres it on the line interpolating bottom and top centres.
It does not alter bottom or top extents. Both left/right edits influence width;
a symmetric UI should expose one width control or synchronize its pair.

Ground placement changes **only** `bottom.centerX` and `bottom.centerY`; do not
move the top or rewrite authored handles as part of a translation. Effective
mirrored interior centres still follow the interpolated bottom/top centre line.
`getHeelEditingBounds(seat)` returns the source box expanded by 20 mm in each
direction for body controls and bottom endpoints. `getTipPositionBounds(p,seat)`
subtracts bottom half-width/depth from that box to give allowable centre ranges.
These helpers are exported from both `model.ts` and `loft.ts`. They are editing
box limits, **not** a promise that every placement passes plane/fold checks.
The editable top envelope remains bounded by the original unexpanded source.

## D outline and front-only shoulder

The four nominal scalar cubics are L,R,B,F, with C=(L+R)/2, J=(B+F)/2,
rx=(R-L)/2 and ry=(F-B)/2. With actual front A=F-trim(t), traverse
counterclockwise using theta in [0,2pi):

- [0,pi/4]: right side x=R, y=J+u(A-J), u=4theta/pi.
- [pi/4,3pi/4]: straight front x=R+u(L-R), y=A,
  u=2(theta-pi/4)/pi.
- [3pi/4,pi]: left side x=L, y=A+u(J-A), u=4(theta-3pi/4)/pi.
- [pi,2pi]: curved rear x=C+rx*spow(cos(theta),2/n),
  y=J+ry*spow(sin(theta),2/n).

J is always the **nominal** middle, not a recentered trimmed middle. No seam or
corner is duplicated. Theta 0, pi/2, pi and 3pi/2 correspond to right, front,
left and back, but consumers must use the exported section cardinal metadata
rather than assume array offsets.

`frontShoulderMm` is an amount in [0,6] mm: **the top-front strip length removed
in the seat plane**, not a constant-radius fillet. With k=tan(pitch), q=sqrt(1+k²),
r=frontShoulderMm, and F1=F(1), define:

```
a = r/q
hcap = H-k*(F1-a)
dt = r*q/hcap
t0 = 1-dt
trim(t) = 0                                   for t <= t0
trim(t) = a*(1-sqrt(1-s²)), s=(t-t0)/dt        above t0
```

r=0 is the sharp form with no shoulder band. For r>0, the top front is F1-a;
its displacement from the sharp envelope has seat-plane length exactly r.
The planar top seating **area** is retained, but explicitly loses that front
strip. `top` parameters continue to mean the **sharp envelope**, not the trimmed
actual cap. `getTopEnvelope(p,seat)` returns 64 sharp-envelope guide points without
a full mesh build. `mesh.caps.top` is authoritative for the actual seating area.
Do not use the sharp envelope as if it were the solid's actual contact boundary.

The shoulder is part of the heel, not an added sole, a bead, or a second object.
Only the front upper shoulder is blended. Lateral wall corners retain sharp
edges; there is no three-way corner-blend or full-perimeter fillet claim.
At t0, trim'=0 and the shoulder matches the body tangent. For stable sampling
use t=t0+dt*sin(phi), trim=a*(1-cos(phi)), phi in [0,pi/2]. At the top front,
dP/dphi=(0,-a,k*a); crossed with the front tangent towards -x this gives the
positive source-plane normal proportional to (0,k,1). This is tangency of the
analytic surface; the finite mesh approximates it with chords.

Both examples start at r=3 mm for the 80 mm illustrative pose. Short/low poses
reduce the amount using plane clearance, available band and footprint depth
margins so the 8 mm defaults remain admissible. No structural suitability is
inferred from the chosen amount.

## Boundary handles and projection

The vertical mapping is `z(t,y) = t * (H - tan(pitch)*y)` using source-global y.
Bottom is exactly on ground; the entire top, not just its centre, lies on the
source seat plane. Intermediate sections are planes with linearly increasing
tilt. Nominal y(t) is cubic, making nominal z(t) generally **quartic**; the
shoulder adds the non-polynomial trim. An actual rounded front rim may descend
in world z as it approaches the tilted seating plane: monotone t is required,
not monotone world z through the shoulder.

Accordingly `curveControlPoints` returns four **representative 3D handle markers**,
not a cubic control polygon for rendering. Their x/y values are the actual scalar
Bernstein controls (orthogonal coordinate is the corresponding centre control);
z uses that marker's section t=i/3. These markers describe the **nominal sharp
envelope**, not a curved shoulder control polygon. Designer projections can drag back/front in y
and left/right in x; their z is derived and must not be edited independently.
When mirrored, use the effective returned transverse controls for marker positions.
Never connect those four points as a cubic to claim an actual mesh boundary.
Use `pointOnHeel`, or preferably the mesh, for the true boundary.

`projectMesh(mesh, 'side'|'rear'|'top'|'bottom')` returns projected versions of the
**same indexed triangles**: side [y,z], rear [x,z], top/bottom [x,y]. The UI should
fill their union as the silhouette, not draw a separately constructed profile.
Top and bottom are orthographic views of the whole solid, not isolated cap
outlines (both use the same x/y convention; screen mirroring is the renderer's
choice). Camera/screen transforms, aspect preservation, and screen vertical
inversion belong to the renderer.

## Admissible family and recoverable errors

The build rejects nonfinite dimensions, exponent outside [2,4], nonpositive
footprints, crossed Bernstein controls or top extents, top extents outside the
source box, and body controls/footprints outside the expanded 20 mm box. Edited top extents
need not equal the source extents; their z coordinates must stay on the unchanged
source seat plane. Seat heights
are limited to 1–300 mm and pitch to less than 80 degrees in magnitude. These
are explicit prototype limits, not validated footwear design ranges. Source
solver feasibility and the checks below can further restrict these ranges.

Every Bernstein width and depth coefficient must be positive. The convex-hull
property then proves positive spans at all t, rather than just sampled rings.
The full source plane over the source heel box must clear the ground, even
when the edited top is smaller. Every actual nominal body y coefficient must
also keep h(y)=H-k*y positive, including overhanging controls. The **expanded
box as a whole** need not clear the plane: only the authored body controls do.
Actual section y lies between nominal B and F, so those checks also cover trim.
Writing each nominal boundary's four y controls as y_i, the exact Bernstein
coefficients of nominal dz/dt are:

`H - k * ((i+1)*y_i - i*y_(i-1))`, i=0..3,

where the i=0 previous term is zero. Requiring all four to be positive is a
conservative certificate of nominal increasing height, not a claim that the
rounded rim is world-z-monotone. It deliberately rejects some otherwise
plausible aggressive flare edits.

Let Dmin=min_i((F_i-B_i)/2). Positive shoulder amounts additionally require
a<Dmin, hcap>0 and 0<dt<=0.25. This ensures B<J<A at every section: an interior
centre, convex D section and nonzero remaining cap depth. Amounts are not silently
clamped on edits. There is no certified physical thickness or strength check.

For the continuous solid, every section is a convex filled D at a unique t.
In coordinates (x,y,t), z=t*(H-k*y) has positive Jacobian determinant H-k*y.
t is uniquely recoverable from z/(H-k*y). Thus the map is globally injective
even where the shoulder's world z descends; no arbitrary freeform folding is allowed.
The extra dz/dt certificate provides practical conservative handle limits.
This proves the continuous solid, so the faceted mesh gets an additional
conservative runtime certificate. The positive projective mapping
`(x,y,z) -> (x/h(y), y/h(y), z/h(y))`, with `h(y)=H-k*y`, preserves triangles
and sends all ring planes to parallel t planes. Each side facet must face away
from both endpoints of the line connecting its two transformed interior ring
centres. By linearity it then faces away from the centre at every intermediate
section. Each section polygon has strictly positive radial orientation and
winding one, making it star-shaped and preventing self-crossings. The convex
caps close the two ends. A facet failing this certificate is rejected rather
than assuming the continuous proof automatically protects the tessellation.
Large ring shifts can therefore be rejected even when the smooth family is
injective. No tessellation of arbitrary freeform surfaces is claimed safe.

`buildHeel` throws a descriptive `Error` on an invalid edit. The UI must catch it,
show the message, and keep the last valid mesh; do not clamp, silently substitute
another shape, or discard the source registration. Drag limits should follow
the bounds above and still attempt validation before accepting edits.

## Mesh and checks

The sharp mesh has 33 sections of 64 vertices (32 intervals), 2,114 total
vertices and 4,224 triangles. With a positive shoulder, it has 32 ordinary
intervals from 0 to t0, then 8 shoulder intervals at phi=m*pi/16, m=1..8;
t0 is included once. That gives 41 sections, 2,626 vertices and 5,248 triangles.
Both caps are shared-vertex fans; the cap centre is the nominal (C,J) on its
section plane, strictly inside the D. Boundary points are counterclockwise in
x/y; side triangles wind outward, bottom cap down, top cap up. No duplicate seam
vertices exist. Bounds and positive oriented polyhedral volume are calculated
from the actual mesh. Finite vertices, nondegenerate triangles and positive
volume are runtime checks; topology is fixed by construction. It is an explicit
faceted approximation, not a smooth CAD surface or an exact smooth-solid volume.

`sections` contains the actual t, global boundary vertex IDs, and a global vertex
ID for each cardinal. `caps.top` and `caps.bottom` each contain global boundary
IDs plus the cap centre ID. `rings` is kept for compatibility and contains the
same position references as each section's boundary. Use metadata for rendering,
outlines and editing markers: do not hard-code section counts or cap offsets.

`tests-ts/heel/geometry.test.ts` checks finite values, deterministic output,
shared edges twice with opposite directions, sphere Euler characteristic,
nonzero triangles, outward caps, positive independently calculated volume,
exact ground/seat-plane registration after shifted/shrunken top edits, authored
asymmetry, projected-mesh correspondence,
sampled nominal orientation, sharp/rounded topology, cap trim metric, analytic
and sampled tangency, D-outline fronts/rears, placement/overhang, and rejected
edits. Low 8 mm, illustrative
80 mm, and high 120 mm poses exercise both initial shapes. A warm 200-build
benchmark logs synchronous mesh-generation time without adding infrastructure
or a machine-dependent CI timing threshold. Adapter/source-building time is
excluded; do not call the source builder on every body-handle movement.

Run `pnpm exec vitest run tests-ts/heel/geometry.test.ts` and lint only the owned
TypeScript paths. Browser/integration validation belongs to the integrating lane.
