# Desktop and CLI Workbench Design

**Date:** 2026-09-19
**Status:** Approved for implementation; scope expanded with Signal Loom terminal UX
**Decision:** Proceed with approach A: preserve the existing TypeScript/vanilla stack and API contracts, then rebuild the visible workbench surfaces around them.

## Goal

Make the local Desktop app feel like a serious coding workbench with the information hierarchy and workflow density of Codex Desktop, while giving the npm CLI a polished terminal experience with its own recognizable visual language inspired by modern agent CLIs.

The result must remain usable on the current repository without introducing a framework migration, a native application packaging project, or a breaking API redesign.

The approved follow-up scope adds a project-specific "Signal Loom" logo and a
more complete rich TTY experience: a welcome screen, explicit run states,
command completion, a Gemini-like bordered input editor, and live tool cards.
The interaction model may be inspired by the reference screenshot, but the
brand, wording, iconography, and implementation remain original to dev-agent.

## Non-goals

- Do not copy Codex or Gemini logos, artwork, proprietary text, or exact visual assets.
- Do not migrate the Desktop app to React, Vite, Electron, Tauri, or another new runtime in this pass.
- Do not change the server API shape unless an existing UI workflow cannot be represented otherwise.
- Do not remove machine-readable CLI modes, pipe mode, `--once`, JSON output, MCP server mode, `NO_COLOR`, or narrow-terminal support.
- Do not add decorative imagery that competes with conversation, approvals, validation, or runtime state.

## Product Surfaces

### Desktop workbench

The Desktop page remains served by the current local Node server at `http://127.0.0.1:4317`.

The visible shell becomes:

1. A compact top bar containing the brand mark, workspace/session context, executor state, and utility actions.
2. A left navigation rail containing:
   - New session action.
   - Session list and selected-session state.
   - Session rename/delete controls.
   - A small workspace summary.
3. A central conversation stage containing:
   - Timeline-style user, assistant, tool, approval, validation, and error entries.
   - Existing streaming behavior.
   - Evidence preview and downloadable evidence.
   - A fixed composer area with multiline input, send, stop, and keyboard-friendly focus behavior.
4. A right inspector containing:
   - Runtime status.
   - Provider/model/executor.
   - Token and cost usage.
   - Validation results.
   - A collapsible layout on narrower screens.

The three-pane shell must degrade gracefully:

- At desktop widths, all three panes are visible.
- At medium widths, the inspector collapses behind a button while the session rail remains visible.
- At narrow widths, the session rail and inspector become drawers or stacked sections, and the conversation remains the primary surface.

### CLI workbench

The rich TTY renderer becomes a branded terminal workbench with:

1. A distinct Signal Loom launch mark built from simple terminal-safe geometry.
2. A welcome surface with the logo, short tips, current project, provider/model,
   executor/sandbox, MCP summary, and an explicit `READY` prompt state.
3. A status rail showing provider, model, workspace, session, turn, and usage where available.
4. Visually distinct transcript blocks for:
   - User prompts.
   - Assistant responses.
   - Tool execution.
   - Approval requests.
   - Validation results.
   - Diffs and code blocks.
   - Errors and blocked states.
5. Consistent spacing and color hierarchy for long-running sessions.
6. A bordered, multi-line input editor that is visually close to the reference
   interaction while remaining terminal-grid based.
7. A command palette triggered by either `/` or `:` with filtering, keyboard
   navigation, completion, and escape-to-dismiss behavior.

### Signal Loom brand

The logo is an original project mark, not a Gemini or Codex imitation:

- The primary mark is a compact angular weave with a central `<>` connector.
- Two crossing signal paths represent the model/tool/workspace loop.
- The mark must work in three forms:
  - ANSI/Unicode monochrome mark for narrow terminals;
  - colored ANSI mark for rich TTY;
  - SVG mark for Desktop, README, and favicon use.
- At small sizes it must remain recognizable without relying on color.
- The wordmark uses `DEV AGENT` or `dev-agent` consistently; `SIGNAL WEAVE`
  remains the product's interaction motif, not a competing product name.

### Rich TTY state model

The current `streaming` option describes transport capability and must not be
used as the initial run status. Rich TTY state is modeled separately:

| State | Meaning | Visual treatment |
| --- | --- | --- |
| `ready` | Waiting for user input | neutral status, active input border |
| `thinking` | Model turn started, no token yet | amber/dim spinner |
| `streaming` | Assistant tokens are arriving | teal live marker |
| `tool-running` | A tool is executing | blue/teal spinner and tool card |
| `waiting-approval` | User decision is required | amber card with explicit actions |
| `validating` | Trusted checks are running | cyan progress card |
| `done` | Turn completed | green completion marker, then ready |
| `error` | Turn failed | red error block with recovery hint |
| `interrupted` | User cancelled the turn | dim cancellation marker, then ready |

Only the active request may use `thinking`, `streaming`, `tool-running`,
`waiting-approval`, or `validating`. The launch screen must always begin in
`ready`, even when streaming transport is enabled.

### Command palette and input editor

The rich TTY path gets a dedicated terminal controller; `readline/promises`
remains the fallback for non-rich and piped modes.

The editor must support:

- single-line and multi-line editing;
- history navigation with Up/Down;
- cursor movement and deletion without corrupting the prompt;
- `/` and `:` command palette activation;
- Tab completion for commands;
- `@path` completion as a later extension point, with safe fallback when no
  filesystem completion is available;
- Enter to submit and Shift+Enter to insert a newline;
- Escape to close the palette;
- Ctrl+L to clear and redraw the rich surface;
- terminal resize redraws without duplicated input or stale cursor positions.

The palette uses the existing command registry as its source of truth, so
aliases can be added without duplicating command dispatch logic.

### Live tool cards

Tool activity is represented by a stable card identity rather than separate
unrelated lines:

- `running`: spinner, tool name, elapsed time, bounded input preview;
- `completed`: success marker, bounded output preview, elapsed time;
- `failed`: error marker, sanitized reason, recovery hint;
- `cancelled`: cancellation marker and final state;
- `approval`: diff summary, allow/deny/always-allow actions where supported;
- `validation`: check count, pass/fail/blocked state, and rerun affordance.

Cards may collapse long input/output and diffs. Rendering must remain bounded
by terminal width and must preserve existing secret redaction and terminal
control-sequence sanitization.

### Pixel-fidelity boundary

Terminal output is measured in character cells rather than browser pixels.
Pixel-level fidelity is therefore defined against a canonical profile:

- macOS Terminal or iTerm2;
- 120 columns by 36 rows;
- monospace font with standard Unicode box-drawing support;
- ANSI color enabled;
- a fixed screenshot/PTY capture fixture for comparison.

The implementation must also pass width and content checks at 80, 100, 120,
and 160 columns. CJK, combining marks, and common Emoji use display-cell
width calculation rather than JavaScript string length.

## Visual System

### Desktop tokens

Use a dark-first workbench palette with a light fallback:

- Background: charcoal/ink, not pure black.
- Surfaces: two close neutral elevations with clear borders.
- Primary accent: cyan/teal for active execution and focus.
- Secondary accent: warm amber for approvals and attention.
- Positive: green for validated/successful states.
- Negative: red for errors/blocked states.
- Text: high-contrast neutral plus a muted secondary scale.

Use CSS custom properties for all shared colors, spacing, radii, borders, and typography. Keep corner radii restrained, with a maximum of 8px for normal cards and panels.

### CLI tokens

Reuse the same semantic state mapping as Desktop but adapt it to ANSI:

- Cyan/teal: active context, links, prompt, execution.
- Amber: approval or pending action.
- Green: success and validation.
- Red: error and blocked state.
- Dim neutral: metadata and secondary hints.

The renderer must be legible in monochrome or reduced-color terminals because color is supplementary, not the only state signal.

## Interaction and Compatibility

All current Desktop controls remain functional:

- Create/select/rename/delete sessions.
- Send a prompt and receive streamed output.
- Stop an active run.
- Export/download evidence.
- Open/close evidence preview.
- View status, validation, and usage.
- Approve, deny, or always allow requested actions.
- Undo and rerun where currently supported.

Preserve existing DOM IDs and API endpoint behavior where practical so the current server and tests remain stable. If a structural change requires an ID change, update the narrowest relevant test and keep the behavioral contract unchanged.

All current CLI modes remain functional:

- Rich TTY mode.
- `--once`.
- Pipe/non-TTY mode.
- JSON/machine-readable output.
- MCP server mode.
- `NO_COLOR`.

Machine-readable output must not contain the rich launch mark, ANSI styling, or human-facing brand headings.

## Implementation Boundaries

### Desktop

Prefer a focused rewrite of `apps/desktop/public/index.html` styling and shell markup while retaining the existing inline behavior until the visual contract is stable. Keep server behavior in `apps/desktop/src/server.ts` unchanged unless verification exposes a real gap.

The new shell should be implemented with semantic class names and CSS grid/flex layout. Avoid adding a client framework or a build-time asset pipeline.

### CLI

Keep `apps/cli/src/colors.ts` as the semantic color layer and split the rich
interactive path into focused responsibilities:

- `tui-brand.ts` or equivalent: Signal Loom mark and wordmark variants;
- `tui-renderer.ts`: deterministic bounded blocks and cards;
- `tui-input.ts`: raw-mode editor, cursor movement, history, palette, and redraw;
- `tui-session.ts` or equivalent: run-state transitions and card lifecycle.

Use the existing `tui-mode.ts` gating so rich output is only emitted for
interactive TTY sessions. Do not route raw terminal controls through JSON,
pipe, `--once`, MCP server, or `NO_COLOR` paths.

## Accessibility and Resilience

- Maintain visible focus states.
- Preserve keyboard focus in the composer after sending when appropriate.
- Use buttons for actions and labels/tooltips for unfamiliar icon-only controls.
- Ensure text wraps without horizontal overflow at narrow widths.
- Ensure state is communicated by labels and symbols in addition to color.
- Keep terminal output safe from control characters and secret leakage using existing sanitization/redaction behavior.

## Verification Criteria

The work is complete when:

1. The Desktop page loads at the existing local URL and presents the new three-pane workbench at desktop width.
2. The Desktop page remains usable at medium and narrow widths.
3. A real session can be selected, renamed, created, and deleted.
4. A real prompt can be sent, streamed, stopped, and rendered in the new timeline.
5. Approval, validation, evidence, export, undo, and rerun flows remain usable.
6. The CLI rich mode presents the new mark, status rail, and transcript blocks.
7. CLI output remains readable at narrow terminal widths.
8. Non-rich and machine-readable modes remain free of rich-only headings and ANSI output.
9. Existing Desktop and CLI tests pass, with focused new assertions for the brand/workbench contract.
10. Browser screenshots and terminal snapshots have been inspected at representative sizes.
11. CLI launch begins in `READY`, not `STREAMING`, while streaming remains the transport capability.
12. `/` and `:` open the same command palette and preserve existing command behavior.
13. The input editor passes scripted key-sequence tests for submit, newline, history,
    completion, escape, clear, resize, and Ctrl-C.
14. Tool cards update in place through running, completed, failed, cancelled,
    approval, and validation states without duplicated prompts.
15. A canonical 120-column terminal capture matches the approved layout and
    representative 80/100/160-column captures remain bounded.
16. Signal Loom has ANSI, SVG, and monochrome variants with consistent geometry.

## Risks and Mitigations

- **Risk:** Reworking a single-file Desktop page breaks hidden DOM assumptions.
  **Mitigation:** Preserve IDs and endpoint calls, change structure incrementally, and run the existing server tests after each major shell change.
- **Risk:** Rich CLI output becomes too decorative for long sessions.
  **Mitigation:** Keep blocks compact, cap repeated decoration, and test narrow widths and large responses.
- **Risk:** A raw-mode editor can break terminal input, Ctrl-C, or approval prompts.
  **Mitigation:** Keep it isolated to rich TTY, retain the readline fallback,
  use scripted PTY tests, and restore terminal mode in every exit path.
- **Risk:** Unicode width differences cause apparent pixel drift or clipped input.
  **Mitigation:** Centralize display-cell width calculation and test CJK,
  combining marks, Emoji, narrow widths, and resize redraws.
- **Risk:** Live cards duplicate output when a stream finishes or is cancelled.
  **Mitigation:** Give each card a stable id and test event sequences for
  normal completion, cancellation, approval denial, and late tool results.
- **Risk:** Dark palette reduces contrast.
  **Mitigation:** Use semantic token pairs and inspect screenshots rather than relying on color intuition.
- **Risk:** Scope expands into native packaging.
  **Mitigation:** Treat native `.app` packaging as a follow-up; this pass delivers a reliable local web Desktop surface.
