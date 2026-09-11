# day-plan v15 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v15.md`；结束前追加日志。

## 当前状态

- 当前阶段：无，`docs/day-plan-v15.md` 的三个阶段已全部完成
- 已完成阶段：阶段 0、阶段 1、阶段 2
- 最近一次运行：运行 3（2026-09-12 02:0x-02:2x）
- 工作区：阶段 2 的文档改动提交后即 clean

## 日志

### 运行 3 — 2026-09-12 02:0x-02:2x

- 阶段/工作项：阶段 2（文档、全量回归与提交）完成
- 做了什么：
  - 根 `README.md`：审批键规则说明改为「最多两个前导参数」，测试数更新为
    403 TS + 46 Rust，Roadmap 追加 50-51（MCP reconnect、两参数键）
  - `packages/agent-core/README.md`、`docs/architecture.md`：同步新键规则
  - `docs/CHANGELOG.md`：新增「Day plan v15」条目（401 -> 403），记录 MCP
    reconnect 的负向验证与 npm run 键过宽问题
- 验证命令与结果（完整矩阵）：
  - `node scripts/check.mjs`：Structure check passed（13 目录 / 34 文件）
  - `pnpm build`：通过
  - `pnpm typecheck`：通过
  - `pnpm test`：403 passed / 0 failed
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed / 0 failed
  - `cargo fmt --check`：通过
  - `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）/ 0 failed
- 提交：见阶段 2 的 docs 提交
- 下一步：v15 计划已收尾；下一轮继续实测复现优先，优先看执行器/Rust 沙箱边界、
  MCP 服务端通知与桌面端长会话场景

### 运行 2 — 2026-09-12 01:4x-02:0x

- 阶段/工作项：阶段 1（收紧「总是允许」的键）完成
- 问题：`normalizeApprovalKey()` 只取第一个非选项 token，`npm run test` →
  `npm run`，于是批准后 `npm run build` / `npm run deploy` 不再询问；
  `git -C /repo status` → `git /repo`，同目录下其它 git 子命令共用该键
- 做了什么：
  - 键改为「命令名 + 最多两个前导非选项 token」：`npm run test` →
    `npm run test`、`git -C /repo status` → `git /repo status`，
    同时保持 `npm test`/`npm test -- --watch`、`git status`/`git status --short`、
    `chmod 777 x`/`chmod -R 777 x` 同键
  - agent-core 用例扩充：不同 npm 脚本不同键、同脚本带 flag 同键、
    `-C` 目录后的子命令不同键、chmod 同目标带/不带 `-R` 同键且不同目标不同键
  - 文档：README / agent-core README / architecture 的键规则说明同步
- 验证命令与结果：
  - `packages/agent-core`：60 passed（59 + 1；既有 normalize 断言按新语义更新）
  - `apps/cli`（`tests/approval.test.mjs`）：6 passed（always-allow 流程不变）
  - `apps/desktop`（`tests/approval-interactive.test.mjs`）：5 passed
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 403 个测试，0 失败）
- 提交：见阶段 1 的 fix 提交
- 下一步：阶段 2 — CHANGELOG + 完整回归矩阵 + 推送

### 运行 1 — 2026-09-12 01:2x-01:4x

- 阶段/工作项：阶段 0（MCP `reconnect()` 复位 `closed` 标志）
- 复现：读 `McpStdioClient` 发现 `close()` 设 `closed = true`、`connect()`
  不重置；`reconnect()` 走 close→connect，因此重连后的客户端在服务器崩溃时
  不会 reject 挂起请求
- 做了什么：
  - `connect()` 重置 `closed = false` 与 `buffer = ""`
  - `fake-mcp-server.mjs` 增加 `crash` 工具（收到即 `process.exit(1)`）
  - `mcp-reconnect.test.mjs` 增加用例：connect → reconnect → crash，
    用 `Promise.race` 断言 2 秒内 reject 且信息含 `exited`
  - 负向验证：临时删掉 `closed = false` 重建后该用例失败
    （`expected a rejection, got timeout`），恢复后通过
- 验证命令与结果（阶段 0 范围）：
  - `pnpm --filter @dev-agent/mcp build`：通过
  - `packages/mcp`：33 passed（32 + 1）
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 402 个测试，0 失败）
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 收紧 always-allow 键（最多两个前导参数）

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | - |
