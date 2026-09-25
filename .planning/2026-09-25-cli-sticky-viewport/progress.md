# Progress — CLI Sticky Viewport and Composer

## 2026-09-25 — tranche started

- Inspected the existing Ink app, viewport model, mouse input, and tests.
- Confirmed the project already has the core scroll model; the missing behavior
  is layout anchoring: task title and navigation feedback need dedicated shell
  rows rather than living inside the transcript body.
- Preserved the existing uncommitted Desktop Validation Center changes.

## 2026-09-25 — implementation and focused verification

- Added a latest-user-prompt sticky header to the Ink dynamic shell. It is
  normalized, control-character stripped, display-width bounded, and rendered
  as a one-line full-width task bar.
- Moved browsing feedback out of the transcript viewport into a dedicated
  bottom navigation slot immediately above the status line, composer, and
  footer. The slot is reserved so entering history does not push controls.
- Preserved the existing viewport model and Home/End/PageUp/PageDown/mouse
  navigation; the bottom affordance points to the existing End/latest action.
- Added helper and navigation assertions in `apps/cli/tests/ink-app.test.ts`.
- CLI build, TypeScript test compilation, and the complete CLI suite passed:
  **633/633** tests.
- Documented the new sticky task header and bottom return affordance in
  `apps/cli/README.md`.

## Acceptance status before delivery

- [x] Sticky task header is bounded, one line, and follows the latest user task.
- [x] Bottom navigation is shell-anchored above status/composer/footer.
- [x] Existing viewport keyboard/mouse semantics remain intact.
- [x] Focused Ink app + viewport tests pass (**45/45**).
- [x] CLI build and test compilation pass; prior full CLI run passed **633/633**.
- [x] `git diff --check` passes.
