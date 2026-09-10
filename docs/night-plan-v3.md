# dev-agent 夜间自动开发计划 v3

> 目标：用一晚（约 8 小时）把 dev-agent 从"功能闭环可用"推进到"沙箱路径与长会话在真实使用强度下可用"。
> 执行者按阶段顺序推进，每个阶段完成后运行对应的验收检查，全部完成后提交并推送。

当前基线（已验证）：

- `pnpm check`、`pnpm build`、`pnpm typecheck`、`pnpm test` 全部通过
- TypeScript 测试 206 个（model 29 / code-intelligence 24 / agent-core 18 / mcp 20 / executor 30 / tools 36 / desktop 16 / cli 33）
- Rust 测试 35 个全部通过，`cargo fmt --check` 与 `cargo clippy --all-targets -- -D warnings` 干净
- macOS `sandbox-exec` 与 Linux `bwrap` 双后端已激活，Starlark policy 生效
- CLI 与桌面端都能跑通完整链路

本计划要解决的五个缺口（均已在代码中确认）：

1. **Rust 运行时没有输出配额**：TS `LocalExecutor` 有 `maxOutputBytes`（默认 1MB）和
   `maxConcurrentExecutions`（默认 5），但 `RunRequest` protobuf 里没有对应字段，
   Rust 侧用 `wait_with_output()` 无上限收集输出。配置 `--rust-executor` 后配额被静默丢弃，
   一条刷屏命令就能吃满 Rust 进程内存。
2. **Agent 上下文没有预算**：`AgentLoop.buildMessages` 每轮把 memory 全量交给模型，
   `compact` 只能手动触发，长会话必然超出模型窗口。
3. **code-search 每次调用全量重扫**：`CodeSearchTool.execute` 每次都新建
   `InMemoryCodeIndex` 并重新读盘，`JsonFileCodeIndex` 已实现但没接进来。
4. **模型层没有重试与限流处理**：429 / 5xx / 网络抖动会直接让一轮对话失败。
5. **桌面端无法中断运行中的 agent**：没有 AbortSignal，且并发请求会互相污染共享 context。

---

## 阶段 0：Rust 运行时输出配额（~1.5 小时）

**问题**：见缺口 1。这是本计划里唯一的"安全性"问题，优先做。

**任务**：

1. `runtime/rust/proto/executor.proto`：
   - `RunRequest` 增加 `optional uint64 max_output_bytes = 7;`
   - `RunResult` 增加 `bool bytes_truncated = 5;`
2. `runtime/rust/src/local_executor.rs`：改为流式读取 stdout/stderr，累计超过上限时
   截断并终止子进程，返回 `bytes_truncated = true`；保持 `timeout_ms` 与
   `kill_on_drop` 的既有行为不变。
3. `packages/executor/src/rust-executor.ts`：同步内嵌的 `PROTO_STATIC`；
   `runSandboxed` 透传 `options.maxOutputBytes`（默认 1_000_000）；解析 `bytesTruncated`。
4. `packages/executor/tests/mock-executor-binary.mjs` 与 protobuf round-trip 测试同步新字段。
5. 并发问题不扩大范围：stdio 二进制逐条串行处理请求，天然并发为 1。在 Rust README 和
   代码注释里把这个事实写清楚，避免后续误判"缺配额"。

**验收**：

- `cargo test` 全部通过（新增 >= 3 个用例）
- `pnpm --filter @dev-agent/executor test` 通过
- 用真实二进制跑一条输出量超过上限的命令，确认 stdout 被截断且 `bytesTruncated === true`
- 旧行为回归：超时用例、正常用例、`runSandboxed` 用例全部保持通过

---

## 阶段 1：Agent 上下文预算与自动裁剪（~1.5 小时）

**问题**：见缺口 2。

**任务**：

1. `packages/agent-core/src/loop.ts`：`AgentLoopOptions` 增加
   `contextBudget?: { maxChars?: number }`（用字符数近似 token，不引入 tokenizer 依赖）。
2. 裁剪规则（必须严格遵守）：
   - 始终保留 system prompt；
   - 从最近往前保留，超出预算时丢弃最旧的条目；
   - `assistant(toolCalls)` 与其对应的 `tool` 结果必须成组保留，禁止拆散，
     否则 provider 会因"工具结果没有对应的工具调用"报错；
   - 发生裁剪时在 system prompt 之后插入一行 `[context] N earlier entries omitted`。
3. `apps/cli/src/config.ts`：新增 `maxContextChars` 配置项，优先级沿用
   `DEV_AGENT_MAX_CONTEXT_CHARS` 环境变量 > config 文件 > 默认值；CLI 与桌面端都接上。
4. 缺省行为必须完全不变：`contextBudget` 未配置时按原样全量传入。

**验收**：

- `packages/agent-core` 新增 >= 5 个测试：超预算裁剪、工具组成组保留、
  预算充足不动、非法配置忽略、system prompt 始终存在
- `pnpm test` 全绿
- 手工构造超长 memory，确认裁剪后仍能正常完成一轮对话

---

## 阶段 2：code-search 索引缓存（~1 小时）

**问题**：见缺口 3。项目一大，每次符号搜索都是 O(全部文件)。

**任务**：

1. `packages/tools/src/code-search.ts`：在工具实例内增加进程级索引缓存，
   按扫描根路径缓存索引与文件签名（`mtimeMs` + `size`）。
2. 第二次调用只重新扫描签名变化的文件，做增量更新而不是整树重读；
   删除的文件要从索引中移除。
3. 暴露一个只读的缓存统计（如 `hits` / `misses` / `rescanned`），既方便诊断也方便测试。
4. 不要改动 `Tree-sitter` 之类的重型方案，也不要新增依赖。

**验收**：

- `packages/tools` 新增 >= 3 个测试：二次调用命中缓存、文件修改后结果更新、
  文件删除后结果移除
- `pnpm --filter @dev-agent/tools test` 通过
- 对 dev-agent 自身跑一次符号搜索，两次连续调用的第二次明显更快（可用统计断言）

---

## 阶段 3：模型层重试与限流处理（~1 小时）

**问题**：见缺口 4。

**任务**：

1. `packages/model/src/` 新增重试工具（如 `retry.ts`）：指数退避 + jitter，
   支持 `Retry-After` 响应头（秒数与 HTTP-date 两种格式）。
2. 重试策略：
   - 429 与 5xx 重试；4xx（除 429）不重试；
   - 网络错误重试；
   - `streamChat` 只有在收到第一个 token 之前才允许重试，已开始输出后不得重试，
     否则会把重复 token 交给调用方。
3. 四个 provider（OpenAI / Anthropic / Gemini / Ollama）统一接入，保持现有签名兼容。
4. 重试次数与延迟可配置，默认值要保守（如 2 次重试、基数 250ms、上限 2s）。

**验收**：

- `packages/model` 新增 >= 5 个测试：429 重试成功、5xx 重试、4xx 不重试、
  `Retry-After` 被尊重、流式输出中途失败不重试
- `pnpm --filter @dev-agent/model test` 通过
- 默认参数下现有测试全部保持通过（不引入额外等待）

---

## 阶段 4：桌面端中断与并发保护（~1 小时）

**问题**：见缺口 5。

**任务**：

1. `AgentLoop.run` 增加可选的 `signal?: AbortSignal`（放在 run 的第三个参数里），
   并在以下位置检查/转发：每轮开始前、每个工具调用之间、传给 `model.chat` /
   `model.streamChat` 的 `ChatOptions.signal`。
2. `apps/desktop/src/chat-session.ts`：把 signal 透传到 `loop.run`。
3. `apps/desktop/src/server.ts`：`POST /api/chat` 在客户端断开时 abort；
   同一 session 正在运行时返回 409 而不是并发改写共享 context。
4. 中断时 SSE 必须先发一个 `error` 或 `done(aborted)` 事件再结束，不能留下悬挂连接。
5. 明确边界并写进文档：本阶段只保证模型请求与轮次之间可中断，
   正在执行的 shell 子进程不做强杀（Rust 侧取消协议超出本次范围）。

**验收**：

- `apps/desktop` 新增 >= 3 个测试：客户端断开触发 abort、并发请求返回 409、
  中断后 SSE 正常收尾
- `pnpm --filter @dev-agent/desktop test` 通过
- 现有 SSE 事件流测试保持通过

---

## 阶段 5：文档、回归与提交（~45 分钟）

**任务**：

1. 更新根 `README.md` 的 Current Status 与 Roadmap，反映 v3 的五个改动。
2. 更新 `docs/architecture.md`：上下文预算、索引缓存、重试策略、桌面端中断语义。
3. 更新 `apps/cli/README.md`（新增配置项）与 `runtime/rust/README.md`（输出配额与并发说明）。
4. 在 `docs/CHANGELOG.md` 顶部按既有格式记录 v3 变更。
5. 跑完整个验收矩阵：
   - `node scripts/check.mjs`
   - `pnpm build`
   - `pnpm typecheck`
   - `pnpm test`
   - `cd runtime/rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
6. 提交所有变更并推送到 `origin/main`。

**验收**：

- 上述命令全部通过
- 文档描述与代码行为一致，测试数量统计更新为真实值
- 变更已推送，工作区干净

---

## 执行约束

- 不引入新的外部框架或运行时依赖（测试内使用标准库或已有 devDependencies）。
- 保持现有代码风格与模块边界，不做计划之外的重构。
- 每个阶段结束后必须运行对应验收检查，不通过就地修复后再继续。
- 改动 protobuf 时保持向后兼容：新增字段一律 optional，旧二进制必须仍能通信。
- 涉及 macOS 沙箱的测试不要硬编码解释器路径，复用阶段 0 之前已加入的
  `DEV_AGENT_TEST_PYTHON` 探测机制。
- 每完成一个阶段提交一次；提交信息沿用仓库的 `feat:` / `fix:` / `test:` / `docs:` 约定。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3 > 阶段 4 > 阶段 5

先补安全缺口（沙箱配额），再解决长会话可用性（上下文预算），
然后是性能（索引缓存）、健壮性（重试）、交互（桌面端中断），最后统一收尾文档与提交。

## 预计产出

- Rust 运行时输出配额，protobuf 向后兼容扩展
- Agent 上下文预算与成组裁剪
- code-search 增量索引缓存
- 模型层统一重试与限流处理
- 桌面端中断与并发保护
- 新增约 20 个测试，TypeScript 测试约 226 个、Rust 测试约 38 个
- README / architecture / CHANGELOG / 各包 README 同步更新
