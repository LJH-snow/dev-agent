# day-plan v27 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v27.md`；结束前追加日志。

## 当前状态

- 当前阶段：已完成（阶段 0 + 阶段 1）
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 2（2026-09-12 17:3x-18:0x）
- 工作区：全部已提交并推送

## 日志

### 运行 1 — 2026-09-12 16:4x-17:3x

- 阶段/工作项：阶段 0（超时即取消工具）完成
- 做了什么：
  - `packages/agent-core/src/tools.ts`：`runTool()` 现在为每次调用建一个
    `AbortController`，把它的 signal 传给 `tool.execute(...)`；外层的运行中断
    信号也接进来（任一触发都 abort）。超时时 `abort()`，于是 `LocalExecutor`
    杀掉子进程、`RustExecutor` 发 `Envelope.cancel`
  - 用显式 `timedOut` 标志让超时结果**确定**：abort 会让工具在同一时刻 settle，
    谁赢 `Promise.race` 是抛硬币；现在无论工具是 resolve 还是 reject，
    只要确实是超时触发，返回的都是超时错误
  - 新增 `packages/agent-core/tests/tool-timeout-cancel.test.ts`（4 个用例）
  - 调整一个既有用例：`agent loop passes the run signal into tool execution
    contexts` 原本断言 signal **引用相等**；改为在工具**运行期间**断言运行中断会
    传播到工具（引用相等不是真正要保证的约束，且派生 signal 是本次修复的前提）
- 验证命令与结果：
  - 修复前后对照（`sh -c "sleep 3; echo ran > marker"`，工具超时 300ms）：
    - 修复前：304ms 返回超时错误，**3.5s 后 marker 被写出来**（命令继续跑完）
    - 修复后：309ms 返回超时错误，3.5s 后 marker **不存在**，且
      `pgrep -f "sleep 3"` 残留进程数为 **0**
  - 信号契约：外层 abort 仍能传播到工具（运行中断用例）；正常完成的工具不会被
    abort；超时后返回的仍是 `{"error":"Tool … timed out after …ms"}` 字符串
  - 时序稳定性：新用例连跑 **5/5** 通过（确认竞态已消除）
  - 首轮全量暴露 1 个既有断言失败（引用相等），已按上文改为行为断言
  - `packages/agent-core`：71 passed；`pnpm test`：**450 passed / 0 failed**
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 文档、完整回归矩阵、提交推送

### 运行 2 — 2026-09-12 17:3x-18:0x

- 阶段/工作项：阶段 1（文档 + 全量回归）完成
- 做了什么：
  - `packages/agent-core/README.md`：说明工具超时不只是报告，还会 abort 工具
    收到的信号（LocalExecutor 杀子进程 / RustExecutor 发 cancel），以及为什么
    ——否则"超时"的命令会继续跑并把副作用留下
  - 根 README：Current Status 增加该行为；Roadmap 增加第 57 项
  - `docs/CHANGELOG.md`：新增 v27 条目（含修复前后对照与竞态说明）
- 验证命令与结果：
  - `node scripts/check.mjs`：Structure check passed
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**450 passed / 0 failed**
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed
  - `cargo fmt --check` / `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）
- 提交：见 v27 的 fix / docs 提交
- 下一步：v27 计划已收尾

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
