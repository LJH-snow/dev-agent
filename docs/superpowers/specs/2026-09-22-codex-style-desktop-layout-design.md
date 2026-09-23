# Codex-Style Desktop Layout Design

## Goal

Reframe the existing Desktop web workbench around the Codex-like layout shown in
the supplied reference: a workspace rail on the left, a focused conversation
surface in the center, a compact project/session header, and a fixed composer
at the bottom.

## Scope

This change is limited to the browser UI served by `apps/desktop`. The native
Swift window remains a host for the same page. The existing SSE protocol,
session APIs, queue persistence, approval flow, run replay, and runtime
inspector data remain unchanged.

## Layout

- Keep the existing `app-shell`, `workbench`, `session-rail`,
  `conversation-workspace`, `composer`, and `runtime-inspector` ownership
  boundaries so current event handlers and tests remain valid.
- Turn the left rail into a Codex-like workspace navigation surface:
  Signal Loom identity, new-session action, search/filter controls, the active
  session summary, session actions, and a quiet footer.
- Make the main header the project/session context bar. It should show the
  active workspace and expose the inspector toggle without competing with the
  conversation.
- Use an open conversation canvas for normal user and assistant messages.
  Keep bordered surfaces for tool activity, approvals, validation, and errors
  because those states need clear affordances.
- Keep the composer fixed to the bottom of the center column, constrained to a
  readable width, with a blue focus border and a metadata footer for the active
  workspace/session and model state.
- Keep the runtime inspector closed by default on desktop and open it as a
  right-side drawer when requested. On narrow screens it becomes a normal
  stacked section.

## Visual System

- Use the existing Signal Loom tokens and keep the dark reference state as the
  primary visual target while preserving the light-theme toggle.
- Use neutral charcoal surfaces, quiet 1px separators, restrained radii, and
  blue focus/active states. Avoid decorative gradients and nested card stacks.
- Use the existing SVG mark and system font stack. No new runtime dependency or
  image asset is required.
- Preserve readable minimum control sizes and visible focus rings.

## Responsive Behavior

- At desktop widths, reserve a 280-320px left rail and let the center column
  consume remaining space.
- At medium widths, collapse the inspector into a drawer and keep the rail
  usable.
- At narrow widths, convert the rail into a compact top section, keep the
  composer full width, and prevent horizontal overflow.

## Functional Invariants

- Existing element IDs used by the inline controller remain present.
- Session search, status filtering, rename/delete/export/evidence actions,
  queue controls, approval buttons, stop, retry, session switching, and
  inspector toggling continue to target the same nodes.
- The page remains bilingual and accessible.
- No raw tool input/output, secrets, absolute paths, or provider data is added
  to the visual shell.

## Verification

- Add served-HTML and stylesheet contract coverage for the new shell regions.
- Run the focused Desktop UI tests and the full Desktop suite.
- Verify the live page at 1440x900 and a 390x844 viewport with Playwright.
- Check the first viewport, scrolling, composer focus, session switching,
  inspector open/close, and browser console output.
