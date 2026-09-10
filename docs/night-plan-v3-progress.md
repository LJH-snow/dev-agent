# night-plan v3 进度账本

> 每次自动运行开始前先读本文件与 `docs/night-plan-v3.md` 恢复上下文；
> 每次运行结束前把结果追加到下面的日志区。不要把外部内容粘进本文件。

## 当前状态

- 当前阶段：阶段 2（code-search 索引缓存）未开始
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 2（2026-09-11 00:08-00:35）
- 工作区：阶段 1 的改动已提交并推送

## 日志

### 运行 2 — 2026-09-11 00:08-00:35

- 阶段/工作项：阶段 1（Agent 上下文预算与自动裁剪）全部完成
- 做了什么：
  - `AgentLoop` 新增 `contextBudget?: { maxChars?: number }`；未配置时行为完全不变
  - 裁剪规则：始终保留 system prompt；从最近往前保留；`assistant(toolCalls)` 与其
    `tool` 结果按 toolCallId 成组保留；发生裁剪时在 system prompt 之后插入
    `[context] N earlier entries omitted`（system 角色，四个 provider 都会正确合并）
  - 额外规则：最新一条永远保留，即使它自己就超出预算，避免当前请求被裁掉；
    非法预算值（0 / 负数 / 非整数 / NaN）按未配置处理
  - CLI：新增 `resolveMaxContextChars`（`DEV_AGENT_MAX_CONTEXT_CHARS` > `maxContextChars`
    配置 > 无预算），并接进 AgentLoop
  - 桌面端：`ChatSessionOptions.maxContextChars` + 同名环境变量回退，接进 AgentLoop
  - 文档：`packages/agent-core/README.md`、`apps/cli/README.md` 记录新选项与环境变量
- 验证命令与结果：
  - `packages/agent-core`：24 passed（新增 6 个：裁剪计数、工具组成组、无预算直通、
    非法值忽略、system prompt 保留、最新条目保留）
  - `apps/cli`：37 passed（新增 4 个：解析器优先级/非法值，以及两个端到端用例——
    播种 12 条超长历史后，`DEV_AGENT_MAX_CONTEXT_CHARS=400` 时请求里出现
    `[context] N earlier entries omitted` 且最旧条目被丢弃；未设置时全量直通）
  - `node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`：全绿
    （TypeScript 221 个测试）
- 决策记录：桌面端只做了接线 + 类型检查，没有单独的端到端测试；阶段 4 会动桌面端，
  届时补一条覆盖 `DEV_AGENT_MAX_CONTEXT_CHARS` 的用例更合适。
- 提交：见阶段 1 的 feat 提交
- 下一步：阶段 2 — code-search 索引缓存

### 运行 1 — 2026-09-11 00:00-00:30

- 阶段/工作项：阶段 0（Rust 运行时输出配额）全部完成
- 做了什么：
  - 提交并推送了上一轮遗留的 Rust 测试修复与 v3 计划文档（两个提交）
  - proto：`RunRequest.max_output_bytes`（field 7）、`RunResult.bytes_truncated`（field 5），
    均为向后兼容的新增字段
  - Rust `LocalExecutor`：改为流式读取 stdout/stderr（不再 `wait_with_output`），
    超过每流上限时截断并杀掉子进程；未传字段时套用 1 MiB 默认值
  - TS `RustExecutor`：透传 `maxOutputBytes`（默认 1 MiB），解析 `bytesTruncated`
  - mock 二进制与 round-trip 测试同步新字段，新增 `truncate` 行为
  - 集成测试：真实二进制截断用例；顺手把硬编码的 `/usr/bin/python3` 换成
    `DEV_AGENT_TEST_PYTHON` 探测（否则本机 Xcode 桩会让沙箱用例误报）
  - 文档：`packages/executor/README.md`、`runtime/rust/README.md` 说明输出配额与
    单进程串行执行的事实
- 验证命令与结果：
  - `cargo test`：39 passed / 0 failed（新增 4 个）
  - `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`：通过
  - `pnpm --filter @dev-agent/executor test`：35 passed（新增 5 个）
  - `pnpm --filter @dev-agent/executor test:integration`：8 passed，其中
    "truncates output that exceeds maxOutputBytes" 断言真实二进制返回
    `bytesTruncated === true` 且 stdout 恰好 4096 字节
  - `pnpm build`、`pnpm typecheck`、`pnpm test`：全绿（TypeScript 211 个测试）
- 提交：见阶段 0 的 feat 提交
- 下一步：阶段 1 — Agent 上下文预算与自动裁剪

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
