# Desktop and CLI Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

## Goal

Implement the approved Desktop and CLI visual redesign in the existing TypeScript/vanilla architecture while preserving all current workflows and machine-readable interfaces.

## Architecture

- Desktop remains the current local Node HTTP/SSE server serving `apps/desktop/public/index.html`.
- Desktop UI uses semantic HTML, CSS custom properties, CSS grid/flex, and the existing inline client behavior.
- CLI keeps the current rich TTY gate and renderer pipeline.
- No framework migration, native shell, or API redesign is introduced.

## Tech Stack

- TypeScript
- Node.js
- Existing Desktop HTTP/SSE server
- Existing vanilla browser client
- ANSI terminal renderer
- Existing pnpm test/build scripts
- Browser and terminal verification using the repository's available tooling

## Spec

Implement all requirements in:

`docs/superpowers/specs/2026-09-19-desktop-cli-workbench-design.md`

## Global Constraints

- Preserve unrelated user changes.
- Use existing IDs and API contracts whenever possible.
- Keep `NO_COLOR`, JSON, pipe, `--once`, and MCP modes clean.
- Keep output bounded by viewport or terminal width.
- Use ASCII-safe source assets and terminal art.
- Use `apply_patch` for manual source edits.
- Run focused tests after each surface, then the complete relevant test suites.
- Do not claim completion until browser and terminal verification has been performed.

## Tasks

### 1. Establish a baseline

1. Record current Desktop and CLI test results.
2. Inspect the current HTML IDs used by tests and client behavior.
3. Confirm the existing Desktop server URL and health endpoint.
4. Keep the baseline output available for comparison.

**Verification:** baseline commands complete or any pre-existing failures are recorded with their exact scope.

### 2. Build the Desktop visual foundation

1. Replace the current light-first CSS tokens with the approved workbench token system.
2. Add the signal-weave brand mark using terminal-safe/code-native geometry.
3. Restructure the top-level markup into top bar, session rail, conversation stage, and inspector while preserving current functional IDs.
4. Add responsive grid rules for desktop, medium, and narrow widths.
5. Add visible focus, hover, disabled, streaming, approval, validation, and error states.

**Verification:** the page loads without console errors, all existing required IDs are present, and the current server tests still pass.

### 3. Wire the Desktop workbench behavior

1. Keep session selection and creation controls in the left rail.
2. Render status and usage values into the inspector without changing server contracts.
3. Keep evidence controls in a compact inspector/utility area and preserve preview behavior.
4. Style the existing message renderer as a timeline with distinct user, assistant, tool, approval, validation, and error entries.
5. Keep the composer anchored to the conversation stage, preserving send and stop behavior.
6. Add any minimal client-side state updates needed for selected session, run state, and inspector collapse.

**Verification:** exercise create/select/rename/delete, send/stream/stop, approval, evidence, validation, export, undo, and rerun flows against the local server.

### 4. Improve Desktop verification coverage

1. Add narrow assertions for the new shell landmarks and brand mark.
2. Keep existing contract assertions for evidence, rename, and API behavior.
3. Run browser checks at representative desktop and mobile viewport sizes.
4. Inspect screenshots for overflow, clipped text, unreadable contrast, and broken controls.

**Verification:** focused Desktop tests and browser checks pass; screenshots show the intended hierarchy at all target widths.

### 5. Establish the CLI semantic theme

1. Extend `apps/cli/src/colors.ts` with semantic roles needed by the renderer.
2. Keep `NO_COLOR` behavior centralized and deterministic.
3. Add a compact signal-weave launch mark and status rail helpers.
4. Keep all decoration within the requested terminal width.

**Verification:** color helpers compile, no-color output contains no ANSI escapes, and narrow-width renderer tests remain stable.

### 6. Rework CLI rich transcript blocks

1. Update the welcome panel to use the new launch mark and context hierarchy.
2. Add distinct compact formatting for tool, approval, validation, diff, and error blocks where renderer inputs already expose those states.
3. Preserve existing assistant Markdown handling, code fences, secret redaction, control-character sanitization, and command hints.
4. Keep the rich prompt prefix and interactive gating unchanged unless the new visual system requires a compatible symbol update.
5. Update tests that assert the old rich heading while preserving machine-output assertions that rich headings are absent.

**Verification:** CLI rich tests, renderer tests, interactive tests, machine-output tests, and type/build checks pass.

### 7. Cross-surface quality pass

1. Run the complete Desktop and CLI test suites.
2. Build both packages from a clean working tree state.
3. Verify Desktop start/health behavior and capture final screenshots.
4. Run rich CLI in a real TTY and capture representative output.
5. Check `NO_COLOR`, JSON, pipe, `--once`, and MCP server paths.
6. Review the diff for accidental API, dependency, or unrelated metadata changes.

**Verification:** all applicable gates pass, known residual risks are documented, and the local Desktop URL is ready for the user.

## Completion Checklist

- [x] Approved design spec and implementation plan are written to the working tree.
- [x] Desktop three-pane workbench is implemented and responsive.
- [x] Desktop workflows remain functional.
- [x] CLI rich mode has the new mark, semantic status rail, and transcript blocks.
- [x] Machine-readable modes remain unchanged in behavior.
- [x] Focused and complete tests pass.
- [x] Browser screenshots and terminal output have been inspected.
- [x] Final response includes the Desktop URL and a concise change summary.
