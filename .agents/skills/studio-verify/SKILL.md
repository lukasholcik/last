---
name: studio-verify
description: Verify a change to the shoe-last studio (src/lib/studio, src/app/studio, src/lib/curves) before reporting it done - checks, tests, a look in the real app, docs. Use after any change to the studio's geometry, 3D view or editing.
---

# Verify a studio change

Report only what you actually ran. Order:

1. `pnpm check` (eslint + tsc) must be clean. Format your own files: `pnpm exec prettier --write <files>`
   (do not reformat files you did not change; the tree has many uncommitted files of the user's).
2. `pnpm exec vitest run` (all tests; the `tests-ts/debug/*` probes skip themselves unless `STUDIO_DOC` is set).
   A failing test is either a bug or an assumption the change deliberately broke: say which, and update the test only
   in the second case, with the reason in the test.
3. Geometry or surface changes: add or extend a test that FAILS on the old behaviour, with a number
   (a turn angle, a width, a height). If the flaw came from the user's model, use their saved fixture in `debug/`
   (see `studio-inspect`) rather than the default document: the default hides most flaws.
4. Look at it in the real app, not only in tests (see `studio-inspect`): screenshot the same view the user
   sent, before and after if you still can. Edits to the viewer's markers or camera need this; unit tests do not see them.
   If the Orca tab is not reachable, say the visual check was not run.
5. Docs in the same change (AGENTS.md, "Document every decision"): the doc comment next to the code says why, and
   `docs/specs/studio-parametric-model.md` (or `docs/debugging.md`) is corrected, not appended to. Mark numbers as
   measured / assumed / designed, record limits and any departure from the user's drawn dimensions.
6. Clean up: close tabs you opened, stop a dev server you started, leave nothing running. Do not commit unless asked.
7. Report: what changed, what was verified (with the commands), what was not, known limits.
