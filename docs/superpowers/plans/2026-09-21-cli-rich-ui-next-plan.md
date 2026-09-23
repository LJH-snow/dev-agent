# CLI Rich UI Next Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add streaming Markdown, file diff previews, command palette animation, runtime themes, and session history/search to the Ink CLI.

**Architecture:** Keep `InkRuntimeStore` and `InkUiController` as the shared runtime/UI boundaries. Add focused presentation modules for Markdown, diff, commands, themes, and history; the Ink app composes them while ANSI and machine modes stay unchanged. Runtime review events carry a bounded unified diff into `ToolCard.diff`.

**Tech Stack:** TypeScript, React 19, Ink 6, Node.js 20+, existing runtime events, existing `AgentMemory`, and the Node test runner.

**Spec:** `/Users/Admin/Desktop/dev-agent/docs/superpowers/specs/2026-09-21-cli-rich-ui-next-design.md`

## Global Constraints

- No browser, DOM, WebGL, or new Markdown dependency in the CLI package.
- Preserve line-oriented ANSI, JSON, `--once`, pipe, and MCP-server modes.
- Sanitize and bound model, diff, history, and search text before rendering.
- Do not merge provider reasoning into the assistant Markdown view.
- Keep timers local to visual components and clean them up when hidden or inactive.

---

### Task 1: Streaming Markdown projection

**Files:**
- Create: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/markdown.tsx`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/app.tsx`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/markdown.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/ink-app.test.ts`

- [x] Write parser and render tests for headings, lists, inline code, fenced code, and partial fences.
- [x] Run the focused Markdown tests and observe the expected missing-module failure.
- [x] Implement bounded block parsing and Ink rendering without a third-party dependency.
- [x] Replace raw assistant `<Text>` rendering with the Markdown component.
- [x] Run Markdown and Ink integration tests.

### Task 2: File diff preview

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/tui-session.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/approval-card.tsx`
- Create: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/diff-preview.tsx`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/diff-preview.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/tui-session.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/ink-app.test.ts`

- [x] Write failing tests for review-event projection and colored/truncated diff output.
- [x] Run the tests and confirm the review diff is not currently carried to the card.
- [x] Emit the prepared review on the approval runtime event and normalize it into a bounded unified diff.
- [x] Render the diff summary and lines inside the approval card.
- [x] Verify resolved approvals keep a static preview and stop animating.

### Task 3: Animated command palette

**Files:**
- Create: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/command-palette.tsx`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/app.tsx`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/command-palette.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/ink-app.test.ts`

- [x] Write failing tests for the Tab target, six-item cap, and pulse frame.
- [x] Run the tests to confirm the new component is absent.
- [x] Implement the animated header and replace the static command panel.
- [x] Verify the timer is cleaned up when the query no longer matches commands.

### Task 4: Theme system

**Files:**
- Create: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/theme.tsx`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink-ui.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/app.tsx`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/tui-renderer.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/ink-theme.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/ink-ui.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/ink-app.test.ts`

- [x] Write failing tests for built-in theme lookup, controller switching, and themed output.
- [x] Run the tests to confirm no theme state or provider exists.
- [x] Implement semantic tokens, context, `:theme [name]`, and command hints.
- [x] Apply tokens to the active Ink surface and verify the default remains Signal.

### Task 5: Session history and search

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/session-history.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Create: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/history-panel.tsx`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/runtime-store.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/ink/app.tsx`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/session-history.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/history-panel.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/ink-app.test.ts`

- [x] Write failing tests for `:search`, bounded matching, and history-panel rows.
- [x] Run the tests and confirm the search command and panel are absent.
- [x] Implement the search formatter and Ink history view state.
- [x] Wire `:history` and `:search` through both interactive paths.
- [x] Verify redaction, empty results, and bounded display.

### Task 6: Integrated verification

**Files:**
- Modify: `/Users/Admin/Desktop/dev-agent/docs/superpowers/plans/2026-09-21-cli-rich-ui-next-plan.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/superpowers/specs/2026-09-21-cli-rich-ui-next-design.md`

- [x] Run CLI build and typecheck.
- [x] Run the focused Ink/runtime test selection.
- [x] Run the existing non-Ink session/history/runtime tests.
- [x] Run `git diff --check`.
- [x] Record exact results and any pre-existing full-suite failures.

Verification record:

- `pnpm --filter @agent_cli/cli test` — 491 tests passed.
- Focused Ink/runtime selection — 92 tests passed.
- `pnpm --filter @dev-agent/agent-core build` plus approval/runtime tests — 53 tests passed.
- `git diff --check` — clean.
