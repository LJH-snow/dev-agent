# night-plan v5 进度账本

> 每次运行开始前先读本文件与 `docs/night-plan-v5.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（上下文预算改为增量摘要）未开始
- 已完成阶段：阶段 0（优雅终止）
- 最近一次运行：运行 1（2026-09-11 09:0x-09:3x）
- 工作区：阶段 0 的改动已提交并推送

## 日志

### 运行 1 — 2026-09-11 09:0x-09:3x

- 阶段/工作项：阶段 0（优雅终止）全部完成
- 做了什么：
  - Rust：命令改为 `process_group(0)`（Unix）自成进程组；取消与超时统一走
    `terminate()` —— 先 `killpg(SIGTERM)`，等 2s 宽限期，仍在跑就 `killpg(SIGKILL)`，
    非 Unix 退回单进程 kill。这样 `sandbox-exec`/`bwrap` 这类包装进程的
    子进程也会一起收到信号，不再留下孤儿
  - 输出截断仍走立即结束（此时管道已停止读取，命令必然阻塞在写上）
  - TS `LocalExecutor`：spawn 加 `detached: true`（非 Windows），终止时先对进程组
    发 SIGTERM、2s 后升级 SIGKILL；取消、超时、截断三条路径共用同一个 `terminate()`
  - 文档：`runtime/rust/README.md`、`packages/executor/README.md` 说明终止序列
- 验证命令与结果：
  - Rust：43 passed（新增"子进程 `trap '' TERM` 时仍被结束，且耗时 >= 宽限期"
    用例，3.0s 内完成）
  - `packages/executor`：40 passed（新增同类 TS 用例，2055ms 完成）
  - `pnpm --filter @dev-agent/executor test:integration`：9 passed（真实二进制，
    沙箱取消用例仍快速通过）
  - `pnpm test`：263 passed / 0 failed；`cargo fmt --check`、
    `cargo clippy --all-targets -- -D warnings` 通过
- 提交：见阶段 0 的 feat 提交
- 下一步：阶段 1 — 上下文预算改为增量摘要（`contextBudget.summarize`）

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
