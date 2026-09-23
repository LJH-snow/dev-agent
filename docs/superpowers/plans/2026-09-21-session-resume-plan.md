# Session Resume and Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Ink CLI 增加安全的历史会话索引、选择和恢复能力，并提供 `--resume` 参数。

**Architecture:** 把目录扫描和命令解析放进 React-free 模块；Ink Store 只保存受限的会话选择快照；`interactiveInk` 在确认选择后创建新的 `FileMemory`/`AgentContext`，不修改现有 memory schema。现有 `--session-list` 输出保持兼容，新 registry 只作为共享内部数据源逐步接入。

**Tech Stack:** TypeScript, Node.js 20+, React 19, Ink 6, Node test runner, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-21-session-resume-design.md`

## Global Constraints

- 只读取当前 session directory 下的 `.json` 文件。
- session id 只接受现有 `normalizeSessionId` 规则产生的安全值。
- 最多扫描并返回 256 个最新会话。
- 每个预览最多读取并展示 240 个 Unicode 字符。
- 无效或超限会话不能阻塞其他会话。
- 不修改已有 memory JSON schema，不新增 npm 依赖。

---

## File Map

- Create: `apps/cli/src/session-registry.ts` — 安全扫描、元数据、摘要和搜索。
- Create: `apps/cli/src/session-resume.ts` — `:sessions`/`:resume` 命令解析和格式化。
- Create: `apps/cli/src/ink/session-picker.tsx` — Ink 选择面板。
- Create: `apps/cli/tests/session-registry.test.ts`
- Create: `apps/cli/tests/session-resume.test.ts`
- Modify: `apps/cli/src/ink/runtime-store.ts` — picker snapshot。
- Modify: `apps/cli/src/ink/app.tsx` — picker UI 和键盘。
- Modify: `apps/cli/src/index.ts` — `--resume`、命令路由和 context 切换。
- Modify: `apps/cli/tests/ink-app.test.ts`
- Modify: `apps/cli/tests/cli-args.test.ts`
- Modify: `apps/cli/tests/interactive.test.ts`
- Modify: `apps/cli/tests/session-list.test.ts`
- Modify: `apps/cli/README.md`
- Modify: `README.md`

## Task 1: Add the registry and command parser

**Interfaces:**

```ts
export interface StoredSession {
  readonly id: string;
  readonly file: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly createdAt?: string;
  readonly lastActiveAt?: string;
  readonly entryCount?: number;
  readonly usage?: ChatUsage;
  readonly preview?: string;
  readonly readable: boolean;
}

export function listStoredSessions(
  directory: string,
  options?: { readonly limit?: number },
): Promise<readonly StoredSession[]>;

export function searchStoredSessions(
  sessions: readonly StoredSession[],
  query: string,
  limit?: number,
): readonly StoredSession[];
```

- [x] **Step 1: Write failing registry tests.**

```ts
test("lists newest safe sessions with metadata and a redacted preview", async () => {
  const sessions = await listStoredSessions(directory);
  assert.deepEqual(sessions.map((item) => item.id), ["newer", "older"]);
  assert.equal(sessions[0]?.entryCount, 2);
  assert.match(sessions[0]?.preview ?? "", /\[redacted\]/);
});

test("skips unsafe filenames and keeps malformed files non-blocking", async () => {
  const sessions = await listStoredSessions(directory);
  assert.equal(sessions.some((item) => item.id.includes("..")), false);
  assert.equal(sessions.find((item) => item.id === "broken")?.readable, false);
});
```

- [x] **Step 2: Run the registry test and confirm the expected missing-module failure.**

Run:

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false
node --test apps/cli/tests-dist/session-registry.test.js
```

Expected: FAIL because `session-registry.js` does not exist.

- [x] **Step 3: Implement bounded scanning and search.**

Use `opendir`, `stat`, `FileMemory.getMetadata`, and a capped `entries()` read only for
the newest bounded candidates. Derive ids from filenames only when
`normalizeSessionId(rawId) === rawId`; sanitize preview text and truncate it to 240
Unicode characters. Sort newest first and cap at 256.

- [x] **Step 4: Add parser tests and implement command parsing.**

```ts
test("parses session picker aliases and optional search", () => {
  assert.deepEqual(parseSessionResumeCommand(":sessions"), {
    handled: true,
    action: "open",
  });
  assert.deepEqual(parseSessionResumeCommand("/resume build api"), {
    handled: true,
    action: "open",
    query: "build api",
  });
  assert.deepEqual(parseSessionResumeCommand(":resume"), {
    handled: true,
    action: "open",
  });
});
```

Implement `parseSessionResumeCommand` for `:sessions`, `/sessions`, `:resume`,
and `/resume`; reject unknown extra syntax with `Usage: :sessions [query]`.

- [x] **Step 5: Run registry and parser tests until green.**

Run:

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 \
  apps/cli/tests-dist/session-registry.test.js \
  apps/cli/tests-dist/session-resume.test.js
```

## Task 2: Add the Ink session picker

**Interfaces:**

```ts
export interface InkSessionPicker {
  readonly title: string;
  readonly rows: readonly string[];
  readonly selectedIndex: number;
}

InkRuntimeStore.setSessionPicker(
  picker: InkSessionPicker | undefined
): void;
```

- [x] **Step 1: Add a failing store/panel test.**

```ts
test("Ink session picker renders selection hints and selected row", async () => {
  const store = new InkRuntimeStore();
  store.setSessionPicker({
    title: "SESSIONS",
    rows: ["› default · 2 entries", "  work · 4 entries"],
    selectedIndex: 0,
  });
  const output = await renderInkSnapshot(store);
  assert.match(output, /SESSIONS/);
  assert.match(output, /Enter resume · esc close/);
});
```

- [x] **Step 2: Implement the panel and store snapshot.**

Render a bounded bordered panel above the composer. Keep row strings already
sanitized; the panel must not read files or mutate the session.

- [x] **Step 3: Add keyboard behavior.**

While the picker is open, Up/Down changes `selectedIndex`, Enter calls
`onSessionResume(index)`, and Escape calls `onSessionPickerDismiss`. Do not submit
the selected id into the normal prompt queue.

- [x] **Step 4: Run Ink tests and typecheck.**

Run:

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 apps/cli/tests-dist/ink-app.test.js
pnpm --filter @agent_cli/cli typecheck
```

## Task 3: Wire session switching and `--resume`

- [x] **Step 1: Add failing CLI argument tests.**

```ts
test("--resume accepts a safe session id and rejects ambiguity with --session", async () => {
  const result = await runCli(["--resume", "work", "--session", "other", "--tools"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /cannot be combined/);
});
```

- [x] **Step 2: Add `--resume` parsing and compatibility behavior.**

Add `--resume` as a one-value flag. If supplied alone, use its normalized id as the
initial context session. If combined with `--session`, return a stable usage error.
Keep existing `--session` behavior unchanged.

- [x] **Step 3: Add an interactive context factory.**

Pass a callback that creates `FileMemory` and `AgentContext` for a validated session
id. Re-run persisted change-set restoration for the new context without replacing
the shared provider, tools, scheduler, or MCP sessions.

- [x] **Step 4: Route `:sessions` and `:resume`.**

When idle, list sessions from the resolved session directory, filter the optional
query, set the picker snapshot, and await the selected id. On selection, replace
`current`, update the displayed session id, clear dynamic Ink state, and add a safe
notice. If the target is missing or unreadable, close the picker and show an error.

- [x] **Step 5: Run interactive and argument tests.**

Run:

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 \
  apps/cli/tests-dist/cli-args.test.js \
  apps/cli/tests-dist/interactive.test.js \
  apps/cli/tests-dist/session-list.test.js
```

## Task 4: Document, integrate and verify

- [x] **Step 1: Document commands and behavior.**

Add `:sessions`, `:resume <query>`, `--resume <session-id>`, picker key bindings,
and the idle-only switching rule to both README files.

- [x] **Step 2: Run focused regression tests.**

```bash
pnpm --filter @agent_cli/cli build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 \
  apps/cli/tests-dist/session-registry.test.js \
  apps/cli/tests-dist/session-resume.test.js \
  apps/cli/tests-dist/ink-app.test.js \
  apps/cli/tests-dist/cli-args.test.js \
  apps/cli/tests-dist/interactive.test.js
```

- [x] **Step 3: Run the complete verification.**

```bash
pnpm --filter @agent_cli/cli test
pnpm --filter @dev-agent/agent-core test
pnpm --filter @dev-agent/mcp test
pnpm --filter @agent_cli/cli typecheck
git diff --check
```

- [x] **Step 4: Record actual counts in this plan and the design spec.**

- [x] **Step 5: Mark the goal complete only after all requirements are verified.**

## Verification record

Feature-focused verification completed:

- `@agent_cli/cli` build: passed.
- `@agent_cli/cli` test TypeScript compilation: passed.
- `@agent_cli/cli` typecheck: passed.
- Registry/parser tests: 7/7 passed.
- CLI `--resume` and ANSI session-switch focused run: 6/6 passed
  (including the existing rich-TTY resume regression).
- Ink session-picker and command-palette tests: 3/3 passed.
- `@dev-agent/agent-core` tests: 176/176 passed.
- `@dev-agent/mcp` tests: 70/70 passed.
- `git diff --check`: passed.

- Full `@agent_cli/cli` suite: 532/532 passed, including long-transcript
  Home/End navigation, MCP initialization, session indexing, `--resume`, and
  Ink picker switching.
- The earlier viewport and package-install timeout notes are superseded by the
  completed serial verification run.

Verification completed on 2026-09-22. The session-resume implementation and
its documentation are ready for the next development phase.
