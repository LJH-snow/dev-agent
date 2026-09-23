# CLI Workbench Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Ink CLI 实现安全的路径补全、会话导出、失败重试、MCP 进度可视化和主题配置持久化。

**Architecture:** 将路径扫描、会话导出和主题持久化拆成无 UI 的小模块，分别以纯函数和受限文件写入接口测试；Ink 只消费这些模块，并把 retry 状态保存在 `InkRuntimeStore`。Runtime Event 已经提供 MCP progress，本计划只扩展 `TuiSessionModel.ToolCard` 保存 numeric progress，再由 `ToolTimeline` 渲染。

**Tech Stack:** TypeScript, Node.js 20+, React 19, Ink 6, Node test runner, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-21-cli-workbench-automation-design.md`

## Global Constraints

- 所有工作区路径必须拒绝绝对路径、`..` 逃逸、NUL 字节和真实路径逃逸。
- 扫描最多 2,000 个候选条目、深度 8、结果 12 项。
- 导出最多 500 条记录、每条 16,000 个 Unicode 字符、总输出 2 MiB。
- 导出和配置写入使用临时文件加 rename。
- 不新增 npm 依赖。
- 现有 ANSI、JSON、非交互模式和会话内存格式保持兼容。

---

## File Map

- Create: `apps/cli/src/path-completion.ts` — 工作区内候选扫描、匹配和安全边界。
- Create: `apps/cli/src/session-export.ts` — `:export` 解析、Markdown/JSON 格式化和原子写入。
- Create: `apps/cli/src/ink/retry-panel.tsx` — Ink 失败重试卡片。
- Create: `apps/cli/src/ink/theme-types.ts` — 不依赖 React 的主题名称常量和类型。
- Create: `apps/cli/src/theme-preferences.ts` — 合并现有 config 并原子保存主题。
- Modify: `apps/cli/src/ink/app.tsx` — 路径补全面板、快捷键和重试快捷键。
- Modify: `apps/cli/src/ink/runtime-store.ts` — retry 状态。
- Modify: `apps/cli/src/ink/theme.tsx` — 复用 `theme-types.ts`。
- Modify: `apps/cli/src/tui-session.ts` — ToolCard numeric progress。
- Modify: `apps/cli/src/ink/tool-timeline.tsx` — 进度条和百分比。
- Modify: `apps/cli/src/tui-renderer.ts` — `:export`、`:retry` 命令提示。
- Modify: `apps/cli/src/config.ts` — `theme` 字段和启动解析。
- Modify: `apps/cli/src/config-validation.ts` — `theme` 配置校验。
- Modify: `apps/cli/src/index.ts` — 两种交互模式的命令路由、重试回调和主题保存。
- Create: `apps/cli/tests/path-completion.test.ts`
- Create: `apps/cli/tests/session-export.test.ts`
- Create: `apps/cli/tests/theme-preferences.test.ts`
- Modify: `apps/cli/tests/ink-app.test.ts`
- Modify: `apps/cli/tests/tui-session.test.ts`
- Modify: `apps/cli/tests/tool-timeline.test.ts`
- Modify: `apps/cli/tests/config.test.ts`
- Modify: `apps/cli/tests/config-validation.test.ts`
- Modify: `apps/cli/tests/session-history.test.ts` only if shared export fixtures are needed.

## Task 1: Add safe workspace path completion

**Files:**
- Create: `apps/cli/src/path-completion.ts`
- Create: `apps/cli/tests/path-completion.test.ts`
- Modify: `apps/cli/src/ink/app.tsx`
- Modify: `apps/cli/tests/ink-app.test.ts`

**Interfaces:**
- Produces:
  - `interface PathSuggestion { path: string; isDirectory: boolean }`
  - `scanWorkspacePaths(workingDirectory: string, options?: PathCompletionOptions): Promise<readonly PathSuggestion[]>`
  - `completeWorkspacePath(value: string, cursor: number, workingDirectory: string): Promise<PathCompletionResult>`
  - `PathCompletionResult = { tokenStart: number; tokenEnd: number; token: string; suggestions: readonly PathSuggestion[] } | undefined`
- Consumes: `workingDirectory`, the current composer value and caret position.

- [x] **Step 1: Write failing scanner and matcher tests.**

```ts
test("matches @ tokens and returns workspace-relative files before directories", async () => {
  const result = await completeWorkspacePath("inspect @src/ut", 14, workspace);
  assert.deepEqual(result?.suggestions.map((item) => item.path), ["src/utils.ts"]);
});

test("rejects absolute and parent escaping references", async () => {
  assert.equal((await completeWorkspacePath("@/tmp", 4, workspace)), undefined);
  assert.equal((await completeWorkspacePath("@../secret", 8, workspace)), undefined);
});
```

- [x] **Step 2: Run the focused test to verify it fails.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json && node --test apps/cli/tests-dist/path-completion.test.js`

Expected: FAIL because `path-completion.js` does not exist.

- [x] **Step 3: Implement bounded realpath-safe scanning.**

Use `opendir`, `lstat`, `realpath`, `relative` and `resolve`; skip `.git`, `.dev-agent`, `node_modules`, hidden cache directories, symlinks outside the root, and unreadable entries. Sort case-insensitively by exact-prefix match, directory depth, then lexical path. Return at most 12 suggestions.

- [x] **Step 4: Run the module tests until green.**

Run the same focused command; Expected: PASS.

- [x] **Step 5: Add Ink integration tests for Tab, arrows and Esc.**

Assert that typing `@src/` renders a path suggestion panel, Tab inserts the first suggestion, and Escape removes the panel without calling `onSubmit`.

- [x] **Step 6: Wire async completion without blocking normal typing.**

In `InkCliApp`, derive the active `@` token from the current caret, debounce completion by the current value/cursor pair, discard stale promises, and render `PathCompletionPanel` above the composer. Keep command suggestions and path suggestions mutually exclusive. Tab chooses the selected path, Up/Down changes selection, and Escape clears selection.

- [x] **Step 7: Run Ink tests and typecheck.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false && node --test --test-concurrency=1 apps/cli/tests-dist/path-completion.test.js apps/cli/tests-dist/ink-app.test.js`

- [x] **Step 8: Update the plan checkbox after the focused suite is green.**

## Task 2: Add bounded session export

**Files:**
- Create: `apps/cli/src/session-export.ts`
- Create: `apps/cli/tests/session-export.test.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/tui-renderer.ts`
- Modify: `apps/cli/tests/interactive.test.ts`

**Interfaces:**
- Produces:
  - `type SessionExportFormat = "markdown" | "json"`
  - `parseSessionExportCommand(value: string): { handled: false } | { handled: true; format?: SessionExportFormat; error?: string }`
  - `formatSessionExport(entries: readonly MemoryEntry[], format: SessionExportFormat, options?: SessionExportOptions): string`
  - `writeSessionExport(entries, options: { workingDirectory: string; sessionId: string; format: SessionExportFormat; now?: Date }): Promise<string>`
- Consumes: existing `AgentMemory.entries()`, `sanitizeTerminalText`, `redactSensitiveText`.

- [x] **Step 1: Write failing parser and formatter tests.**

```ts
test("parses export aliases and rejects arbitrary paths", () => {
  assert.deepEqual(parseSessionExportCommand(":export"), { handled: true, format: "markdown" });
  assert.deepEqual(parseSessionExportCommand("/export json"), { handled: true, format: "json" });
  assert.equal(parseSessionExportCommand(":export /tmp/out").handled, true);
  assert.match(parseSessionExportCommand(":export yaml").error ?? "", /markdown|json/);
});
```

- [x] **Step 2: Run the focused test to verify it fails.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json && node --test apps/cli/tests-dist/session-export.test.js`

Expected: FAIL because the module is absent.

- [x] **Step 3: Implement bounded, redacted Markdown and JSON output.**

Preserve entry order, emit role/tool metadata and ISO timestamps, bound every string and total output, remove ANSI/control characters, and redact token-like values. JSON must be parseable and include `{ version: 1, exportedAt, entries }`.

- [x] **Step 4: Implement atomic export file writing.**

Create `.dev-agent/exports`, derive a safe session/timestamp filename, write UTF-8 to a same-directory temporary file with mode `0o600`, rename it, and return the absolute path.

- [x] **Step 5: Run formatter and filesystem tests until green.**

Run the focused test command; Expected: PASS.

- [x] **Step 6: Route `:export` in ANSI and Ink.**

Add the command hint. In both `interactive` and `interactiveInk`, read `current.memory.entries()`, write the selected format, and show `Exported session to .dev-agent/exports/<file>`. Catch errors without leaking paths or secrets beyond the safe relative result.

- [x] **Step 7: Run interactive tests and typecheck.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false && node --test --test-concurrency=1 apps/cli/tests-dist/session-export.test.js apps/cli/tests-dist/interactive.test.js`

## Task 3: Add retry state and keyboard affordance

**Files:**
- Create: `apps/cli/src/ink/retry-panel.tsx`
- Modify: `apps/cli/src/ink/runtime-store.ts`
- Modify: `apps/cli/src/ink/app.tsx`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/tui-renderer.ts`
- Modify: `apps/cli/tests/ink-app.test.ts`

**Interfaces:**
- Produces:
  - `InkRetryState { prompt: string; error: string }`
  - `InkRuntimeStore.setRetry(state: InkRetryState | undefined): void`
  - `InkCliAppProps.onRetry?: () => void`
  - `InkCliAppProps.onDismissRetry?: () => void`
- Consumes: `runInkPrompt` failure path and the last prepared prompt/options.

- [x] **Step 1: Write failing store/UI tests.**

```ts
test("retry state is visible and r invokes the retry callback", async () => {
  const store = new InkRuntimeStore();
  store.setRetry({ prompt: "fix tests", error: "provider unavailable" });
  const { stdin, stdout, writes } = createInkTerminal();
  let retries = 0;
  const instance = renderInkAppWithProps({ store, stdin, stdout, onRetry: () => retries++ });
  stdin.write("r");
  await waitForFrame();
  assert.equal(retries, 1);
  assert.match(writes.join(""), /provider unavailable/);
});
```

- [x] **Step 2: Run focused Ink tests to verify failure.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json && node --test apps/cli/tests-dist/ink-app.test.js`

Expected: FAIL because retry props/state do not exist.

- [x] **Step 3: Implement store state and retry panel.**

Render only while idle and only when `snapshot.retry` exists. Escape dismisses it before session cancellation; `r` triggers retry only when the composer is empty. Keep the prompt out of the new composer value.

- [x] **Step 4: Wire `runInkPrompt`.**

Track `{ prompt, runOptions, label }` as `lastRetry`. Clear retry at the start of each run. On a non-cancelled failure call `store.setRetry` and retain the exact prepared prompt/options. `onRetry` calls `runInkPrompt` once and clears retry before scheduling.

- [x] **Step 5: Add `:retry` routing and command hint.**

When no retry state exists, show `Nothing to retry.`; otherwise invoke the same callback. Do not add `:retry` to ANSI until a separate non-Ink retry state exists.

- [x] **Step 6: Run Ink tests, focused build and typecheck.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false && node --test --test-concurrency=1 apps/cli/tests-dist/ink-app.test.js`

## Task 4: Preserve and render MCP numeric progress

**Files:**
- Modify: `apps/cli/src/tui-session.ts`
- Modify: `apps/cli/src/ink/tool-timeline.tsx`
- Modify: `apps/cli/tests/tui-session.test.ts`
- Modify: `apps/cli/tests/tool-timeline.test.ts`

**Interfaces:**
- Produces:
  - `ToolCard.progress?: { progress: number; total?: number }`
  - `TuiSessionEvent.tool-progress` fields `progress: number` and optional `total`.
  - `formatToolProgressBar(progress: number, total: number | undefined, width?: number): string`
- Consumes: existing Runtime Event payload `tool.progress`.

- [x] **Step 1: Write failing model and renderer tests.**

```ts
test("runtime progress updates the existing MCP tool card", () => {
  const session = new TuiSessionModel();
  const sequence = new RuntimeEventSequence("progress-test");
  session.applyRuntimeEvent(sequence.create("run.started", { prompt: "index" }, { runId: "r1" }));
  session.applyRuntimeEvent(sequence.create("tool.started", { tool: "mcp:search" }, { runId: "r1" }));
  session.applyRuntimeEvent(sequence.create("tool.progress", {
    tool: "mcp:search", progress: 3, total: 10, detail: "scanning",
  }, { runId: "r1" }));
  const card = session.snapshot().cards[0]!;
  assert.deepEqual(card.progress, { progress: 3, total: 10 });
});
```

- [x] **Step 2: Run focused tests to verify failure.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json && node --test apps/cli/tests-dist/tui-session.test.js apps/cli/tests-dist/tool-timeline.test.js`

Expected: FAIL because progress is currently discarded.

- [x] **Step 3: Preserve bounded progress in `TuiSessionModel`.**

Clamp finite `progress` to `>= 0`; clamp to `total` when total is finite and positive; ignore non-finite totals. Keep detail behavior unchanged and use the same card identity.

- [x] **Step 4: Render a compact progress bar.**

Render at most 16 cells plus percentage when total exists; otherwise render `3 done`. Use theme colors and truncate detail as before. Keep approval/validation cards unchanged.

- [x] **Step 5: Run focused progress tests and package typecheck.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false && node --test --test-concurrency=1 apps/cli/tests-dist/tui-session.test.js apps/cli/tests-dist/tool-timeline.test.js`

## Task 5: Persist the selected Ink theme

**Files:**
- Create: `apps/cli/src/ink/theme-types.ts`
- Create: `apps/cli/src/theme-preferences.ts`
- Modify: `apps/cli/src/ink/theme.tsx`
- Modify: `apps/cli/src/ink-ui.ts`
- Modify: `apps/cli/src/config.ts`
- Modify: `apps/cli/src/config-validation.ts`
- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/tests/theme-preferences.test.ts`
- Modify: `apps/cli/tests/config.test.ts`
- Modify: `apps/cli/tests/config-validation.test.ts`

**Interfaces:**
- Produces:
  - `resolveInkTheme(config: CliConfig, env?: Env): InkThemeName`
  - `persistInkTheme(configPath: string, theme: InkThemeName): Promise<void>`
  - `theme` optional `CliConfig` field and config diagnostic for invalid values.
- Consumes: `resolveConfigPath`, `parseInkTheme`, `InkUiController.setTheme`.

- [x] **Step 1: Write failing config and persistence tests.**

```ts
test("environment theme overrides config and default", () => {
  assert.equal(resolveInkTheme({ theme: "mono" }, { DEV_AGENT_THEME: "ember" }), "ember");
  assert.equal(resolveInkTheme({ theme: "mono" }, {}), "mono");
  assert.equal(resolveInkTheme({}, {}), "signal");
});

test("persisting a theme preserves unrelated config fields", async () => {
  await writeFile(configPath, JSON.stringify({ defaultModel: "qwen", theme: "signal" }));
  await persistInkTheme(configPath, "ember");
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
    defaultModel: "qwen", theme: "ember",
  });
});
```

- [x] **Step 2: Run focused tests to verify failure.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json && node --test apps/cli/tests-dist/theme-preferences.test.js apps/cli/tests-dist/config-validation.test.js`

Expected: FAIL because theme config and persistence are absent.

- [x] **Step 3: Move theme names into a React-free module.**

Export `InkThemeName`, `INK_THEME_NAMES`, and `parseInkTheme` from `ink/theme-types.ts`; keep palette/context/provider in `theme.tsx` and re-export the type helpers there for existing imports.

- [x] **Step 4: Add config resolution and validation.**

Add `theme?: InkThemeName` to `CliConfig`, include `theme` in `TOP_LEVEL_FIELDS`, validate it against `signal|mono|ember`, and resolve `DEV_AGENT_THEME` before config and default.

- [x] **Step 5: Implement atomic config merge.**

Read an existing bounded JSON object, replace only `theme`, create parent directory, write a same-directory `config.json.tmp-<pid>-<random>` with mode `0o600`, then rename. Invalid existing JSON is replaced by a minimal object containing the new theme.

- [x] **Step 6: Wire startup and `:theme`.**

After loading config, initialize the controller with `resolveInkTheme(config, process.env)`. Add a persistence callback to `InkInteractiveUi`; after a successful local switch, await `persistInkTheme`. If saving fails, restore the previous in-memory theme and show a safe notice.

- [x] **Step 7: Run config and Ink tests plus typecheck.**

Run: `pnpm --filter @agent_cli/cli build && pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false && node --test --test-concurrency=1 apps/cli/tests-dist/theme-preferences.test.js apps/cli/tests-dist/config.test.js apps/cli/tests-dist/config-validation.test.js apps/cli/tests-dist/ink-theme.test.js apps/cli/tests-dist/ink-ui.test.js`

## Task 6: Integrate, document and verify the complete feature set

**Files:**
- Modify: `apps/cli/README.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-21-cli-workbench-automation-design.md`
- Modify: this plan

- [x] **Step 1: Add concise command documentation.**

Document `@` completion, `:export [markdown|json]`, `:retry`, `:theme`, progress cards, and the user/project config locations without exposing implementation-only internals.

- [x] **Step 2: Run the CLI package build and focused regression suite.**

Run:

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 \
  apps/cli/tests-dist/path-completion.test.js \
  apps/cli/tests-dist/session-export.test.js \
  apps/cli/tests-dist/ink-app.test.js \
  apps/cli/tests-dist/tui-session.test.js \
  apps/cli/tests-dist/tool-timeline.test.js \
  apps/cli/tests-dist/theme-preferences.test.js \
  apps/cli/tests-dist/config.test.js \
  apps/cli/tests-dist/config-validation.test.js
```

- [x] **Step 3: Run the full CLI suite and related package tests.**

Run:

```bash
pnpm --filter @agent_cli/cli test
pnpm --filter @dev-agent/agent-core test
pnpm --filter @dev-agent/mcp test
```

Expected: all tests pass; any unrelated pre-existing failure must be recorded with its exact command and output rather than hidden.

- [x] **Step 4: Run final repository checks.**

Run:

```bash
pnpm --filter @agent_cli/cli typecheck
git diff --check
```

- [x] **Step 5: Mark the spec and plan verification sections complete.**

Record the actual test counts and commands in the spec and plan, then mark the goal complete only after the working tree contains all five features and no required verification remains.

## Verification record

- CLI focused workbench suite: 90 tests passed, including path completion, session export, retry UI, numeric MCP progress, and theme persistence.
- CLI full suite: `pnpm --filter @agent_cli/cli test` — 508 passed, 0 failed.
- Package smoke and manifest checks: 5 passed; the CLI tarball installs and runs outside the workspace without unresolved runtime workspace dependencies.
- Agent core: `pnpm --filter @dev-agent/agent-core test` — 176 passed, 0 failed.
- MCP: `pnpm --filter @dev-agent/mcp test` — 70 passed, 0 failed.
- TypeScript and whitespace checks: `pnpm --filter @agent_cli/cli typecheck` and `git diff --check` passed.
