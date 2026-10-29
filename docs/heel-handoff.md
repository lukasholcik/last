# Heel editor handoff — U outline, tip placement and front shoulder

## Preview

- <http://127.0.0.1:3020/heel> — slender example.
- <http://127.0.0.1:3020/heel?example=broad> — broad example, same construction.
- Separate dev process left running on **3020**, PID **8722** at this handoff.
  Main preview on **3000**, PID **66594**, was left untouched.

The preview serves a temporary source snapshot, not the main preview's output:
`/private/var/folders/1h/d65b2xp965ldsk2n6lk0khfm0000gp/T/opencode/heel-preview`.
It uses its own `.next-heel` directory and a node_modules symlink. From there it
was launched with the checkout's `node_modules/.bin/next dev --webpack --hostname
127.0.0.1 --port 3020`. Later source changes must be copied into this snapshot.

## This increment

- Orange ground grips move the tip fore/aft in the side view or laterally in the
  rear view. Only one bottom-centre coordinate changes: top, dimensions and
  authored handles remain unchanged. Escape restores the gesture start.
- Numeric offsets reference the **untrimmed top bounding-box centre**, not the
  area centroid. Body/footprint overhang is bounded to 20 mm beyond the source
  box, with additional plane-clearance/facet restrictions.
- Both cap outlines are closed U/D shapes: straight front toward the toes (+y),
  curved rear (-y). Rear roundness 2–4 affects only the rear curve.
- **Front shoulder** is a real front-only blend with a tangent analytic join to
  the retained planar seating area. It removes a small front strip; the amount
  measures that strip along the seat plane, not a constant circular radius.
- The plan inset distinguishes actual seating area, ground footprint and dashed
  untrimmed top guide. Section/cap metadata drives every view; no ring-count
  assumptions or separate visual-only mesh patches.

## Owned scope

Only `src/lib/heel/**`, `src/app/heel/**`, `tests-ts/heel/**`,
`docs/heel-model.md` and this handoff. New UI modules are `HeelFootprints.tsx`
and `tip-placement.ts`; the latter has dedicated tests. All existing last
geometry/schema/viewer files and shared styles/config remain read-only to this
work. No dependencies, commits, staging, or image assets were added.

## Actual checks

```sh
node_modules/.bin/vitest run tests-ts/heel
node_modules/.bin/tsc --noEmit --incremental false
node_modules/.bin/eslint src/app/heel src/lib/heel tests-ts/heel
```

**37 tests across 4 files passed; full TypeScript and scoped ESLint passed.**
An earlier full type check encountered transient prop mismatches in the
concurrently edited main viewer; the final rerun passed without this lane
changing those files. A temporary heel-only tsconfig also passed. No full
production build or unrelated test sweep was run. Local binaries were used
because the pnpm shim failed in this environment.

Tests cover finite dimensions, closed oriented manifold topology, nondegenerate
facets, volume, planar caps, D fronts/rears, shared boundary metadata, shoulder
trim/tangency, preserved asymmetry, placement/overhang, invalid edits, and both
examples at 8/80/120 mm. Rounded meshes have **2,626 vertices / 5,248 triangles**;
zero-shoulder meshes have 2,114 / 4,224. Mesh builds during actual browser edits
were about **2–11 ms**; no worker was needed.

Browser QA used a dedicated agent-browser session at 1512 × 1100. Actual mouse
drags moved tip centre y from 15.787 to 39.969 mm (0.721 mm front overhang), and
x from 0.5 to 15.009 mm. While the mouse remained pressed, the **actual top-cap
vertices compared exactly equal**, as did authored top parameters and handles;
width/depth were unchanged. Another lateral drag reached x=19.846 mm, then Escape
restored 15.009 mm. Keyboard movement advanced x by 0.2 mm.

Inspected actual side/rear/oblique renders and orbited above the U-shaped cap.
Changing shoulder 3 → 0 mm changed mesh topology and moved the front seating edge
by exactly 3 mm along the seat plane, leaving the rear unchanged. A 7 mm shoulder
was rejected while retaining the same last-valid mesh and canvas; recovery worked.
The broad example was inspected with both 3 and 6 mm shoulders. Final browser
console had no geometry/hydration warnings and captured page errors were empty.

## Visual evidence

Screenshots are **outside the repository**, in:
`/private/var/folders/1h/d65b2xp965ldsk2n6lk0khfm0000gp/T/opencode/heel-step2-evidence`.

- `u-heel-oblique.png`, `u-heel-rear.png`, `u-heel-orbit-top.png`.
- `front-shoulder-3-side.png`, `front-shoulder-0-side.png` — geometric comparison.
- `tip-offset-after-drags.png` — fixed top with repositioned tip.
- `invalid-shoulder-preserves-solid.png`.
- `broad-u-oblique.png`, `broad-u-shoulder6-side.png`.

The supplied sketches informed the U/D outline and front-shoulder intent; these
are not claims of dimensionally matching the commercial tip photo or a real foot.

## Limits / next slice

Still a synthetic, provisional shape study: no verified mating perimeter,
actual sole/shank, full-perimeter/three-way corner blend, steel core or bores,
heel-tip hardware, export, persistence, strength analysis or fit/manufacturing
certification. Lateral shoulder corners retain sharp edges. Some geometrically
plausible edits are conservatively rejected. Source posture is copied through
the read-only adapter and is not live-synchronized with the main last viewer.

Next sensible slice remains a trustworthy heel-seat perimeter/attachment frame;
then design the actual sole-to-heel junction as a separate, explicit capability.
See `heel-model.md` for equations and admissibility limits.
