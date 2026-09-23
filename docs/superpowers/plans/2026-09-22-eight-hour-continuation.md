# Eight-Hour Continuation: Rich TUI Evaluation Closure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 8 小时开发窗口内收敛 Rich Ink TUI 的已知 PTY 清屏回归，完成 Phase 24 的证据闭环，并留下可继续执行的 Desktop 项目级下一步。

**Status:** complete

**Architecture:** 先保持 AgentLoop、runtime events、provider、队列和审批边界不变，只在 Ink 的终端尺寸归一化、渲染启动和 PTY 测试边界中定位根因。修复必须由最小回归测试驱动；只有 Rich TUI 全量评估稳定后，才评估 Desktop 的下一项增量，避免在未闭环的终端契约上继续堆叠功能。

**Tech Stack:** TypeScript, React 19, Ink 6, Node.js test runner, `expect` PTY evaluations, pnpm workspace.

**Spec:** `docs/superpowers/plans/2026-09-21-rich-tui-viewport-navigation.md`

## Global Constraints

- 不修改 AgentLoop、provider、队列调度或审批策略来绕过终端表现问题。
- 不弱化 `evals/cli-rich-tui.evals.mjs` 的 no-clear 断言。
- 不使用固定 sleep 替代可观察状态；等待必须依赖 PTY 输出或进程状态。
- 不重置、清理或覆盖工作树中其他阶段的未提交修改。
- 不发布 npm 包，不创建 tag，不推送 release。
- 每个修复必须有对应的单元、Ink 集成或 PTY 回归证据。

---

## Task 1: Reproduce and isolate the startup clear regression

**Files:**
- Read: `evals/cli-rich-tui.evals.mjs`
- Read: `evals/helpers/pty.mjs`
- Read: `apps/cli/src/ink/app.tsx`
- Read: `apps/cli/src/ink/terminal-size.ts`
- Test: `apps/cli/tests/ink-terminal-size.test.ts`

- [x] **Step 1: Run the exact failing evaluation and capture the complete scenario output.**

Run:

```bash
pnpm test:evals
```

Record whether `Ink queue and streaming` fails, whether the result is skipped
because `expect` is unavailable, and the exact output surrounding the first
`SIGNAL LOOM` frame. The 2026-09-22 run was not skipped and passed all 8
evaluations; the prior clear-sequence failure did not reproduce.

- [x] **Step 2: Re-run only the queue evaluation without changing assertions.**

Use the existing module entry point and a temporary Node invocation that calls
the exported evaluation after confirming how the file starts. If the module is
not importable, add a diagnostic-only environment switch in the PTY harness
that prints the raw queue transcript without changing pass/fail conditions.

Observed evidence:

```text
queue evaluation: 1/1 passed on three isolated runs
live clear count before PRE_EXIT_MARKER: 0
teardown clear sequence: observed only after explicit exit/unmount
terminal fallback contract: 80 columns / 24 rows before the Ink row guard
```

- [x] **Step 3: Trace the first clear sequence to one rendering boundary.**

Compare the PTY bytes with the Ink mount options and terminal-size fallback.
The trace rejected the startup-dimension hypothesis for the current build:
the clear sequence appeared after the explicit exit/unmount boundary, not in
the live queue frame.

- [x] **Step 4: Log the finding in `findings.md` before editing production code.**

The entry is recorded in `findings.md`; it states the command, observed bytes,
fallback dimensions, and confirmed teardown boundary. No startup hypothesis
was promoted to a production defect.

## Task 2: Fix the root cause with a narrow regression

**Files:**
- Modify: `apps/cli/src/ink/terminal-size.ts` or `apps/cli/src/ink/app.tsx`
- Test: `apps/cli/tests/ink-terminal-size.test.ts`
- Test: `apps/cli/tests/ink-app.test.ts`
- Test: `evals/cli-rich-tui.evals.mjs` only if the existing helper needs a
  reusable diagnostic boundary, never to weaken assertions

- [x] **Step 1: Add the smallest failing test at the confirmed boundary.**

The test must fail before the fix and prove one of:

```ts
assert.equal(normalizeInkTerminalSize(output).rows > 0, true);
assert.equal(firstInkFrame.includes("\u001b[2J\u001b[3J\u001b[H"), false);
```

Use the existing fake terminal or PTY fixture rather than introducing a second
terminal abstraction. The resulting regression is in
`apps/cli/tests/ink-app.test.ts` and verifies zero-size normalization before
the incremental Ink renderer is mounted.

- [x] **Step 2: Implement one root-cause fix.**

The existing single ownership boundary is retained: normalize fallback
dimensions before `renderInk`, then pass the guarded output wrapper to Ink.
No second clear-screen filter was added; the new regression locks the boundary.

- [x] **Step 3: Run focused tests and the queue evaluation.**

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 \
  apps/cli/tests-dist/ink-terminal-size.test.js \
  apps/cli/tests-dist/ink-app.test.js
pnpm test:evals
```

Expected: the queue scenario passes without changing its no-clear assertion.

## Task 3: Close the remaining Phase 24 evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-09-21-rich-tui-viewport-navigation.md`
- Modify: `task_plan.md`
- Modify: `progress.md`
- Test: `evals/cli-rich-tui.evals.mjs`
- Test: `apps/cli/tests/interactive.test.ts`

- [x] **Step 1: Add and pass a resize-focused PTY assertion.**

The new `Ink viewport resize` scenario exercises a positive-size resize after
eight completed turns at both 12x52 and 30x100, and asserts that hidden rows
remain visible without a crash.

- [x] **Step 2: Re-run interaction regressions serially.**

The complete Rich TUI evaluation covers queue ordering, Ctrl-C, approval,
tool-card flow, EOF, PageUp/Home/End, and resize in **8/8** cases. The focused
Ink and CLI suites also cover Escape and prompt/editor interaction.

- [x] **Step 3: Mark only verified Phase 24 checklist items complete.**

The Phase 24 plan, `task_plan.md`, and `progress.md` contain the verified
counts and keep teardown cleanup distinct from live-frame clearing.

## Task 4: Prepare the next Desktop project slice

**Files:**
- Read: `apps/desktop/public/index.html`
- Read: `apps/desktop/public/styles.css`
- Read: `apps/desktop/src/server.ts`
- Read: `apps/desktop/src/chat-session.ts`
- Modify: `docs/superpowers/plans/2026-09-22-desktop-next-slice.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

- [x] **Step 1: Audit current Desktop behavior against the user-visible contracts.**

The current source and Desktop suite cover language switching, multiline
composer sizing, session switching, background-run recovery, status refresh,
history/export, approval/validation, and MCP capability visibility. The
remaining discoverability gap is documented in the next-slice plan.

- [x] **Step 2: Choose one bounded Desktop capability only after the audit.**

The chosen capability is a localized “new output below / jump to latest”
affordance; its files, contract, focused tests, and out-of-scope boundary are
recorded in `docs/superpowers/plans/2026-09-22-desktop-next-slice.md`.

- [x] **Step 3: Write the next executable Desktop plan and leave it ready.**

The plan is independently executable and claims no implementation until its
tests and browser checks exist.

## Task 5: Final verification and handoff

- [x] **Step 1: Run the complete gates after Tasks 1-3 are green.**

```bash
pnpm --filter @agent_cli/cli test
pnpm verify:typescript
git diff --check
```

- [x] **Step 2: Review the diff for scope contamination.**

Confirm that only the confirmed terminal boundary, its tests, evaluation
coverage, and planning records changed during this slice.

- [x] **Step 3: Record the next action in `progress.md`.**

The handoff must include completed evidence, unresolved risks, and the exact
next Desktop plan path. Do not mark this goal complete while any required gate
or Phase 24 checklist item remains unverified.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Rich PTY queue evaluation observed one startup `ESC[2J ESC[3J ESC[H` sequence | Prior Phase 24 full-eval run | Carry the failure into Task 1; reproduce and trace the first-render dimension boundary before editing. |

## Closure record

- Rich PTY evaluations: **8/8**.
- CLI suite: **536/536**.
- Desktop suite: **150/150**.
- The startup-clear trace found teardown cleanup after explicit exit, not a
  live startup clear. The existing dimension normalization and one-row Ink
  guard remain the single rendering boundary.
- The next Desktop slice is ready at
  `docs/superpowers/plans/2026-09-22-desktop-next-slice.md`.
