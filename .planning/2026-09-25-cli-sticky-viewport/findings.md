# Findings — CLI Sticky Viewport and Composer

## Baseline

- The interactive CLI is an Ink app in `apps/cli/src/ink/app.tsx`.
- `InkViewportModel` already owns bounded transcript navigation and tracks
  `followOutput`, `hiddenAbove`, `hiddenBelow`, and `newOutput`.
- PageUp/PageDown/Home/End and mouse wheel are already wired in `InkCliApp`.
- The current navigation hint is rendered inside `TranscriptViewport`, so it
  scrolls with the transcript instead of being a bottom-anchored affordance.
- The composer, status line, and footer are already rendered after the dynamic
  transcript block, but the transcript height calculation needs to reserve the
  navigation row when browsing.
- `Static` currently renders only the welcome panel. User task text is part of
  the dynamic transcript and is not represented by a sticky header.

## Design direction

- Keep one authoritative `InkViewportModel`; do not add a second scroll state.
- Add a pure helper to derive a bounded sticky task title from the latest user
  prompt, using display-width-aware truncation already provided by `tui-width`.
- Render the sticky header only when browsing away from live output, so live
  streaming remains compact and the header is not duplicated at the bottom.
- Render a bottom navigation bar in the shell immediately before `StatusLine`,
  reserving one row from the transcript viewport only when it is visible.
- Keep all prompt rendering text-only and bounded; no raw command or full path is
  introduced into telemetry.

## 2026-09-25 — implementation findings

- A task header is best derived from the latest non-empty `user` transcript
  entry, not from runtime status or command metadata. This keeps it stable
  while the user browses older output and updates naturally for the next task.
- `fitDisplayLine` plus `truncateToDisplayWidth` keeps the header safe for
  CJK/emoji and prevents a multi-line prompt from changing the terminal frame.
- The navigation row is always reserved in the shell but only populated while
  `followOutput` is false. This avoids a one-row layout jump when the user
  starts or ends browsing.
- `Esc` remains the existing interrupt/cancel input; the new affordance uses
  the already-supported `End` key as the safe return-to-bottom action rather
  than changing cancellation semantics.
