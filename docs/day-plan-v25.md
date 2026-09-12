# dev-agent 开发计划 v25

目标：`RustExecutor` 的请求**没有客户端兜底超时**，一个卡住的 runtime 会永久
占满并发额度，把沙箱能力彻底弄坏。

实测（一个读 stdin、从不回包、但保持存活的 executable）：

1. `executor.run("echo", ["hi"], { timeoutMs: 400 })` 在 3000ms 后仍然 pending
   —— `timeoutMs` 只是被转发给 runtime，TS 侧完全不做兜底，所以 runtime 卡住时
   这个值不会生效；
2. 后果更严重：把 `maxConcurrentExecutions` 设为 2，先发两个永不返回的请求，
   `pending` 里的条目永远不删；此后**每一次**调用都返回
   `Concurrent execution limit reached (2)`——该进程的沙箱能力永久失效，
   只能重启 CLI。

对照：runtime **崩溃**（进程退出）时行为是正确的，`child.on("exit")` 会
`rejectAll`。问题只出在"不响应但活着"。

补充事实（用于定方案）：`runtime/rust/README` 与 `docs/architecture.md` 都写明
该 stdio 二进制**一次只处理一个 envelope、严格串行**。也就是说，一旦某个请求
在客户端超时，排在它后面的所有请求都已经不可能被及时处理——只删掉 pending
条目并不够，必须把这个 runtime 进程换掉。

当前基线（v24 完成时已验证）：

- TypeScript 437 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：给 RustExecutor 加客户端兜底并支持恢复（~1.5 小时）

任务：

1. `RustExecutorOptions` 增加 `requestTimeoutMs?: number`（默认 60000）：
   - 调用方传了 `options.timeoutMs` 时，实际兜底为 `options.timeoutMs + 宽限`
     （宽限 5s，让 runtime 自己的超时先正常返回）；
   - 调用方没传 `timeoutMs` 时用 `requestTimeoutMs`；
   - `requestTimeoutMs: 0` 表示不做客户端兜底（保持"真正无上限"的语义）。
2. 超时触发时：
   - 从 `pending` 删除该请求（**释放并发额度**）；
   - 以清晰错误拒绝：带命令名与实际兜底时长；
   - 主动 `dispose()` 这个 runtime 进程，使下一次调用重新 spawn 一个干净实例
     ——否则被卡住的进程会一直占着串行队列，后续请求仍然永远排不到。
3. 正常路径行为不变：runtime 自己的超时仍以普通 `ExecutorResult` 返回；
   runtime 崩溃仍走 `rejectAll`。

验收：

- executor 新增 >= 4 个用例：
  - 卡住的 runtime：`timeoutMs: 300` 的请求在兜底后 reject（不再永久 pending）
  - 超时后并发额度被释放：同一个 executor 上第 3 次调用可以正常执行
  - `requestTimeoutMs: 0` 时不做客户端兜底（回归保护，仍是 pending）
  - 正常 mock runtime：结果不变
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/executor/README.md`（兜底语义、宽限、`0` 的含义、恢复行为）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v25-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
