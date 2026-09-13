# MCP 外部工具取消与进度透传实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让通过 stdio 接入的 MCP 工具能够响应 AgentLoop、CLI 和桌面端的取消信号，并把服务端进度安全地透传到调用方。

**Architecture:** 在 `@dev-agent/mcp` 的单次 `tools/call` 请求上增加可选的 `AbortSignal` 和 progress callback。客户端为需要进度的请求生成 progress token；收到 `notifications/progress` 时同时保留现有全局通知行为并调用当前请求的 callback；主动取消或超时则发送 `notifications/cancelled`，立即清理本地 pending 状态，并忽略晚到的响应。AgentLoop 只暴露与工具名关联的进度事件，CLI 和桌面端分别用文本输出和 SSE 展示。

**Tech Stack:** TypeScript 5.9、Node.js >= 20、Node `AbortController`、newline-delimited JSON-RPC 2.0、Node 内置测试运行器、pnpm workspace；不引入 MCP SDK 或其它运行时依赖。

**Spec:** 本文的“设计约束与验收标准”章节即本计划的规格说明；实现者不需要另行猜测取消错误、progress token、SSE 事件或兼容性语义。

## Global Constraints

- 保持现有 `McpClient.callTool(name, input)` 调用方式兼容；第三个参数必须是可选项。
- 没有传入 `AbortSignal` 或 progress callback 时，现有 MCP wire format 和行为保持不变。
- JSON-RPC 请求取消使用已有协议命名 `notifications/cancelled`，参数为 `{ requestId, reason? }`；取消通知不带 `id`，不等待响应。
- 客户端主动取消使用 `McpRequestError`，错误码为 `-32001`；现有超时错误码 `-32000` 和错误文案保持不变。
- 取消或超时必须从 pending 表和 progress 路由表中移除请求；服务端晚到的响应不得影响后续请求。
- progress callback 异常不得破坏 stdio 读取循环或其它 pending 请求。
- 只有请求启用了 progress callback 时，`tools/call.params._meta.progressToken` 才会写入 wire payload；默认请求不增加 `_meta`。
- CLI 的 `--json` 输出仍然是单个最终 JSON 文档，不插入无法解析的中间进度文本；普通人类可读模式才打印进度行。
- 桌面端新增 SSE 事件必须保持旧客户端可忽略：未知事件不会导致流解析失败。
- 所有新增测试使用现有 Node test runner；不得依赖网络、真实第三方 MCP server 或额外 npm 包。

## 当前基线与真实缺口

v31 完成后的基线：

- TypeScript：465 个测试全部通过；Rust：46 个测试全部通过；真实 Rust 二进制集成：10 个测试全部通过。
- `McpStdioClient` 已支持初始化、工具、资源、prompt、通知、超时、重连和服务端错误详情。
- `AgentLoop` 已把 `AbortSignal` 传给内置工具，`LocalExecutor` 和 `RustExecutor` 可以停止正在运行的命令。
- `McpStdioClient.request()` 当前没有取消参数；`createMcpTool()` 和 CLI 的 MCP 工具适配器也没有转发 `ToolExecutionContext.signal`。
- MCP progress notification 目前只通过全局 `onNotification()` 暴露，无法关联到正在执行的工具，也不会显示在 CLI 或桌面端。

因此 v32 只解决 MCP 外部工具边界，不重做 AgentLoop、模型 provider 或 Rust sandbox。

## 设计约定

### 1. MCP 公共类型

在 `/Users/Admin/Desktop/dev-agent/packages/mcp/src/types.ts` 增加以下结构：

```ts
export interface McpToolProgress {
  readonly progress: number;
  readonly total?: number;
}

export interface McpCallOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: McpToolProgress) => void;
}

export interface McpToolExecutionContext {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: McpToolProgress) => void;
}
```

并保持以下兼容关系：

```ts
export interface McpTool {
  // 现有的一个参数调用仍然有效。
  execute(input: unknown, context?: McpToolExecutionContext): Promise<unknown>;
}

export interface McpClient {
  callTool(name: string, input: unknown, options?: McpCallOptions): Promise<McpToolResult>;
}
```

`McpNotification` 现有的 `progressToken` 字段继续保留。progress callback 只接收已经与当前调用关联的 `{ progress, total }`，不把 token 泄漏给 CLI 或桌面 UI。

### 2. 取消和超时语义

`McpStdioClient` 为每个 pending request 记录：JSON-RPC request id、可选 progress token、可选 progress callback、settle 状态和 timeout timer。

- `signal` 已经 aborted：不写入请求，直接抛出
  `McpRequestError(-32001, 'MCP request "tools/call" was aborted')`。
- 请求运行中收到 abort：先发送
  `{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":<id>,"reason":"request aborted"}}`，再删除 pending/progress 路由并 reject `-32001`。
- 现有 timeout timer 触发时：先发送同样格式的取消通知，`reason` 使用 `request timed out`，再以现有 `-32000` 错误 reject。
- 响应先到时：正常 settle，不再发送取消通知；之后的 abort 只影响外部 signal，不得生成第二次 reject。
- 取消通知写入失败时不覆盖原始 abort/timeout 错误；stdio 已关闭时直接跳过发送。
- 收到 progress 时先调用当前请求 callback，再继续调用现有全局 notification handlers；callback 抛错必须被隔离。
- 收到晚到的 response 时，如果 request id 已经不在 pending 表中，静默丢弃。

### 3. AgentLoop、CLI 和桌面端事件

在 `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/tools.ts` 的 `ToolExecutionContext` 增加：

```ts
readonly onProgress?: (progress: { progress: number; total?: number }) => void;
```

在 `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts` 增加：

```ts
readonly onToolProgress?: (
  progress: { name: string; progress: number; total?: number },
  context: AgentContext
) => void;
```

AgentLoop 为每个工具调用创建的 context 必须把 progress callback 绑定到当前 `call.name`，使 MCP 适配器只需转发 callback，不需要知道 AgentLoop 内部状态。

- CLI 普通模式输出：`[tool-progress] <tool-name> <progress>/<total>`；无 `total` 时输出 `<progress>`。
- 桌面端新增 SSE：

```json
{
  "type": "tool-progress",
  "data": { "name": "mcp:download", "progress": 4, "total": 10 }
}
```

- 浏览器只追加轻量进度状态，不重绘已有 token、tool 或 tool-result 内容。

## 文件变更地图

### MCP 核心

- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/src/types.ts` — 增加调用选项、工具执行上下文和 progress 类型。
- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/src/stdio-client.ts` — 请求选项、progress token 路由、取消通知、abort/timeout race 和晚到响应处理。
- Create: `/Users/Admin/Desktop/dev-agent/packages/mcp/tests/cancelable-mcp-server.mjs` — 无第三方依赖的可取消、可发送 progress 的 MCP fixture。
- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/tests/mcp-timeout.test.ts` — 增加 timeout 会发送取消通知且 pending 清理的断言。
- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/tests/mcp-error-propagation.test.ts` — 保持 v31 错误详情回归覆盖。
- Create: `/Users/Admin/Desktop/dev-agent/packages/mcp/tests/mcp-cancel-progress.test.ts` — MCP 取消、晚到响应、progress 路由和 callback 隔离测试。

### AgentLoop 适配

- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/tools.ts` — 保留既有 timeout/abort 逻辑，同时转发 `onProgress`。
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts` — 增加 `onToolProgress` 事件，并绑定工具名。
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/agent-loop-streaming.test.ts` — 验证工具进度事件顺序与工具名。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts` — MCP 工具适配器转发 signal/progress，AgentLoop 输出 CLI 进度。
- Create: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/mcp-cancel-progress.test.ts` — 验证 CLI 取消和普通模式进度输出；验证 `--json` 不被中间文本污染。

### 桌面端

- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts` — 将 `onToolProgress` 转成 `tool-progress` SSE。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts` — 保证事件类型、流关闭和取消路径兼容。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/public/index.html` — 渲染进度状态且兼容旧事件。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/chat-cancel.test.ts` — 验证取消 MCP 调用会结束当前流并触发下游取消。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/chat-session-e2e.test.ts` — 验证 progress SSE 顺序和 payload。

### 文档与回归

- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/README.md` — 记录 `AbortSignal`、取消通知、超时取消和 progress callback。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/README.md` — 记录 `[tool-progress]` 输出和 `--json` 行为。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/README.md` — 记录 `tool-progress` SSE 事件。
- Modify: `/Users/Admin/Desktop/dev-agent/README.md` — Current Status、Roadmap 和测试数量。
- Modify: `/Users/Admin/Desktop/dev-agent/docs/CHANGELOG.md` — v32 条目。
- Create at execution start: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v32-progress.md` — 阶段进度账本；本次“写计划”不创建该账本，以保持当前请求只新增一个文档。

## 实施阶段

### 阶段 0：MCP 核心请求可取消（预计 1.5–2 小时）

#### Task 0.1：先写公共类型和失败测试

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/src/types.ts`
- Create: `/Users/Admin/Desktop/dev-agent/packages/mcp/tests/mcp-cancel-progress.test.ts`
- Create: `/Users/Admin/Desktop/dev-agent/packages/mcp/tests/cancelable-mcp-server.mjs`

- [x] **Step 1: 写失败测试。** 先让可取消 fixture 实现以下固定契约：
  - `tools/list` 返回一个 `progressive` 工具；
  - `tools/call(progressive)` 读取 `params._meta.progressToken`，依次发送 progress `1/3`、`2/3`、`3/3`，并在最后返回文本结果；
  - 收到无 id 的 `notifications/cancelled` 后，将 `requestId` 和 `reason` 追加到 `MCP_CANCEL_MARKER` 指定的文件，但仍会按 fixture 设计发送一次延迟 response，用于验证客户端忽略晚到结果；
  - `AbortController` 在 `tools/call` 发出后触发 abort，客户端抛出 code `-32001`；
  - fixture 的取消记录文件在 abort 后出现，证明客户端真的发送了取消通知；
  - `pendingRequestCount === 0`；
  - fixture 延迟发送原始 response 后，客户端仍可 `ping()`，且没有第二次 settle；
  - timeout 仍抛 `-32000`，同时 fixture 收到取消通知；
  - progress callback 收到 `[1, 2, 3]`，total 始终为 `3`，调用最终成功；
  - progress callback 抛出异常时，RPC 调用仍能完成，后续 `ping()` 仍能成功。

- [x] **Step 2: 只运行 MCP 新测试，确认测试先失败。**

```bash
pnpm --filter @dev-agent/mcp test
```

Expected: 新增取消、progress 断言失败；v31 已有的 44 个测试保持通过。

#### Task 0.2：实现 request options 和 cancellation lifecycle

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/src/types.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/src/stdio-client.ts`

**Interfaces:**

- Consumes: `McpCallOptions`, `McpToolProgress` and existing `McpRequestError`.
- Produces: `McpClient.callTool(name, input, options?)`, `createMcpTool().execute(input, context?)`, and a private request lifecycle that removes all routing state on settle.

- [x] **Step 1:** Extend `PendingRequest` with optional `progressToken` and callback; add `progressPending` routing map if the implementation uses a separate index.
- [x] **Step 2:** Let `callTool()` pass options to the private request method. Generate a numeric token from the request id when `onProgress` exists and add it under `params._meta.progressToken` without changing requests that do not request progress.
- [x] **Step 3:** Add an abort listener before writing the request. Handle an already-aborted signal synchronously within the returned Promise and never leave a pending map entry.
- [x] **Step 4:** Add `cancelRequest(id, reason)` that removes pending/routing/timer state, sends `notifications/cancelled` when the child is writable, and rejects exactly once with the requested client-side error.
- [x] **Step 5:** Make the existing timeout path call `cancelRequest(id, "request timed out")` while preserving code `-32000` and the existing timeout message.
- [x] **Step 6:** In `handleLine()`, route progress notifications to the matching callback, catch callback exceptions, then preserve the existing global notification dispatch.
- [x] **Step 7:** Update `createMcpTool()` so its optional context forwards `signal` and `onProgress` to `client.callTool()`.

- [x] **Step 8: 运行 MCP 测试确认通过。**

```bash
pnpm --filter @dev-agent/mcp test
```

Expected: MCP package tests pass, including cancellation, timeout cancellation, progress ordering, callback isolation, and all previous tests.

- [x] **Step 9: Commit the self-contained MCP core change.**

```bash
git add packages/mcp/src/types.ts packages/mcp/src/stdio-client.ts packages/mcp/tests/cancelable-mcp-server.mjs packages/mcp/tests/mcp-cancel-progress.test.ts packages/mcp/tests/mcp-timeout.test.ts
git commit -m "feat(mcp): cancel and report progress for tool calls"
```

### 阶段 1：AgentLoop 与 CLI 透传（预计 1–1.5 小时）

#### Task 1.1：增加通用工具进度上下文

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/tools.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/agent-loop-streaming.test.ts`

**Interfaces:**

- Consumes: MCP `McpToolExecutionContext.onProgress` shape `{ progress, total? }`.
- Produces: `AgentLoopOptions.onToolProgress({ name, progress, total? }, context)` and `ToolExecutionContext.onProgress`.

- [x] **Step 1:** Add the optional callback to `ToolExecutionContext` and preserve it when `runTool()` creates its child context.
- [x] **Step 2:** Add `onToolProgress` to `AgentLoopOptions` and the class field.
- [x] **Step 3:** When constructing the context for one `call`, bind `onProgress` to invoke `onToolProgress` with that call's name and the received progress values.
- [x] **Step 4:** Add a fake tool that emits three progress values, then a model stub that calls it once; assert the sequence is `call -> progress 1 -> progress 2 -> progress 3 -> result` and the final model turn remains unchanged.
- [x] **Step 5:** Run the focused AgentLoop tests.

```bash
pnpm --filter @dev-agent/agent-core test
```

Expected: all existing agent-core tests plus the progress-order test pass; timeout and outer abort behavior remain unchanged.

#### Task 1.2：转发 MCP 工具上下文并输出 CLI 进度

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Create: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/mcp-cancel-progress.test.ts`

- [x] **Step 1:** Change the MCP adapter's `execute(input)` to accept `context` and call `tool.execute(input, { signal: context?.signal, onProgress: context?.onProgress })`.
- [x] **Step 2:** Add `onToolProgress` to the CLI AgentLoop construction. Human-readable mode writes exactly one line per received update in the form `[tool-progress] <name> <progress>/<total>`; omit it when `jsonOutput` is true.
- [x] **Step 3:** Make the CLI test use the cancelable fixture and a deterministic provider stub. Assert that Ctrl-C/abort reaches the fixture, the CLI exits with its existing aborted status, and JSON output remains parseable.
- [x] **Step 4:** Run the CLI-focused tests.

```bash
pnpm --filter @dev-agent/cli test
```

Expected: existing MCP prefix/resource/timeout/JSON tests pass, plus cancellation and progress output coverage.

- [x] **Step 5: Commit the AgentLoop/CLI change.**

```bash
git add packages/agent-core/src/tools.ts packages/agent-core/src/loop.ts packages/agent-core/tests/agent-loop-streaming.test.ts apps/cli/src/index.ts apps/cli/tests/mcp-cancel-progress.test.ts
git commit -m "feat(agent): propagate MCP cancellation and progress"
```

### 阶段 2：桌面端 SSE 透传（预计 1–1.5 小时）

#### Task 2.1：把工具进度接入 chat-session 和 SSE

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/public/index.html`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/chat-cancel.test.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/chat-session-e2e.test.ts`

- [ ] **Step 1:** Add `onToolProgress` to the desktop AgentLoop callbacks and emit the exact `tool-progress` SSE shape from the design contract.
- [ ] **Step 2:** Keep event ordering per stream: `tool` → zero or more `tool-progress` → `tool-result`; tokens from other model turns remain in their existing order.
- [ ] **Step 3:** On `/api/chat/cancel`, ensure the run's existing controller aborts the MCP call, the stream still ends with its existing `done { "status": "aborted" }`, and no later MCP result is emitted.
- [ ] **Step 4:** Update the browser handler to render the latest progress without assuming `total` exists; unknown event types remain ignored.
- [ ] **Step 5:** Run the desktop tests.

```bash
pnpm --filter @dev-agent/desktop test
```

Expected: existing SSE, cancellation, multi-session, approval and backpressure tests pass; new progress/cancel assertions pass.

- [ ] **Step 6: Commit the desktop change.**

```bash
git add apps/desktop/src/chat-session.ts apps/desktop/src/server.ts apps/desktop/public/index.html apps/desktop/tests/chat-cancel.test.ts apps/desktop/tests/chat-session-e2e.test.ts
git commit -m "feat(desktop): stream MCP tool progress"
```

### 阶段 3：文档、全量回归与发布（预计 45–60 分钟）

#### Task 3.1：文档和进度账本

**Files:**

- Create: `/Users/Admin/Desktop/dev-agent/docs/day-plan-v32-progress.md`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/mcp/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/CHANGELOG.md`

- [ ] **Step 1:** 在 MCP README 写出可复制的调用示例，明确 `AbortSignal`、`notifications/cancelled`、progress callback、timeout 和 pending cleanup。
- [ ] **Step 2:** 在 CLI README 记录普通模式的 `[tool-progress]` 输出，并说明 `--json` 不混入进度行。
- [ ] **Step 3:** 在 Desktop README 记录 `tool-progress` SSE payload、事件顺序和取消后的 `done` 行为。
- [ ] **Step 4:** 更新根 README 的 Current Status、Roadmap 和测试数量；清理本次触及范围内的过时取消说明，不顺手重排历史 Roadmap 编号。
- [ ] **Step 5:** 增加 v32 changelog 和 progress ledger，记录实现的错误码、取消通知、progress SSE 和测试结果。

#### Task 3.2：完整验证

- [ ] **Step 1:** 运行结构检查、构建和 TypeScript 类型检查。

```bash
node scripts/check.mjs
pnpm build
pnpm typecheck
```

- [ ] **Step 2:** 运行全部 TypeScript 测试和 Rust 真实二进制集成测试。

```bash
pnpm test
pnpm --filter @dev-agent/executor test:integration
```

- [ ] **Step 3:** 运行 Rust 格式、lint 和单元测试。

```bash
cd runtime/rust
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

- [ ] **Step 4:** 验证 `git diff --check`，确认没有 `dist/`、`tests-dist/` 或临时 fixture 输出被加入 Git。
- [ ] **Step 5:** 记录完整测试数量；以全量命令实际输出为准，不手写旧基线数字。
- [ ] **Step 6:** 完成最后一次人工 review：确认没有 signal listener、timer、pending map 或 progress route 泄漏。
- [ ] **Step 7: Commit and push the completed v32 plan implementation.**

```bash
git add packages/mcp packages/agent-core apps/cli apps/desktop README.md docs/CHANGELOG.md docs/day-plan-v32-progress.md
git commit -m "feat: make MCP tool calls cancellable and observable"
git push origin main
```

## 验收标准

v32 只有在以下条件全部满足时才算完成：

1. 直接调用 `McpStdioClient.callTool()` 时，abort 会发送 `notifications/cancelled`、抛出 `-32001`，并将 pending 数量归零。
2. 现有请求超时仍抛出 `-32000` 和原文案，同时尽力通知 MCP 服务端取消。
3. 服务端晚到的 response 被忽略，不会污染下一个 request 或重新触发 callback。
4. progress callback 能收到属于当前调用的 progress，多个并发调用不会串线；callback 抛异常不会破坏连接。
5. `createMcpTool()`、AgentLoop 和 CLI 适配器都转发 `signal`，桌面取消可以真正取消外部 MCP 调用。
6. CLI 普通模式能看到 `[tool-progress]`，`--json` 仍输出单个合法 JSON 文档。
7. 桌面端按顺序发送 `tool`、`tool-progress`、`tool-result`，取消后仍发送现有 `done: aborted`，不发送晚到结果。
8. 没有 signal/progress callback 的旧调用 wire format 和行为保持不变。
9. 所有文档与 progress ledger 已更新，全部 TypeScript/Rust/集成测试通过。

## 执行协议

- 开始执行时先创建 `/Users/Admin/Desktop/dev-agent/docs/day-plan-v32-progress.md`，读取本计划和账本，并确认 `git status`。
- 先完成阶段 0，再完成阶段 1、阶段 2，最后做阶段 3；每个 Task 的 focused test 必须先失败、再通过。
- 每个 Task 完成后单独提交；不要把不相关的重构混入 v32。
- 不开启 signal/progress 时保持旧行为；不增加运行时依赖；不改变现有错误码和 SSE 事件语义。
- 如果实现中发现取消协议或接口需要扩大范围，先更新本计划和 progress ledger，再继续编码。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3

## 后续路线图（v32 完成后）

以下计划是 v32 之后的产品路线，不计入 v32 的验收，也不应在实现 v32 时顺手扩大范围。依赖顺序为 **v32 → v33 → v34**。

### v33：代码修改 Diff 审阅、批准与回滚

**目标:** 在 Agent 修改工作区之前，让用户看到准确的变更内容，并能批准、拒绝或撤销一次修改。

**当前基础:** `/Users/Admin/Desktop/dev-agent/packages/tools/src/filesystem.ts` 已有精确匹配的 `edit` 和原子多 hunk `patch`；`/Users/Admin/Desktop/dev-agent/packages/agent-core/src/approval.ts` 已有审批策略，但目前审批信息不包含变更 diff，普通工作区内写入也不会强制经过用户确认。

**计划范围:**

- 为 `filesystem` 增加只读的 `preview` 能力，复用 `edit`/`patch` 的匹配规则，返回文件路径、统一 diff、增删行数、原文件哈希和预期新文件哈希；preview 绝不写盘。
- 为需要审阅的写操作建立稳定的 change-set 标识，使 preview、approval、apply、rollback 关联到同一次变更，而不是依赖脆弱的文件路径字符串。
- 增加显式的 `review-writes` 审批模式：`write`、`edit`、`patch` 和新建目录在批准前不得产生工作区副作用；拒绝或超时必须保持文件字节级不变。
- 桌面端展示文件名、diff 和批准/拒绝按钮；CLI 普通模式展示可读 diff，`--json` 返回结构化 review 状态而不混入人类文本。
- 应用时继续使用临时文件加 rename 或现有原子 patch 逻辑；记录变更前内容或可验证的 preimage，使最近一次批准的变更可以撤销。
- 在多个文件的 change set 中采用全有或全无语义：任一 hunk、哈希或审批状态不匹配时不写入任何文件。

**主要文件:**

- `/Users/Admin/Desktop/dev-agent/packages/tools/src/filesystem.ts`
- `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/approval.ts`
- `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts`
- `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`
- `/Users/Admin/Desktop/dev-agent/apps/desktop/public/index.html`

**完成标准:** 用户在任何受 `review-writes` 保护的写入前都能看到实际 diff；拒绝、超时、并发冲突和磁盘写入失败都不会留下部分修改；批准后可以验证应用前后哈希，并能撤销最近一次 change set；现有 `allow` 和 `deny-dangerous` 模式保持兼容。

### v34：修改后的自动验证闭环

**目标:** 修改代码后自动验证受影响范围，并把可操作的失败结果反馈给模型，形成“修改 → 验证 → 修复 → 再验证”的闭环。

**计划范围:**

- 根据变更文件和所在 workspace package 计算最小验证集合，优先执行对应包的 `typecheck` 和 `test`，需要时再执行根级构建。
- 增加受约束的验证执行器：每个验证命令继承工作目录、审批策略、取消信号、超时和输出上限，不能绕过现有 LocalExecutor/RustExecutor 边界。
- 为 AgentLoop 增加验证结果事件和结构化工具结果，至少包含命令、退出码、耗时、是否超时、截断标记和失败摘要；完整日志仍受输出上限保护。
- 验证失败时把编译器/测试失败位置和关键输出写回模型；验证成功时记录通过的包、测试数量和未执行项目，避免模型误以为所有检查都跑过。
- CLI 增加显式的 `--verify` 配置入口；桌面端在批准并应用 change set 后显示验证阶段、进度、结果和“需要修复”的状态。
- 取消、超时或用户断开时，验证命令必须停止；验证失败不得自动回滚已批准的修改，是否回滚由 v33 的 change-set 状态和用户决定。

**主要文件:**

- `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/loop.ts`
- `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/tools.ts`
- `/Users/Admin/Desktop/dev-agent/packages/tools/src/create-default-tools.ts`
- `/Users/Admin/Desktop/dev-agent/packages/executor/src/local-executor.ts`
- `/Users/Admin/Desktop/dev-agent/packages/executor/src/rust-executor.ts`
- `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- `/Users/Admin/Desktop/dev-agent/apps/desktop/src/chat-session.ts`
- `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`

**完成标准:** 一次批准的代码修改能够产生明确的验证状态；验证命令遵守既有取消、超时、审批和输出限制；失败结果能让模型定位并尝试修复；CLI、桌面端和 session transcript 对验证结果保持一致记录。

### 后续顺序

1. **v32**：先让 MCP 外部工具可取消、可观察，避免长时间外部调用失控。
2. **v33**：再保护本地代码修改，让用户在写盘前拥有 Diff 审阅、批准和回滚能力。
3. **v34**：最后把修改后的 typecheck、测试和修复反馈串成闭环。

只有 v32 的接口和取消生命周期稳定后，才开始 v33；只有 v33 能可靠地产生 change set 和 preimage 后，才开始 v34 的自动验证和修复流程。
