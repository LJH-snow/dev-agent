# CLI Sticky Viewport and Composer

**Date:** 2026-09-25
**Objective:** Make the interactive CLI keep the active task prompt visible at the top while the transcript is scrolled, and keep the return-to-bottom affordance, composer, status, and footer visible at the bottom, matching the referenced Codex CLI interaction without weakening existing viewport, input, or terminal safety behavior.

## Scope

- [x] Inspect the current Ink layout, viewport model, prompt/transcript data, and tests.
- [x] Add a bounded sticky task header that reflects the active user task/request.
- [x] Move browsing/navigation feedback into a bottom-fixed shell and make the transcript viewport reserve its space.
- [ ] Preserve PageUp/PageDown/Home/End, mouse wheel, live follow mode, new-output accounting, input editing, and terminal row handling.
- [x] Add focused component/contract tests and run CLI typecheck/build/tests plus repository checks relevant to the touched surface.
- [x] Review the diff and commit only this feature's intended files, leaving prior uncommitted validation work untouched.

## Non-goals

- No remote GitHub mutation, arbitrary command execution, or new file-write/staging API.
- No unbounded transcript rendering or raw prompt/path leakage in metadata.
- No replacement of Ink's input handling or viewport model with a second scrolling implementation.

## Acceptance evidence

- When the transcript is longer than the terminal viewport, browsing upward renders the active task title in a stable top header.
- While browsing, a clear `Back to bottom` action/hint stays immediately above the composer; composer, status, and footer remain rendered after the bounded transcript viewport.
- Returning to the bottom clears the browsing state and resumes live output follow mode.
- Focused tests prove header truncation/bounds, bottom navigation state, and existing viewport semantics.
