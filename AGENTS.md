<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Document every decision

Record the decisions you make while working, in the same change that makes them. A decision is anything a later reader could not
rebuild from the code alone: a modelling choice, a constant or default, a constraint or dependency between values, a rejected
alternative, a known limitation, or a convention taken from a source.

**Where it goes**

- **In the source file, next to the code it explains**, whenever the decision applies to one function, type or constant. Write a
  doc comment that says *why* (and what was rejected, if that matters), not what the next line does. This is the preferred place:
  it is at hand when the code is read.
- **In a Markdown file under `docs/`** when the decision spans several files or views, or is a contract other code depends on:
  specs in `docs/specs/`, model and contract descriptions in `docs/`, evidence in `docs/research/`. Update the existing document
  that owns the topic instead of starting a second one; add a new file only for a new topic, and link it from related documents.
- **In a handoff document** (like `docs/section-editor-handoff.md`) when you finish an increment: what changed, how to use it, what
  was actually run to check it, and the known limits. Report only checks that were actually run.

**What to write down**

- Say whether a number is **measured**, **assumed** or **designed**, and whether it is **entered** or **calculated** (and from what).
  Never present a guess as established fact; name the source for anything taken from a standard or reference, and mark our own
  conventions as conventions.
- State what a value depends on and what depends on it. When a curve or point is driven by another view or parameter, say so where
  the link is defined.
- Record limitations and unsupported cases explicitly, not only the happy path.

**Keep it true**

- Change the documentation in the same change as the behaviour. Remove or correct text that is no longer accurate rather than
  leaving it beside the new text.
- If you notice documentation that disagrees with the code, fix it or say so in your report.
- A task that changes behaviour or makes a design choice is not finished until the matching comment or document is updated.
