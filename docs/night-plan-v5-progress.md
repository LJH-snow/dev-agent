# night-plan v5 进度账本

> 每次运行开始前先读本文件与 `docs/night-plan-v5.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 2（文档、回归与提交）未开始
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 2（2026-09-11 09:3x-10:0x）
- 工作区：阶段 1 的改动已提交并推送

## 日志

### 运行 2 — 2026-09-11 09:3x-10:0x

- 阶段/工作项：阶段 1（上下文预算改为增量摘要）全部完成
- 做了什么：
  - `ContextBudget` 增加 `summarize?: boolean`（默认 false，未开启时行为与之前完全一致）
  - 开启后，被裁掉的条目不再只留一行提示，而是调用一次模型生成 `[summary] …` 摘要；
    摘要按"新被裁掉的那一段"增量生成，已有摘要不重复总结
  - 摘要调用消耗的 token 计入会话 `usage` 并触发 `onUsage`（复用 v4 的统计链路）
  - 摘要失败（抛错）时回退到 `[context] N earlier entries omitted`，对话不中断
  - CLI：`DEV_AGENT_SUMMARIZE_CONTEXT` / `summarizeContext` 配置项；
    桌面端：`ChatSessionOptions.summarizeContext` + 同名环境变量
  - 文档：agent-core / cli / desktop 三个 README 同步
- 验证命令与结果：
  - `packages/agent-core`：33 passed（新增 5 个：摘要替换提示、只总结被裁部分、
    后续轮次增量总结、摘要 token 计入 usage、摘要失败回退；另含"未开启时不摘要"）
  - `apps/cli`：41 passed（新增配置解析用例 + 端到端：预算 400 + 开启摘要时，
    provider 收到的对话请求包含 `[summary] digest-text` 且没有 `[context]` 提示）
  - `pnpm check/build/typecheck/test`：全绿（TypeScript 270 个测试）
- 决策记录：摘要缓存保存在 AgentLoop 实例上。CLI 一个进程内复用同一个 loop，
  因此摘要只算一次；桌面端每次 `session.run` 会新建 loop，跨 run 会重新生成一次
  摘要——已在文档中说明，若后续需要跨 run 复用，应把摘要写进 memory 元数据。
- 提交：见阶段 1 的 feat 提交
- 下一步：阶段 2 — 文档、全量回归与提交

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
