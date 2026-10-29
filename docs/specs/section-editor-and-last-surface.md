# Section editor and shared last surface

## Status and ownership

**Lukas approved this direction. This document is the implementation handoff, not an implementation.** A fresh Orca session using OpenCode owns the next changes. Read this document, repository/global `AGENTS.md`, the linked research and the relevant code; no previous transcript is required.

Work in `/Users/lukasholcik/dev/prototypes/last`. Preserve the existing dirty working tree, running preview and independent `/heel` prototype. No reset, stash, cleanup, commits or pushes unless requested. This session must stop after writing the spec; it must not launch the implementing session. **The durable Hermes handoff launcher already owns starting the fresh Orca/OpenCode agent when this session becomes idle, including after a Discord disconnect. Do not launch a duplicate session.**

## 1. Approved outcome and evidence boundaries

Add small, separately editable **face-on 2D section views** and generate one shared, smooth last surface from the same authored last model. Sections, top outline and longitudinal profile must describe the same geometry—not independent drawings joined by an unrelated loft.

The evidence base is [Last sections and measurement evidence](../research/last-section-measurements.md), including its source-access limitations. In particular:

- Ball/joint, waist and instep tape routes vary by protocol; medial/lateral ball landmarks need not share a longitudinal station. A circumference, even with width, does not determine section shape. [Research §§1–2; references 1, 3, 5]
- Short-/long-heel wraps are separately declared surface paths, not ordinary transverse rings. “Long instep” is not a verified universal synonym. Provider-specific angles are not our defaults. [Research §1; references 3–5]
- Foot tracing, plantar contact print, last envelope and featherline are distinct. Do not infer a featherline or full anatomical section from a tracing. [Research §§2–3; references 8, 10, 12]
- Load/posture, heel rise and forefoot support affect observations. No universal foot-to-last, high-heel or material allowance is authorized. The Handbook chapter's full text/figures were unavailable; do not attribute section rules to it. [Research §§1, 3; references 6–11]

Keep **measured foot observations**, **authored last geometry**, **posture**, **fit allowances** and **computed results** separate. Unmeasured shape is explicitly authored, not reconstructed anatomy. Surface generation is approved; automatic fitting to girths is not.

## 2. UX and minimal section set

Keep the current quiet editor: Last is the default top-view mode, the editable last is solid, and the foot reference is dashed. Switching Foot/Last does not copy contours. Preserve per-point reset to foot and existing contour independence.

Provide a compact section strip/panel with these stable semantic IDs:

| Section | Initial landmark-relative location | Purpose |
|---|---|---|
| `heel_width` | Current last medial/lateral heel landmarks | Rear width, lower/upper shape and asymmetry; not heel girth |
| `midfoot` | Current last waist region, with declared offset toward the existing instep/profile region if needed | Combined arch/instep control initially |
| `ball` | Current last medial/lateral ball landmarks, retaining their separate stations | Joint-region section; explicitly oblique where appropriate |
| `fore_toe` | Current last medial/lateral toe landmarks, related to the current toe-roof guide | Toe-box width, height and shape |
| `toe_end` | Existing last toe endpoint/extension | Termination, not another circumference ring |

Allow **Split midfoot into waist and instep** when separate observations or design needs justify it. Initialize the split from the current interpolated shape so it does not jump; retain explicit relative station/frame definitions. Do not add a generic arbitrary-ring catalog. Rear closure and the current upper topcut remain boundary controls, not extra anatomical rings. A last topcut is not the shoe upper's topline.

Each section view shows its local medial/lateral and up/down directions at equal axis scale. Select a point to reveal independent incoming/outgoing Bézier handles; drag width, height, upper/lower shape and asymmetry. Do not add numeric fields for every point. Keep useful dimensions/perimeter as compact readouts; no large drag popovers or explanatory essays. Selection identifies the same section in the main top/profile views and in 3D.

Display each section's location and orientation, not just a numbered station dot. Permit a small location/orientation manipulation affordance with transient feedback; use the same validated edit pipeline. The foot remains reference data, not a second automatically generated last.

## 3. Shared geometry and declared frames

### Responsibilities

Extend the existing typed last input/model rather than introducing a second section-only model. Use typed section, anchor, curve and path IDs, narrow accessors and small cohesive modules:

1. **Observations/fit intent:** values, units, side, protocol, landmarks/path, posture/load, socks/orthotics, repeats and provenance; optional authored last targets/allowances are separate fields.
2. **Authored geometry:** existing last outline/profile plus sparse section refinements and boundary controls. Keep landmark-relative offsets, normalized proportions and local vectors; never persist pointer coordinates as model geometry.
3. **Resolution:** resolve section locations, local frames and shared envelope anchors from the current last and pose.
4. **Construction/sampling:** pure section curves, interpolation/surface and diagnostic path evaluation; separate from validation and viewer rendering.
5. **Interaction:** face-on coordinate projection, selection, gestures and frame scheduling; no independent geometry rules in React.

Preserve schema-4 data, including optional `last_outline` and `section_handles`. Prefer one optional typed section-definition branch with derived defaults when absent; validate unknown IDs/malformed data explicitly. If a version change is genuinely necessary, make its compatibility behavior explicit before changing consumers. Do not discard existing refinements to introduce sections.

### Reversible implementation defaults—not anatomical facts

- Store station locations in the **unbent last reference domain**, relative to named last landmarks, with F/W-normalized offsets. Never substitute foot landmarks for independently edited last landmarks. Keep the existing foot-derived bend anchor and posture convention unchanged.
- Define each authored section frame by an origin, transverse/up basis and an explicit orientation convention. Start with a landmark-relative across-foot direction and local up; zero additional authored tilt is a declared design default, not a measured plane.
- For ball, preserve both medial and lateral longitudinal coordinates. Use their across-span direction plus local up as the declared third orientation constraint; do not silently average them into an orthogonal ring or use an unexplained percentage/angle. The displayed frame must expose that choice.
- Resolve frames through the existing posture/local-frame mapping. Reuse the coupled rear-sole rotation, intentional overhang and roof/frame blend toward the forefoot; toe spring must also propagate. If a reference-plane curve becomes nonplanar under the existing nonrigid pose mapping, show the actual posed curve and label the gizmo as its transported reference frame—not an anatomical planar measurement.
- Seed a small closed cubic profile from available widths and centre-profile upper/lower limits. Start with rounded, optionally asymmetric arcs and a few semantic anchors, e.g. medial, dorsal, lateral and plantar. This starter is authored. No circumference-to-ellipse reconstruction or hidden girth scaling.

These defaults are sufficient to start; missing literature is not a blocker to declared authoring choices. Exact knot count, interpolation implementation and diagnostic path placement remain engineering choices within this contract, not additional user-approved anatomy rules.

### One envelope, not competing sources of truth

The top outline currently lives in `(x, reference_s)` and the existing `centre_section` is a **longitudinal x=0 section**, not the new face-on section set. Preserve those distinctions.

Treat the existing last outline as the reference-domain lateral envelope and the longitudinal centre profile as shared upper/lower seam constraints. Resolve sections against those constraints; do not equate the outline with a measured featherline. Lower/feather-edge shape remains authored where unobserved.

Width or centre-height edits from either editor update shared semantic controls. Reuse a matching named anchor where possible; otherwise use a small typed station refinement consumed by both guide evaluation and surface generation. Do not maintain a second width/height table that can disagree with the main views. Shared anchors move once; local shape/handle refinements are retained relative to them. Interior upper/lower and asymmetric refinements may change shape without unnecessarily moving the envelope.

Between sections, respect the continuous outline and centre-profile constraints, not only the displayed station samples. If a requested edit is incompatible, reject it with the last usable geometry retained; do not silently clip curves, flatten the arch or move unrelated points to conceal disagreement.

## 4. Surface and interaction contract

Generate a deterministic shared surface interpolating the section curves with consistent semantic correspondence and smooth longitudinal blending. A small normalized circumference parameter is an internal sampling convention, not a wholesale polar rewrite. Avoid twisted seams, overshoot outside the declared envelope and accidental holes at section transitions. Preserve deliberately authored corners and a pointed toe; “smooth” must not erase intentional features.

Use the existing rear/topcut/toe boundaries for necessary terminations and caps. The intended first surface is closed and visually coherent, but it is not thereby manufacturing-ready, printable or a validated shoe fit. Do not add export or manufacturing features.

Preserve three separate state levels:

1. **Provisional live 2D:** frame-coalesced edits update the actual dependent section/outline/profile curves, without HTTP rebuilds or full surface tessellation on pointermove.
2. **Accepted editable 2D:** release validates the complete updated 2D model and refreshes handles; repeated section edits accumulate without Rebuild. Valid numeric dimension/posture changes use this same path.
3. **Last explicit successful Rebuild:** generates the surface, 3D section markers, diagnostic paths and reports from one input revision. They remain frozen and visibly stale after 2D changes; never show fresh markers as though they belonged to an old mesh.

Reuse `Editable2DSession` and `RequestGate`. Keep gesture-start frames stable, Escape/pointer cancellation, keyboard nudging, invalid-input recovery, selected-point persistence and discard to the last rebuilt checkpoint. Rejecting a release must preserve earlier accepted 2D edits. A late rebuild response must not overwrite newer edits. Surface-generation failure retains the previous usable 3D checkpoint.

## 5. Short-/long-heel diagnostics

Represent each wrap separately with a stable ID, protocol/name, ordered anatomical/design anchors and an explicitly authored route **on the last surface**. Store normalized surface/landmark-relative references, not detached world polylines. A manually declared route is acceptable initially; do not call it a shortest/geodesic tape path unless that has actually been computed.

Show, per configured path:

- measured foot value and its capture conditions, if available;
- a separately authored last target, if supplied—never inferred from foot girth;
- computed last-surface path length and signed difference `computed − selected comparison value`, in mm;
- path/protocol and checkpoint status; incomplete paths say unconfigured, not zero.

Foot-versus-last differences are diagnostic, not fit errors expected to vanish. Compute surface-path diagnostics with the rebuilt 3D checkpoint; mark old values stale while editing. A face-on section perimeter may be shown separately but must not be substituted for an oblique wrap. Initial scope has no preservation/locking solver, global deformation to match girths or automatic material/high-heel correction.

## 6. Incremental implementation sequence

1. **Baseline and data:** inspect the dirty tree and existing examples; add typed section/frame/path definitions and backward-compatible derived defaults. Establish one shared envelope/anchor resolver, with independent frame/proportion checks.
2. **One face-on editor:** implement `ball` end-to-end through the live 2D session, including oblique landmark offsets, shared width/height edits and linked main-view markers. Establish this narrow path before multiplying views; do not start a separate browser verification campaign for each increment.
3. **Minimal family:** add heel-width, midfoot, fore-toe and endpoint/boundaries through the same narrow interfaces. Add the bounded waist/instep split and retain independent last/foot behavior.
4. **Shared surface:** implement interpolation/caps in pure geometry and integrate explicit Rebuild with the existing Three.js viewer. Include low/high heel and asymmetric/pointed-toe examples in the single short visual smoke; do not trust numeric checks alone or chase exhaustive variants.
5. **Wrap diagnostics:** add explicit short-/long-heel routes and comparison readouts without fitting deformation. Keep incomplete measurements/path definitions honest.
6. **Finish:** within the verification budget below, reconcile affected checks and one short real-browser smoke; report actual evidence, timing and remaining limitations. Stop on a material blocker instead of expanding into a framework or research campaign.

## 7. Acceptance and verification budget

**This is Lukas's personal prototype: keep verification cheap, roughly 10–15 minutes total.** Run focused affected Vitest checks, `pnpm check`, and **one short real-browser visual smoke**. A small render–inspect–fix correction is fine inside that budget; hours of review, polish or repeated smoke/review loops are not. Leave nonblocking rough edges for Lukas's manual testing. If the budget is spent, stop and report failures, unrun checks and limitations rather than silently extending it. Material blockers must be reported, not concealed by a passing summary.

The checks below are a focused acceptance guide, not permission to build a new verification project. No Storybook infrastructure, exhaustive parameter sweeps, formal surface proof or repeated adversarial review campaign.

- Default model resolves the minimal set; enabling sections preserves existing last/foot refinements. Splitting midfoot preserves the current shape within a stated numeric tolerance.
- Independently calculate a few local-to-world frame/vector results, ball medial/lateral station offsets, width/height correspondence and known path-length cases. Builder-against-builder comparisons establish consistency only, not independent correctness.
- Section curves, main envelope/centre seams and rebuilt surface agree at shared anchors and sampled intermediate locations within declared tolerances. Mesh indices are valid; samples/normals are finite; closures have no unintended boundary edges or visible cracks/twists. This is prototype evidence, not continuous extreme-input certification.
- Changing a section updates dependent 2D curves during drag; release refreshes handles; another edit accumulates. 3D mesh, markers, paths and reports change only on explicit successful Rebuild.
- Smoke-check a width/asymmetry edit, a profile-height edit, ball orientation, heel-height/toe-spring change, Escape, rejected release and discard. Inspect actual rendered low/high heel and pointed/asymmetric shapes; confirm the foot reference is unchanged by last edits and the `/heel` prototype is untouched.
- Each heel wrap reports its own correct units/comparison sign, unavailable/stale states and no automatic reshaping. Record representative preview timing before optimizing; start with existing rAF coalescing.

## 8. Current-state handoff and entry points

At handoff, HEAD is `b49c76a`; much of the working implementation is **uncommitted**, including the following files. Do not reconstruct the app from HEAD alone. The main preview has been using `http://127.0.0.1:3000`; verify it read-only and preserve the running process rather than restarting or launching a second Next process against the same build directory.

| Responsibility | Read first |
|---|---|
| Canonical schema, models and checkpoint types | `src/lib/geometry/types.ts`, `examples/foot-first-baseline.json` |
| Foot input, sizing, posture and actual bottom solver | `src/lib/geometry/foot-first.ts`, `contour.ts`, `bottom.ts` |
| Independent last outline; default foot curves | `src/lib/geometry/last-outline.ts`, `top.ts` |
| Current longitudinal centre construction/evaluation/validation | `src/lib/geometry/section.ts`, `section-frame.ts`, `section-handles.ts` |
| Planar-only preview/validation; explicit 3D build | `src/lib/geometry/two-dimensional.ts` (`previewLast2D`, `buildLast2D`), `index.ts` (`buildLast`) |
| Typed drag mappings and reset/rebase behavior | `src/lib/shaping/{types,index,foot-outline,side-profile}.ts` |
| Editable 2D session and frozen rebuild ownership | `src/app/_components/viewer/{editable-2d,useEditable2D,Workbench,state}.ts*` |
| Existing pointer/selection/rendering patterns | `src/app/_components/viewer/{AlignedGuides,ProfileHandles}.tsx`, `profile-pointer.ts`, `shape-selection.ts` |
| Current 3D guides and report display | `src/app/_components/viewer/{Scene,Reports}.tsx`, `scene-controller.ts` |
| Transport | `src/server/api/routers/last.ts` (`last.defaults`, `last.rebuild`) |
| Focused tests | `tests-ts/geometry/{two-dimensional,section,shape-controls,foot-first}.test.ts`, `tests-ts/shaping/`, `tests-ts/viewer/`, `tests-ts/api/` |

Current `buildLast` adds posed outline samples to validated 2D geometry; **there is no shared main-last surface or face-on section editor yet**. `Last2DGeometry` intentionally has no `display.top`. Extend these boundaries rather than routing 3D generation into pointer handlers or treating guide samples as a finished solid.

Keep `src/app/heel/**`, `src/lib/heel/**`, `tests-ts/heel/**`, `docs/heel-model.md` and `docs/heel-handoff.md` out of this change. Do not merge the independent heel component's model, live-mesh contract or assumptions into the main last editor. Keep Python/legacy reference fixtures unchanged unless a directly affected assertion legitimately changes.

Before UI code, read the installed Next guidance required by `AGENTS.md`. Use pnpm and component-named React files. This spec requires no new package, broad redesign or generic CAD framework. Earlier geometry docs may contain superseded upright-back/horizontal-topcut/schema rules: current code plus the approved requirements above take precedence.

**Fresh-session first action:** read this spec and `AGENTS.md`, inspect the current tree and the listed resolver/session entry points, then implement increment 1. The documentation session has not started that increment and must yield ownership without spawning another agent.
