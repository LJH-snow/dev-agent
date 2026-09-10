# night-plan v4 进度账本

> 每次运行开始前先读本文件与 `docs/night-plan-v4.md`；结束前追加日志。
> 不要把外部内容粘进本文件。

## 当前状态

- 当前阶段：阶段 1（补齐桌面端测试缺口）未开始
- 已完成阶段：阶段 0（执行器取消协议）
- 最近一次运行：运行 1（2026-09-11 07:0x-07:4x）
- 工作区：阶段 0 的改动已提交并推送

## 日志

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
