# day-plan v25 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v25.md`；结束前追加日志。

## 当前状态

- 当前阶段：已完成（阶段 0 + 阶段 1）
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 2（2026-09-12 14:4x-15:2x）
- 工作区：全部已提交并推送

## 日志

### 运行 1 — 2026-09-12 13:5x-14:4x

- 阶段/工作项：阶段 0（RustExecutor 客户端兜底超时）完成
- 做了什么：
  - `packages/executor/src/rust-executor.ts`：
    - `RustExecutorOptions.requestTimeoutMs?: number`（默认 60000；`0` 表示
      不做客户端兜底，保持"真正无上限"语义）
    - `backstopFor(timeoutMs)`：调用方传了 `timeoutMs` 时兜底 =
      `timeoutMs + 5000ms 宽限`（让 runtime 自己的超时先正常返回）；
      否则用 `requestTimeoutMs`
    - 兜底触发时：先从 `pending` 删除该请求（**释放并发额度**），以
      `Rust executor did not answer "<command>" within <n>ms; restarting the runtime`
      拒绝，再 `dispose()` 掉这个 runtime 进程
    - 之所以必须 dispose：该 stdio 二进制严格串行处理 envelope，请求一旦卡住，
      排在后面的都已经排不到；只删 pending 条目并不能恢复
  - 新 fixture `packages/executor/tests/wedged-executor-binary.mjs`（可执行位已提交）：
    读 stdin 永不回包但保持存活
  - 新增 `packages/executor/tests/rust-executor-timeout.test.ts`（4 个用例）
  - **顺带修掉一个测试基建陷阱**：executor 的 `test` 脚本原本是显式文件列表
    （为把集成测试排除在外），所以新增的测试文件不会被 `pnpm test` 跑——
    第一次跑全量时总数仍是 437 才暴露出来。把集成测试改名为
    `real-rust-integration.integration.ts`（输出 `*.integration.js`，不再匹配
    `*.test.js`），单元测试恢复 `node --test tests-dist/*.test.js` glob，
    以后新增测试不会再被静默漏掉
- 验证命令与结果：
  - 修复前后对照（`/tmp/wedged-executor` 卡死 runtime）：
    - `run("echo", ["hi"], { timeoutMs: 400 })`：修复前 3s 后仍 pending
      -> 现在有兜底（`timeoutMs + 5s` 宽限）
    - `requestTimeoutMs: 400` 且不传 `timeoutMs`：**409ms 后 reject**，
      文案 `Rust executor did not answer "echo" within 400ms; restarting the runtime`
    - 并发额度：`maxConcurrentExecutions: 2` + 两个卡死请求后，修复前**每一次**
      后续调用都返回 `Concurrent execution limit reached (2)`；现在后续调用不再
      撞并发上限（证明额度已释放、runtime 已换新）
    - `requestTimeoutMs: 0`：仍然保持 pending（回归保护，语义未变）
  - `packages/executor`：44 passed（40 + 新增 4）；`test:integration`：10 passed
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**441 passed / 0 failed**
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 文档、完整回归矩阵、提交推送

### 运行 2 — 2026-09-12 14:4x-15:2x

- 阶段/工作项：阶段 1（文档 + 全量回归）完成
- 做了什么：
  - `packages/executor/README.md`：说明 `requestTimeoutMs` 默认值、`0` 的含义、
    `timeoutMs + 5s` 宽限规则，以及触发后会替换 runtime 进程的原因
    （stdio 二进制严格串行，卡住队首会让后面全部排不到）
  - 根 README：Current Status 增加该行为；Roadmap 增加第 55 项
  - `docs/CHANGELOG.md`：新增 v25 条目（含并发额度被永久耗尽的实测后果，
    以及测试基建陷阱的修复说明）
- 验证命令与结果：
  - `node scripts/check.mjs`：Structure check passed
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**441 passed / 0 failed**
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed
  - `cargo fmt --check` / `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）
- 提交：见 v25 的 fix / docs 提交
- 下一步：v25 计划已收尾

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
