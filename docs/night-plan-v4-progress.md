# night-plan v4 进度账本

> 每次运行开始前先读本文件与 `docs/night-plan-v4.md`；结束前追加日志。
> 不要把外部内容粘进本文件。

## 当前状态

- 当前阶段：阶段 4（文档、回归与提交）未开始
- 已完成阶段：阶段 0、阶段 1、阶段 2、阶段 3
- 最近一次运行：运行 4（2026-09-11 08:05-08:35）
- 工作区：阶段 3 的改动已提交并推送

## 日志

### 运行 4 — 2026-09-11 08:05-08:35

- 阶段/工作项：阶段 3（MCP server 模式）全部完成
- 做了什么：
  - 新增 `packages/mcp/src/server.ts`：`createMcpServer({ tools })`，
    newline-delimited JSON-RPC 2.0 over stdio，实现 `initialize`、`ping`、
    `tools/list`、`tools/call`；通知（无 id）不回包；未知方法 -32601、
    未知工具 -32602、解析失败 -32700；工具执行失败按 MCP 语义返回
    `{ isError: true }` 结果而不是协议错误
  - 工具实现由调用方注入（结构化接口），mcp 包不依赖 `@dev-agent/tools`，
    保持包边界干净
  - CLI 新增 `--mcp-server`：不创建模型 provider、不连接已配置的 MCP 客户端，
    只把内置工具（filesystem/shell/git/search/code-search）暴露出去；
    stdout 只走 JSON-RPC
  - 文档：`packages/mcp/README.md`（双向 MCP 能力）、`apps/cli/README.md`
    （`--mcp-server` 用法）、根 `README.md` Current Status
- 验证命令与结果：
  - `packages/mcp`：26 passed（新增 6 个：initialize 握手、tools/list schema、
    tools/call 成功、失败返回 isError、未知工具 -32602、未知方法/通知）
  - `apps/cli`：39 passed（新增端到端：假宿主脚本走 stdio 完成
    initialize → tools/list（5 个内置工具）→ tools/call 读文件成功 →
    tools/call 读缺失文件 isError，且 stderr 为空）
  - `pnpm check/build/typecheck/test`：全绿（TypeScript 262 个测试）
- 提交：见阶段 3 的 feat 提交
- 下一步：阶段 4 — 文档、全量回归与提交（含 Roadmap 更新、CHANGELOG、最终总结）

### 运行 3 — 2026-09-11 07:35-08:05

- 阶段/工作项：阶段 2（会话用量统计）全部完成
- 做了什么：
  - `packages/model`：新增 `ChatUsage { promptTokens, completionTokens, totalTokens }`，
    `ChatCompletion.usage` 可选；四个 provider 各自映射字段：
    OpenAI `usage`、Anthropic `input_tokens`/`output_tokens`（流式按 message_start +
    message_delta 合并）、Gemini `usageMetadata`、Ollama `prompt_eval_count`/`eval_count`；
    流式路径解析最终事件里的 usage，没有 usage 的响应保持 undefined（不报 0 假数据）
  - `packages/agent-core`：`AgentLoopOptions.onUsage` 每次上报本轮回调；
    `AgentContext.usage` 累计整个会话（跨多次 run 累加），错误路径也会带回已累计值
  - CLI：结果行后输出 `[usage] prompt=… completion=… total=…`（仅在有 usage 时）
  - 桌面端：新增 `usage` SSE 事件；UI 头部累加显示 "N tokens"
  - 文档：model / agent-core / cli / desktop 四个 README 同步
- 验证命令与结果：
  - `packages/model`：42 passed（新增 7 个：四个 provider 各一条解析 + OpenAI 流式 +
    Anthropic 流式合并 + 无 usage 时为 undefined）
  - `packages/agent-core`：28 passed（新增"跨 run 累计 + onUsage 上报"）
  - `apps/cli`：38 passed（新增 `[usage] prompt=21 completion=8 total=29` 输出用例）
  - `apps/desktop`：22 passed（新增 usage SSE 事件用例）
  - `pnpm build`、`pnpm typecheck`、`pnpm test`：全绿（TypeScript 255 个测试）
- 提交：见阶段 2 的 feat 提交
- 下一步：阶段 3 — MCP server 模式（把内置工具以 MCP 协议暴露，CLI `--mcp-server`）

### 运行 2 — 2026-09-11 07:19-07:35

- 阶段/工作项：阶段 1（补齐桌面端测试缺口）全部完成
- 做了什么：
  - 新增 `apps/desktop/tests/chat-session-e2e.test.mjs`：用 `node:http` 起本地
    OpenAI 兼容 stub（SSE），配真实 `ChatSession` + 真实 `startServer`，覆盖两条路径：
    1) 断开连接取消正在运行的命令：工具执行
       `touch started && sleep 1 && touch finished`，等 started 出现后断开客户端，
       断言 finished 始终不出现（证明命令被真正杀掉，而不是只是停止等待）
    2) `DEV_AGENT_MAX_CONTEXT_CHARS=400` 时，播种 12 条超长历史，断言发给 provider
       的请求里出现 `[context]` 提示、最旧条目被丢弃、最新条目保留
  - 测试内自行保存/恢复全部相关环境变量，互不污染
- 验证命令与结果：
  - `apps/desktop`：21 passed（新增 2 个端到端用例，取消用例 1.59s 完成）
  - `pnpm test`：全绿（TypeScript 245 个测试）
- 提交：见阶段 1 的 test 提交
- 下一步：阶段 2 — 会话用量统计（provider 解析 usage → AgentLoop 累计 → CLI/桌面端展示）

### 运行 1 — 2026-09-11 07:0x-07:4x

- 阶段/工作项：阶段 0（执行器取消协议）全部完成
- 做了什么：
  - 协议：`Envelope` 新增 `cancel = 5` 与 `CancelRequest { request_id }`；
    被取消的 Run 以 `ErrorResult { code: "CANCELLED" }` 结束，Cancel 本身不回包
  - Rust：`dev-agent-executor` 改为并发处理（读循环继续读 stdin，命令在 task 里跑），
    用 `request_id -> oneshot::Sender` 表跟踪在跑的请求；收到 Cancel 杀子进程
  - Rust：`LocalExecutor::run_cancellable` / `SandboxExecutor::run_sandboxed_cancellable`，
    取消与超时、输出截断一起参与 `select!`；`ExecutorError::Cancelled` 与
    `SandboxError::Cancelled` 映射为 `CANCELLED`
  - TS：`ExecutorRunOptions.signal`；`LocalExecutor` abort 时杀子进程并抛
    `ExecutorCancelledError`；`RustExecutor` abort 时发 Cancel 并等待运行侧回包，
    同时新增 `maxConcurrentExecutions`（默认 5，与 LocalExecutor 对齐）
  - 工具链：`ToolExecutionContext.signal` → `AgentLoop` 把 run 的 signal 传进去 →
    shell / git / search 转发给执行器
  - 顺手修掉两个既有问题：`ensureStarted` 并发首次调用会 spawn 两个 runtime 进程
    （现在用 in-flight promise 保护）；`dispose()` 后 `started` 未复位导致实例不可复用
  - 文档：`runtime/rust/README.md` 不再声称严格串行，改为"并发 + 可取消"；
    `packages/executor/README.md` 记录 signal / cancel / 并发上限
- 验证命令与结果：
  - `cargo test`：42 passed（新增 3 个：LocalExecutor 取消、sender 被丢弃不算取消、
    sandbox 取消）
  - `pnpm --filter @dev-agent/executor test`：39 passed（新增 4 个：LocalExecutor
    运行中取消、已 abort 的信号、RustExecutor 经 mock 发 Cancel、并发上限）
  - `pnpm --filter @dev-agent/executor test:integration`：9 passed，其中
    "cancels a running command" 用真实二进制把 `sleep 10` 在 104ms 内取消
  - `packages/agent-core`：27 passed（新增"signal 进入工具上下文"）
  - `packages/tools`：41 passed（新增"shell 工具把 signal 转发给执行器"）
  - `pnpm check/build/typecheck/test`：全绿（TypeScript 243 个测试）
  - `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`：通过
- 提交：见阶段 0 的 feat 提交
- 下一步：阶段 1 — 补齐桌面端测试缺口（真实 ChatSession 的中断端到端 + 上下文预算端到端）

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
