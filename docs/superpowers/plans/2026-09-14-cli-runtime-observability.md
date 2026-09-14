# CLI Runtime Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CLI 的人类可读输出中显示实际 provider/model、流式状态、首 token 延迟和总响应耗时，同时保持 JSON 输出契约稳定。

**Architecture:** 在现有 CLI 运行边界上增加轻量的 `StreamingRun` 计时器；它在每个 prompt 开始时重置、在第一次可见 token 时记录时间、在 agent run 完成后给出耗时。运行信息只在真正进入交互或 `--once` 模式后输出，避免污染 `--tools`、`--metadata` 和 JSON 操作。

**Tech Stack:** TypeScript、Node.js `performance.now()`、Node test runner、现有 OpenAI SSE stub。

**Spec:** `docs/cli-runtime-observability.md`

## Global Constraints

- 不改变 provider/model 解析、agent loop、工具执行、审批、验证或 session memory 行为。
- 人类模式可增加 `[runtime]` 和 `[timing]` 行；`--json` stdout 必须继续是单个 JSON 文档。
- 首 token 和总耗时使用单调时钟；没有可见 token 时显示 `first-token=n/a`。
- 遵循 RED → GREEN → REFACTOR，并运行 CLI 相关回归测试。

---

### Task 1: 锁定运行信息与耗时输出的 RED contract

**Files:**
- Modify: `apps/cli/tests/usage-output.test.ts`
- Test fixture: existing OpenAI JSON stub plus a new OpenAI SSE response helper inside the test file

**Interfaces:**
- Consumes: current `node dist/index.js --once` CLI entry point and existing provider stubs.
- Produces: assertions for `[runtime]` and `[timing]` output that implementation must satisfy.

- [x] **Step 1: Write the failing tests**

Add one human-mode non-stream test using `--once hello --no-stream` and an OpenAI JSON response. Assert:

```ts
assert.match(result.stdout, /\[runtime\] provider=openai model=gpt-4o-mini streaming=disabled/);
assert.match(result.stdout, /\[timing\] first-token=n\/a total=\d+ms/);
```

Add one human-mode stream test using an OpenAI `text/event-stream` response that emits a content delta followed by usage and `[DONE]`. Assert:

```ts
assert.match(result.stdout, /\[runtime\] provider=openai model=gpt-4o-mini streaming=enabled/);
assert.match(result.stdout, /\[timing\] first-token=\d+ms total=\d+ms/);
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @dev-agent/cli test -- --test-name-pattern "runtime|timing"
```

Expected: the new assertions fail because no `[runtime]` or `[timing]` lines exist yet.

- [x] **Step 3: Commit the RED contract**

```bash
git add apps/cli/tests/usage-output.test.ts docs/cli-runtime-observability.md docs/superpowers/plans/2026-09-14-cli-runtime-observability.md
git commit -m "test: define cli runtime observability contract"
```

### Task 2: Implement runtime status and per-run timing

**Files:**
- Modify: `apps/cli/src/index.ts`
- Test: `apps/cli/tests/usage-output.test.ts`

**Interfaces:**
- Consumes: `ModelProvider.id`, `ModelProvider.model`, existing `StreamingRun` callbacks, and `runPrompt` output flow.
- Produces: `StreamingRun.begin()`, `StreamingRun.finish()`, and human-readable runtime/timing lines.

- [x] **Step 1: Add monotonic timing state to `StreamingRun`**

Add a run start timestamp and optional first-token timestamp. Reset both in `begin()`. In the existing `onToken` callback, record the first token timestamp before writing the token. Return a timing object from `finish()` with optional `firstTokenMs` and numeric `totalMs`.

- [x] **Step 2: Wire timing around `loop.run`**

In `runPrompt`, call `streaming.begin()` immediately before `loop.run`. Call `streaming.finish()` after the run resolves. In human mode, print:

```text
[timing] first-token=<formatted value> total=<formatted value>ms
```

Use `n/a` when no visible token was observed. Preserve the existing final answer, state, usage, review, validation, and cost output order.

- [x] **Step 3: Print runtime status only for human agent runs**

After command-only paths (`--tools`, `--metadata`, `--session-list`, `--compact`) return and immediately before constructing the agent context, print:

```ts
[runtime] provider=${provider.id} model=${provider.model} streaming=${streamingEnabled ? "enabled" : "disabled"}
```

Do not print it when `jsonOutput` is true. `streamingEnabled` must be false for `--no-stream` and true only when human streaming is enabled and the provider exposes `streamChat`.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --filter @dev-agent/cli test -- --test-name-pattern "runtime|timing"
```

Expected: all new runtime and timing assertions pass.

- [x] **Step 5: Commit the implementation**

```bash
git add apps/cli/src/index.ts apps/cli/tests/usage-output.test.ts
git commit -m "feat: show cli runtime and response timing"
```

### Task 3: Document and verify the user-facing behavior

**Files:**
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/cli-runtime-observability.md`
- Modify: `docs/README.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `tests/documentation-contract.test.mjs`

**Interfaces:**
- Consumes: the output contract implemented in Task 2.
- Produces: user documentation and completion evidence.

- [x] **Step 1: Document the runtime and timing lines**

Add the human-mode output contract to `apps/cli/README.md`, including that `--no-stream` disables token streaming and reports `first-token=n/a`; note that `--json` stays machine-readable without banner text.

Mark `docs/cli-runtime-observability.md` complete, add the plan/spec links to `docs/README.md`, and add a dated CHANGELOG entry without creating a release tag.

- [x] **Step 2: Run focused and full CLI verification**

Run:

```bash
pnpm --filter @dev-agent/cli test
pnpm --filter @dev-agent/cli build
pnpm check
node --test tests/documentation-contract.test.mjs
```

Expected: all commands exit 0; CLI tests report zero failures; documentation contract remains green.

- [x] **Step 3: Review the final diff and commit documentation**

```bash
git diff --check
git status --short
git add apps/cli/README.md docs/cli-runtime-observability.md docs/README.md docs/CHANGELOG.md
git commit -m "docs: explain cli runtime observability"
```

### Task 4: Full verification and handoff

**Files:**
- No source changes expected.
- Review: all files changed by Tasks 1–3.

- [ ] **Step 1: Run the repository TypeScript gate**

```bash
pnpm verify:typescript
```

Expected: the fixed TypeScript/release/documentation contracts and package tests pass.

- [ ] **Step 2: Check repository state**

```bash
git diff --check
git status --short --branch
git log -3 --oneline
```

Expected: no unstaged changes, no whitespace errors, and commits are on the current branch.

- [ ] **Step 3: Report evidence**

Summarize the exact runtime output behavior, tests run, and the fact that no release tag was created.
