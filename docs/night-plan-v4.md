# dev-agent 开发计划 v4

> 目标：把 v3 收尾时记录的遗留缺口逐个补上，重点让"中断"贯穿到正在执行的工具，
> 并把 dev-agent 自身变成一个可被其他 agent 使用的 MCP server。

当前基线（v3 完成时已验证）：

- TypeScript 237 个测试 + Rust 39 个测试全部通过
- 真实 Rust 二进制集成用例 8 个通过（含输出截断）
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

v3 遗留的缺口（本计划的输入）：

1. **运行中的工具调用无法取消**：桌面端中断只能停在"模型请求 + 轮次/工具之间"，
   已经跑起来的 shell 命令不会被杀掉。
2. **桌面端两处测试缺口**：`DEV_AGENT_MAX_CONTEXT_CHARS` 只有接线没有端到端用例；
   中断路径只有 fake session 的用例，没有真实 `ChatSession` 的验证。
3. **没有会话级用量统计**：长时间运行看不到 token 消耗。
4. **只能消费 MCP，不能提供 MCP**：dev-agent 的工具有价值，但无法被别的 agent 复用。

---

## 阶段 0：执行器取消协议（~2 小时）

**任务**：

1. 协议：`Envelope` 增加 `CancelRequest { uint32 request_id = 1; }`（field 5）。
   被取消的 Run 以 `ErrorResult { code: "CANCELLED" }` 结束；Cancel 本身不单独回包。
2. Rust 运行时改为并发处理：主循环继续读 stdin，命令在 task 里跑；
   用 `request_id -> oneshot::Sender` 的映射保存取消句柄，收到 Cancel 就杀掉子进程。
   请求结束（正常/超时/取消）后要从映射里移除。
3. `LocalExecutor` / `RestrictedExecutor` / `SandboxExecutor` 增加可选取消接收端，
   在 `select!` 中与超时、输出截断一起参与等待；取消走 `ExecutorError::Cancelled`
   与 `SandboxError` 的对应分支。
4. TS：`ExecutorRunOptions.signal`；`LocalExecutor` 在 abort 时 kill 子进程；
   `RustExecutor` 在 abort 时发送 Cancel 并等待运行侧的 `CANCELLED` 响应；
   `RustExecutor` 增加与 `LocalExecutor` 对齐的并发上限（默认 5）。
5. 工具层：`ToolExecutionContext.signal`；`AgentLoop` 把 run 的 signal 传进工具上下文；
   shell / git / search 工具把它转发给执行器。
6. 文档：`runtime/rust/README.md` 更新为"并发 + 可取消"，不再声称严格串行。

**验收**：

- Rust：新增取消用例（`sleep` 被取消且快速返回 `Cancelled`）
- TS：`LocalExecutor` abort 用例、`RustExecutor` 对 mock 的 Cancel 用例、
  agent-core "工具能从上下文拿到 signal" 用例
- 真实二进制集成：用 `AbortSignal` 取消 `sleep 10`，断言收到 `CANCELLED` 且耗时 < 1s
- `cargo test`、`pnpm test` 全绿

---

## 阶段 1：补齐桌面端测试缺口（~1 小时）

**任务**：

1. 用真实 `ChatSession` + 本地 stub provider 写一条端到端用例：
   客户端断开后，正在运行的命令被取消，SSE 以 `done { status: "aborted" }` 收尾。
2. 同一套 stub 下补 `DEV_AGENT_MAX_CONTEXT_CHARS` 的端到端用例：
   超长历史被裁剪、请求里出现 `[context] N earlier entries omitted`。

**验收**：

- `apps/desktop` 新增 >= 2 个用例，全部通过
- 不引入网络依赖（stub 用 `node:http` 起本地服务）

---

## 阶段 2：会话用量统计（~1.5 小时）

**任务**：

1. `packages/model`：解析各 provider 返回的 usage（OpenAI/Anthropic/Gemini/Ollama
   的字段名不同，统一成 `{ promptTokens, completionTokens, totalTokens }`），
   流式路径解析最终事件里的 usage。
2. `packages/agent-core`：`AgentContext` 或 memory 元数据里累计会话用量，
   `AgentLoop` 每轮把 usage 汇总进去，并通过 `onUsage` 回调抛出。
3. CLI：结果行展示本次与累计 usage；桌面端：`usage` SSE 事件 + UI 展示。
4. 缺 usage 的 provider/响应不得报错，按 0 处理。

**验收**：

- model 包新增 >= 4 个解析用例（四个 provider 各一）
- CLI/桌面端各有一条展示用法用例
- `pnpm test` 全绿

---

## 阶段 3：MCP server 模式（~2 小时）

**任务**：

1. 新增 `packages/mcp/src/server.ts`：基于 stdio 的 MCP server，实现
   `initialize`、`tools/list`、`tools/call`（复用 `@dev-agent/tools` 的内置工具）。
2. CLI：`--mcp-server` 以 MCP server 模式启动（不进入交互循环），把工具暴露给宿主 agent。
3. 工具调用的执行器沿用同一套配置（`DEV_AGENT_RUST_BINARY` 等）。
4. 文档：README 与 `packages/mcp/README.md` 说明双向 MCP 能力。

**验收**：

- 新增 MCP server 用例：initialize 握手、tools/list 列出内置工具、tools/call 执行成功与错误
- 用一段假的宿主脚本（JSON-RPC over stdio）跑通完整往返
- `pnpm test` 全绿

---

## 阶段 4：文档、回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap 增加 v4 各项）
2. 更新 `docs/architecture.md`（取消协议、usage 统计、MCP server 模式）
3. 更新 `docs/CHANGELOG.md`
4. 跑完整回归矩阵：
   `node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、
   `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送到 `origin/main`

**验收**：上述命令全绿，工作区干净，提交已推送。

---

## 执行约束

- 不引入新的运行时依赖；取消机制用 tokio 自带的 `oneshot`。
- protobuf 改动保持向后兼容（新增字段一律 optional / 新 oneof 分支）。
- 每个阶段结束跑对应验收；不通过就地修复再继续。
- 行为变化要同步文档，尤其是"单进程严格串行"这一条已被本计划推翻。
- 提交信息沿用 `feat:` / `fix:` / `test:` / `docs:` 约定。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3 > 阶段 4

先让中断真正生效（阶段 0），再补测试缺口（阶段 1），然后做用量可见性（阶段 2）与
对外提供能力（阶段 3），最后统一收尾。

## 预计产出

- 可取消的 Rust 执行器与 TS 侧 signal 贯通（模型 + 工具 + 子进程）
- 桌面端中断与上下文预算的真实端到端用例
- 会话级 token 用量统计（CLI + 桌面端可见）
- `--mcp-server`：把 dev-agent 的工具以 MCP 协议暴露
- 文档、CHANGELOG、全量回归
