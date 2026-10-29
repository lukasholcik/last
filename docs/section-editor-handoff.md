# Section editor handoff

Implementation source of truth: [approved scope](specs/section-editor-and-last-surface.md) and [measurement evidence](research/last-section-measurements.md). Work is in the existing checkout; no commit or push.

## Using the increment

- The compact face-on strip starts with heel width, midfoot, landmark-oblique ball, fore toe and toe endpoint. Select a point to expose independent incoming/outgoing handles; drag or use arrow keys (Shift: 5 mm, Alt: 0.1 mm). Escape cancels a drag.
- Last-width, asymmetry and dorsal-depth edits update the actual dependent outline/profile live. Accepted edits accumulate without Rebuild. The selected section has reference-domain station/orientation markers above and its posed projection in the profile.
- Location ±1 mm and authored tilt ±1° controls apply through the same validated editing session. **Split midfoot** makes waist and instep available; separate their stations before independently shaping them.
- **Rebuild 3D** explicitly updates the shared shaded surface, section rings, transported frame axes and wrap results together. Editing 2D marks the old 3D checkpoint stale; selecting a section only highlights its existing rebuilt marker. **Discard changes** restores that checkpoint.
- Expand each heel-wrap card, supply a separate authored last target, and opt into its declared prototype route. Rebuild computes its path and signed comparison. The initial paths are unconfigured, and no foot measurements are invented.

## Geometry and declared defaults

- Schema 4 retains `last_outline` and `section_handles`; optional `cross_sections` stores normalized local refinements, frame offsets/tilt and separately declared heel-wrap routes.
- Sections derive from the current **last** landmarks and the existing longitudinal centre profile. Ball retains independent medial/lateral stations. The foot remains reference data.
- Initial sections use four semantic cubic anchors: medial, dorsal, lateral and plantar. Rounded starter curves are authored defaults, not reconstructed anatomy or girth fitting.
- Frame offsets are bounded to ±0.2 foot length and additional orientation to ±30°. Frames are transported through the existing posture mapping; the posed section need not be planar.
- Splitting midfoot initially creates coincident waist/instep sections with exactly the same shape. Separate their frame stations before independently shaping them.
- The surface follows the continuous outline and centre seams, with normalized semantic curve interpolation and rear/topcut/toe closure. It is an inspection prototype, not manufacturing or fit validation.
- Short-/long-heel routes are independent, ordered normalized surface references. Differences are `computed − comparison` in mm, not errors to solve away. No automatic fit or global constraint solver.

## Checks and preview

The preview was not running at takeover; `pnpm dev` was started on the free port and is left running at **http://127.0.0.1:3000**. Start it again with `pnpm dev` if needed. The independent heel editor remains at `/heel`. Edits are page-local, not persisted.

Actually run:

- `pnpm check` — lint and TypeScript passed on the final code.
- `pnpm exec vitest run tests-ts/geometry/cross-sections.test.ts tests-ts/geometry/two-dimensional.test.ts tests-ts/geometry/section.test.ts tests-ts/shaping/ tests-ts/viewer/editable-2d.test.ts tests-ts/viewer/section-editor.test.ts tests-ts/api/last.test.ts` — **76 tests passed, 8 files, 9.72 s** on the final code. An earlier run exposed an old assertion accepting a medial-waist landmark across the centre seam; that directly affected assertion now expects rejection, rather than weakening the shared model validation.
- One short real Chromium smoke at 1440 × 1050, with actual screenshot inspection: initial five editors, live ball-width/asymmetry drag, dorsal keyboard edit, ball tilt, Escape, retained accepted edits, discard, midfoot split, fore-toe width, explicit Rebuild, low heel (8 mm), high heel (80 mm), toe spring (18 mm), and an extended pointed on-axis toe (20 mm extension). Observed a provisional 2D update around **19.1 ms**, with unchanged 3D revision until Rebuild. Foot curve shape remained identical after accounting for a uniform drawing-layout translation.
- Both declared wrap comparisons were exercised: short target 210 mm → computed 251.0154 mm, difference **+41.0154 mm**; long target 260 mm → computed 310.6009 mm, difference **+50.6009 mm** on the final high-heel smoke model. Initial unconfigured and editing/stale states were also observed. Browser error collection was empty.
- The visual smoke exposed a rear-cap inversion bug; one focused correction fixed the actual cap traversal direction, with a new continuity check and reinspection of the rebuilt low/high-heel meshes. No broad regression sweep or review campaign was run. Final integrated verification, including this correction, took roughly five minutes; earlier focused geometry checks were seconds each.
- SHA-256 comparison confirmed all **18 files** under the independent heel implementation/tests and its two handoff/model documents unchanged from the preservation baseline. Screenshots remain outside the repository in the session temporary directory.

## Known prototype limits

- **Off-axis toe termination remains unsupported by the new surface.** A last toe-tip lateral offset can still produce valid 2D geometry, but Rebuild rejects when the narrowing outline no longer spans the shared x=0 seam (confirmed at `toe_tip.side_offset_ratio: 0.2`, x=20 mm on the baseline). It retains the previous 3D checkpoint rather than clipping or silently changing the outline. Supporting that case needs an explicit off-axis seam-continuation rule. Pointed toes with an on-axis endpoint and asymmetric sides are separate from this limitation.
- Plantar anchors follow the shared bottom profile; edit that profile instead. Toe end is a termination, not a circumference ring.
- Width-point changes on additionally moved/tilted frames are rejected; restore the landmark-relative frame or edit local handles.
- Dorsal dragging changes the nearest shared profile-height control; off-knot/oblique pointer correspondence is approximate.
- A section whose across-span frame cannot cross both sides of the x=0 seam is rejected. This intentionally narrows the previous 2D-only freedom to drag a medial landmark entirely across that seam.
- Surface closure is prototype evidence, not certification for extreme controls. The green 3D outline remains a transported reference guide, not an asserted on-surface featherline. Sparse interpolation can still look stylized.
- The wrap UI declares the two documented prototype routes, not an arbitrary route editor. Custom normalized routes and optional measured-foot capture conditions are supported in the typed input, but no measurement-import UI was added. Reapplying the UI declaration replaces that path with the documented prototype route.
- Measurements and targets are optional and separate. No inferred foot girths, material allowances or high-heel corrections.
