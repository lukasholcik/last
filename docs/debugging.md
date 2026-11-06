# Debugging the studio against the user's real model

Why: a flaw in the 3D last usually depends on the user's own curves, not on the default document, so it has to be
reproduced from their model and their view. This page is the contract of the tools that make that possible; the
step-by-step workflow for an agent is the skill `.agents/skills/studio-inspect`, the checklist is `studio-verify`.

## What exists

| Piece               | Where                                                          | What it gives                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Saved model         | `localStorage["last-studio.document.v2"]` of the tab           | The document as JSON, written ~300 ms after each edit (debounced, so it can lag a live drag).                                                                                                                                                                                                                                                                      |
| `window.__studio`   | `Studio.tsx`, development builds only                          | `doc()` the live document as the saved JSON; `setDoc(json)` loads one (one undo step); `state()` the view, 3D options and selection; `setView("work" \| "3d" \| "top" \| "side" \| "section")`; `setViewer({...})`.                                                                                                                                                |
| `window.__viewer3d` | `Viewer3D.tsx`, development builds only (3D view must be open) | `camera()` reads `{ortho, position, target, halfHeight, fov}`; `setCamera({...})` sets it; `view(name)` a standard view; `screen([x,y,z])` the page pixel of a world point; `linePoint("rail:lateral" \| "section:ball", f)` a point along a line; `click(x, y)` a synthetic left click (aim with the two above; no pointer capture, so marker drags do not work). |
| Fixtures            | `debug/*.json`                                                 | Models saved from the app, named for the flaw. `toe-chopped.json` is used by `tests-ts/curves/loft.test.ts`.                                                                                                                                                                                                                                                       |
| Probes              | `tests-ts/debug/inspect.test.ts`, `ring.test.ts`               | Headless numbers from a fixture (slice sizes; one ring with the turn angle per vertex). Skipped unless `STUDIO_DOC` is set.                                                                                                                                                                                                                                        |
| Scripts             | `.agents/skills/studio-inspect/scripts/`                       | `page.sh`, `eval.sh`, `save-doc.sh`, `load-doc.sh`, `shot.sh` (`VIEW=work\|3d\|top\|side\|section` picks the tab): drive the Orca browser tab with the `orca` CLI.                                                                                                                                                                                                 |

## Decisions and limits

- The hooks are attached only when `process.env.NODE_ENV !== "production"`, so a production build exposes nothing. They are
  read/write handles on the same state the UI uses (no second source of truth).
- The user's camera is not persisted anywhere; read it with `camera()` before reloading the tab.
- `setDoc` uses a normal history commit, so the user's previous model is one Ctrl+Z away. Reference images are not part of the
  document JSON (they are stored under separate keys) and are not captured.
- The probes build the surface from the JSON with the same code the app uses (`buildLoft`, with the heel pose when the side
  parameters are valid), so their numbers are the app's numbers, but they do not see the markers or any viewer state.
- A screenshot is the tab's viewport as the user sees it (window size included); compare shapes and creases, not pixel sizes.
