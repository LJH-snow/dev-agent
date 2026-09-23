# Rich TUI Viewport Navigation and Long-Session Scrollback

- **Status:** complete
- **Date:** 2026-09-21
- **Owner:** Signal Loom / Dev Agent
- **Primary surface:** `apps/cli` Rich Ink TUI
- **Related study:** `docs/geminicli/gemini-cli-coding-agent-architecture-study.md`

## Objective

Make long Rich TUI sessions genuinely browsable while preserving the current
terminal-first interaction model:

- remove the large unused vertical region when the transcript is short;
- let the user inspect older turns after the active view grows beyond the
  terminal height;
- keep the composer and session footer visible and stable at the bottom;
- keep streaming output, queued prompts, tool cards, approvals, and assistant
  answers attached to the correct turn;
- avoid reintroducing duplicate frames, duplicate footers, cursor drift, or
  terminal-clear flicker.

The runtime remains the source of truth for turns and events. Viewport state is
presentation state owned by the Rich TUI/controller boundary.

## User-visible contract

### Normal follow mode

- The view follows the newest transcript content while the user is at the
  bottom.
- A short session uses only the rows it needs; it does not stretch a transcript
  panel to fill the terminal.
- The composer, status line, and footer remain at the bottom of the usable
  terminal area.

### Manual scroll mode

- `PageUp` moves toward older transcript content by one visible page.
- `PageDown` moves toward newer transcript content by one visible page.
- `Home` jumps to the oldest available transcript content.
- `End` returns to the live bottom and re-enables follow mode.
- Arrow keys keep their existing responsibilities for draft editing, completion,
  and prompt history; they must not silently change scroll position.
- When the user is away from the bottom, new streamed content must not yank the
  viewport back to the newest turn. The UI shows a bounded “new output below”
  indication and `End` returns to live output.
- Submitting a new prompt explicitly returns the view to the bottom so the new
  turn and its response are visible.

Ink mouse-wheel support is enabled when raw terminal input is available. The
renderer enables SGR/X10 wheel tracking only for the Rich TUI session and
disables it on unmount; keyboard navigation remains the portable fallback.

## Scope

### In scope

- A bounded, renderer-neutral transcript viewport model.
- Visible-row calculation that accounts for terminal width, wrapping, composer
  height, footer height, status lines, tool cards, approvals, and resize.
- Keyboard navigation and bottom/follow-output state.
- A compact scroll affordance with the number or direction of hidden content.
- Streaming behavior while manually scrolled.
- Queue ordering and prompt/answer association regression coverage.
- PTY coverage at short, tall, narrow, and resized terminal dimensions.
- Updates to Rich TUI help/hints and the relevant CLI documentation.

### Out of scope

- Replacing the AgentLoop event model.
- Changing provider streaming, queue scheduling, or approval policy.
- Reworking the ANSI renderer unless a shared input contract must be clarified.
- Persistent cross-process scroll position.
- A new session database or transcript storage format.
- npm publishing, package release, or network deployment.
- Broad visual redesign of the Signal Loom logo or color palette.

## Current evidence

- `apps/cli/src/ink/app.tsx` uses `Static` for committed transcript and a
  dynamic frame for active content, but has no scroll offset, viewport anchor,
  or follow-output state.
- `apps/cli/src/ink/runtime-store.ts` exposes transcript, queue, cards,
  history, retry, and committed content, but no viewport state.
- `apps/cli/src/ink-ui.ts` coordinates prompt submission and approvals, but
  does not own navigation state.
- `apps/cli/src/tui-session.ts` contains renderer-neutral transcript/session
  state without a viewport contract.
- Existing tests cover compact/tall layout, committed scrollback, no-clear
  startup, and duplicate-frame prevention. They do not prove user-initiated
  upward navigation or returning to the live bottom.
- The worktree contains broad uncommitted changes from prior phases. This
  phase must remain additive and must not reset, clean, or overwrite unrelated
  work.

## Implementation plan

### Task 1: Lock the viewport contract

- Add a focused design note or module-level contract describing:
  - transcript source rows versus rendered wrapped rows;
  - oldest/newest bounds;
  - `followOutput` versus manual scroll mode;
  - how append, resize, prompt submission, and terminal completion affect the
    offset;
  - how hidden content and “new output below” are reported.
- Decide whether the model belongs in `apps/cli/src/ink/` or in the existing
  renderer-neutral TUI session layer. Keep AgentLoop unaware of it.
- Define stable behavior for empty transcripts and sessions shorter than the
  usable viewport.

### Task 2: Implement bounded viewport calculations

- Add a small pure viewport controller/model with:
  - current offset or anchor;
  - visible row count;
  - total wrapped row count;
  - clamping after append and resize;
  - page, home, and end movements;
  - follow-output and pending-new-output indicators.
- Reuse the repository's display-width and terminal-size helpers instead of
  measuring strings with raw JavaScript length.
- Keep transcript content bounded for rendering without truncating the
  underlying session memory.
- Ensure a narrow terminal cannot create horizontal overflow or a tall terminal
  cannot create an artificial blank block.

### Task 3: Integrate navigation into the Rich Ink app

- Add PageUp/PageDown/Home/End handling to `apps/cli/src/ink/app.tsx` with
  explicit precedence rules so completion, draft editing, history, approval,
  and command-palette interactions remain unchanged.
- Render the visible transcript slice in a bounded region while keeping the
  composer and footer outside that scroll region.
- Preserve the existing `Static` scrollback behavior for normal follow mode
  where it prevents repainting committed turns, but route manual navigation
  through the new bounded viewport so older turns can be inspected.
- Add a visible, compact navigation affordance that does not duplicate the
  footer or shift the composer unexpectedly.
- When a new prompt is submitted, reset to the bottom before the run begins.
- When a run streams while the user is scrolled up, preserve the selected
  location and expose the new-output indicator rather than moving the cursor
  into a non-input region.
- Recheck Ctrl-C, Escape, EOF, approvals, tool cards, command palette, and
  `Ctrl-L` semantics after adding the key handling.

### Task 4: Add focused unit and integration coverage

- Add pure viewport tests for:
  - short content;
  - exact-fit and over-capacity content;
  - line wrapping at narrow widths;
  - PageUp/PageDown/Home/End;
  - append while following;
  - append while manually scrolled;
  - resize and offset clamping;
  - prompt submission returning to the bottom.
- Extend `apps/cli/tests/ink-app.test.ts` for:
  - visible older content after PageUp;
  - returning to the newest turn after End;
  - fixed composer/footer placement;
  - no duplicate transcript, footer, or cursor;
  - no tall-terminal blank expansion;
  - no interaction regression with queued prompts.
- Extend terminal-size or PTY coverage for narrow and resized sessions.
- Add a Rich CLI evaluation case that creates enough turns to overflow the
  viewport, navigates upward, streams a new answer, and returns to the bottom.
- Assert that the second queued prompt remains pending until the first run has
  completed, and that each assistant answer remains associated with its own
  prompt while the viewport moves.

### Task 5: Documentation and verification

- Update Rich TUI command/key hints and the CLI README with the portable
  navigation controls.
- Update the relevant architecture or UI plan notes if the final placement of
  viewport state differs from this plan.
- Run focused CLI tests first, then the Rich CLI PTY evaluations.
- Run the complete repository verification gates only after focused tests pass.
- Record exact test counts, failures, fixes, and remaining limitations in
  `progress.md`.

## Acceptance criteria

- A long session can be navigated upward with `PageUp` and downward with
  `PageDown`; `Home` and `End` reach deterministic bounds.
- The active composer keeps keyboard focus and the visible cursor inside its
  frame after every navigation and resize.
- New output arriving while scrolled up does not jump the viewport or place the
  cursor in the transcript.
- Submitting a prompt returns to the bottom and preserves queue ordering.
- No assistant answer appears in another prompt's display region.
- No duplicate static transcript, dynamic transcript, footer, input frame, or
  streamed answer is emitted.
- Short sessions no longer reserve a large blank vertical region.
- Narrow terminals wrap safely; resized terminals clamp the viewport without
  crashes or stale blank rows.
- Ctrl-C, Escape, EOF, approvals, tool cards, command completion, prompt
  history, and existing clear behavior remain covered and passing.
- Focused tests, Rich PTY evaluations, `pnpm verify:typescript`, and
  `git diff --check` pass.
- No package publish, tag, release, or network operation is performed.

## Verification checklist

- [x] Read the current Rich Ink input and rendering contracts before editing.
- [x] Add and pass pure viewport-controller tests.
- [x] Add and pass Ink integration tests for the viewport model and
      Home/End navigation.
- [x] Add and pass Ink integration coverage for PageUp and streaming while
      manually scrolled.
- [x] Add and pass the long-session PTY navigation evaluation.
- [x] Add and pass a resize-focused PTY assertion for the bounded viewport.
- [x] Re-run queue, Ctrl-C, Escape, approval, tool-card, and EOF coverage.
- [x] Run the full CLI suite and the repository TypeScript verification gate.
- [x] Run `git diff --check`.
- [x] Update `task_plan.md`, `progress.md`, and this plan with final results.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Ink `Static` and an explicit viewport both emit the same transcript | Make one path authoritative per mode and add output-duplication assertions. |
| Page keys interfere with prompt editing or completion | Handle only unambiguous page/home/end keys; preserve arrow-key precedence and test each mode. |
| Streaming changes the visible row count while scrolled | Keep an anchor/offset model with deterministic clamping and a new-output indicator. |
| Tall terminals reintroduce blank expansion | Calculate the transcript region from actual content and fixed bottom controls. |
| Terminal resize leaves stale offset or cursor placement | Recompute wrapped rows and clamp on every width/row change. |
| Existing concurrent changes conflict with the new controller | Touch only the Rich TUI/controller/tests/docs needed for this phase and review the diff before each verification gate. |

## Completion log

This document is the implementation contract for Phase 24. It was created
before implementation; no code changes are part of this planning step.

### Implementation closure: 2026-09-22

- Added the renderer-neutral viewport model and bounded wrapped-row Ink
  transcript rendering.
- Added PageUp/PageDown/Home/End navigation, follow-output behavior, resize
  clamping, hidden-row indicators, and the “new output below” state.
- Kept the composer, cursor, status, and footer outside the transcript viewport.
- Added a one-row virtual Ink render-height guard so a full dynamic frame does
  not trigger Ink's terminal-wide clear and replay the welcome panel.
- Added unit, Ink integration, terminal-size, and PTY coverage for queue order,
  long-session navigation, streaming while scrolled, narrow/resized terminals,
  Ctrl-C, approval, EOF, and tool-card flows.
- Focused Ink and PTY checks pass. The full CLI suite ran **536/536** after a
  repeat isolated run resolved the timing-sensitive index-refresh SIGINT
  assertion; the Desktop suite ran **150/150**.
- The repository TypeScript verification gate and `git diff --check` pass.
- No package publish, tag, release, or network package operation was performed.

### Follow-up hardening: 2026-09-22

- Reproduced the sparse-active-turn blank region after a long history and
  removed the second transcript source: the welcome panel remains static, but
  all conversation turns now flow through one bounded dynamic viewport.
- Added SGR and legacy X10 mouse-wheel parsing, raw-terminal tracking lifecycle,
  and a visible startup hint for mouse-wheel/PageUp/PageDown navigation.
- Added regression coverage for a sparse active turn after eight completed
  turns, exact single-frame prompt rendering, and mouse-wheel navigation.
- Focused Ink coverage passes **41/41**; the full CLI suite passes **543/543**;
  Rich TUI evaluations pass **8/8**.
- No npm package was published and no release or network operation was
  performed.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| New viewport contract test failed because `InkRuntimeSnapshot` has no `viewport` field | First RED run | Expected TDD failure; implement the viewport contract before rerunning. |
| Full CLI test command reported an unrelated `--resume` ambiguity failure | First RED run | Recorded as pre-existing/concurrent work; keep Phase 24 changes isolated and verify focused tests separately. |
| Full CLI test command reported an unrelated session preview Unicode-length failure | First RED run | Recorded as pre-existing/concurrent work; do not change it in the viewport phase. |
| The package test script ignored the attempted name filter because the argument was appended after the test glob | First RED run | Use the package compiler followed by a direct `node --test tests-dist/<focused-file>.test.js` invocation. |
| Ink compile rejected the old `Static` transcript branch after static items were narrowed to welcome-only | First integration compile | Replace the callback with welcome-only rendering. |
| Ink `Text` does not accept `paddingX` for the viewport hint | First integration compile | Wrap the hint in a `Box` with padding instead. |
| Existing transcript scrollback test expected completed answers to be absent from dynamic frames | First Ink integration run | Replace the obsolete expectation with a single-render/no-duplication contract and add explicit Home/PageUp/End navigation coverage. |
| The failing test did not unmount its Ink instance after an assertion failure | First Ink integration run | Wrap the fixture lifecycle in `try/finally` so failed assertions cannot leave the test process alive. |
| Navigation test read only the final ANSI chunk instead of the complete redraw | First navigation test run | Join all writes produced after the keypress before asserting visible transcript content. |
| End navigation assertion included the earlier Home redraw in its accumulated write buffer | Second navigation test run | Record the write count before End and assert only the subsequent redraw. |
| Full Rich PTY evaluation detected one startup clear sequence in the existing queue case | First full-eval run | Investigate zero-dimension startup and dynamic viewport mount before changing the no-clear regression. |
| A full dynamic Ink frame still triggered `clearTerminal` after enabling incremental rendering | PTY/raw-output trace | Keep the application on real terminal rows while giving Ink a one-row virtual fullscreen guard; add direct terminal-size and Ink regression coverage. |
| Full CLI suite retained one unrelated index-refresh SIGINT signal mismatch | Final CLI suite | Record the exact failure; do not change index-refresh behavior in the Rich TUI phase. |
