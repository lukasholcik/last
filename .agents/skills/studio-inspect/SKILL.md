---
name: studio-inspect
description: Reproduce what the user sees in the running /studio app (the Orca browser tab) - read their live model and 3D camera, screenshot the same view, and measure the surface headlessly. Use when the user reports a visual flaw in the 3D last, sends a screenshot, or says "look at my model".
---

# Inspect the user's model

The user runs the app in an Orca browser tab. A development-only hook exposes
the live state (`window.__studio`, `window.__viewer3d`; contract and limits in
`docs/debugging.md`). All commands below run from the repo root.

## 1. Check the app and the tab
- `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/studio` must say 200. If the
  server is down, start `pnpm exec next dev -H 127.0.0.1 -p 3000` in the background, then reload the tab
  (`orca reload --page $(.agents/skills/studio-inspect/scripts/page.sh)`). The model is in localStorage,
  so a reload keeps it; the camera and selection reset.
- `.agents/skills/studio-inspect/scripts/page.sh` prints the page id of the open /studio tab.
  Tools are `orca ...` (see the `orca-cli` skill); never use the Chrome extension for this.
- If you started the server, kill it when done (the user may ask: only the process you started).

## 2. Capture the model and the view (read-only)
- Camera first, before touching anything (the user's view is not saved anywhere):
  `scripts/eval.sh 'JSON.stringify(window.__viewer3d.camera())'`
- Model: `scripts/save-doc.sh debug/<short-name>.json`. This is the LIVE document, same JSON as
  "Autosaved locally". Keep it in `debug/`, named for the flaw (`toe-chopped.json`); it becomes a regression fixture.
- Screenshot of the user's current view: `scripts/shot.sh <out.png>` (`VIEW=work` for the Workspace with Top and Side panes;
  `__viewer3d.screen/linePoint/click` aim a synthetic click at a rail line, see `docs/debugging.md`); with a camera:
  `scripts/shot.sh <out.png> '{ortho:false,position:[-160,420,150],target:[0,250,40]}'`.
  Model axes: x across (lateral +), y heel to toe (about 0..297 mm), z up. Look at the png with Read.
- Do not change the user's model in their tab. `scripts/load-doc.sh file.json` replaces it (one undo step);
  only use it when the user asked, or after saving theirs.

## 3. Measure headlessly (numbers beat eyeballing)
- Slices (width/height per y): `STUDIO_DOC=debug/x.json STUDIO_FROM=0.8 pnpm exec vitest run tests-ts/debug/inspect.test.ts --silent=false`
- One cross-section ring with the turn angle at every vertex (kinks show as big turns,
  anchors are every 10th vertex): `STUDIO_DOC=debug/x.json STUDIO_SLICE=84 pnpm exec vitest run tests-ts/debug/ring.test.ts --silent=false`
  (`STUDIO_FLAT=1` for the unposed surface). Ring order: sole, lateral_bottom, lateral, lateral_shoulder, crown,
  medial_shoulder, medial, medial_bottom.
- Section plane tilt per heel height vs the posed sole slope: `STUDIO_DOC=debug/x.json pnpm exec vitest run tests-ts/debug/tilt.test.ts --silent=false`;
  rear of the surface vs the side contour per height band: `.../heelmatch.test.ts`;
  sharpest creases of the surface (angle between neighbouring triangles) by region, flat/cut/posed: `.../creases.test.ts`.
- Add a new probe next to these when the flaw is something else; keep them skipped unless `STUDIO_DOC` is set.

## 4. Find the cause, then fix
- The surface is built in `src/lib/studio/loft.ts`; the spec is `docs/specs/studio-parametric-model.md`.
- Look at the user's data too (`debug/*.json`): a flaw is often a drawn curve (e.g. a toe wall in the side view)
  and not a bug. Say which it is, and when the fix departs from the drawn dimensions, record it in the spec.
- Turn the measurement into a test (see `tests-ts/curves/loft.test.ts`, "toe of a model with a toe wall") that fails
  on the old code, then follow `studio-verify`.
