# Desktop and CLI Workbench Design

**Date:** 2026-09-19
**Status:** Approved for implementation
**Decision:** Proceed with approach A: preserve the existing TypeScript/vanilla stack and API contracts, then rebuild the visible workbench surfaces around them.

## Goal

Make the local Desktop app feel like a serious coding workbench with the information hierarchy and workflow density of Codex Desktop, while giving the npm CLI a polished terminal experience with its own recognizable visual language inspired by modern agent CLIs.

The result must remain usable on the current repository without introducing a framework migration, a native application packaging project, or a breaking API redesign.

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

1. A distinct launch mark built from simple terminal-safe geometry.
2. A status rail showing provider, model, workspace, session, turn, and usage where available.
3. Visually distinct transcript blocks for:
   - User prompts.
   - Assistant responses.
   - Tool execution.
   - Approval requests.
   - Validation results.
   - Diffs and code blocks.
   - Errors and blocked states.
4. Consistent spacing and color hierarchy for long-running sessions.
5. The existing command hints and prompt affordance.

The brand motif is a "signal weave": a small angular mark and a repeated line/connector vocabulary that suggests an agent coordinating work across tools. It must be recognizable without relying on color alone.

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

Extend `apps/cli/src/colors.ts` with semantic color helpers and update `apps/cli/src/tui-renderer.ts` for the new blocks and mark. Keep renderer output deterministic and bounded by terminal width. Use the existing `tui-mode.ts` gating so rich output is only emitted for interactive TTY sessions.

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

## Risks and Mitigations

- **Risk:** Reworking a single-file Desktop page breaks hidden DOM assumptions.
  **Mitigation:** Preserve IDs and endpoint calls, change structure incrementally, and run the existing server tests after each major shell change.
- **Risk:** Rich CLI output becomes too decorative for long sessions.
  **Mitigation:** Keep blocks compact, cap repeated decoration, and test narrow widths and large responses.
- **Risk:** Dark palette reduces contrast.
  **Mitigation:** Use semantic token pairs and inspect screenshots rather than relying on color intuition.
- **Risk:** Scope expands into native packaging.
  **Mitigation:** Treat native `.app` packaging as a follow-up; this pass delivers a reliable local web Desktop surface.
