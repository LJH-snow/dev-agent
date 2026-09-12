# day-plan v24 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v24.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（文档 + 全量回归）进行中
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 12:5x-13:4x）
- 工作区：阶段 0 的改动待提交

## 日志

### 运行 1 — 2026-09-12 12:5x-13:4x

- 阶段/工作项：阶段 0（MCP 请求超时）完成
- 做了什么：
  - `packages/mcp`：
    - `McpClientConfig.timeoutMs?: number`（默认 30000）
    - `McpStdioClient.request()` 增加定时器：超时后从 `pending` 删除该条目，
      并以 `McpRequestError(-32000, 'MCP request "<method>" timed out after <n>ms')`
      拒绝；正常回包时清除定时器
    - `connect()` 在 `initialize` 失败时先 `close()` 再抛出——否则半开的连接会
      留着子进程不放，把整个 Node 进程吊住（错误已打印但进程不退出）
  - `apps/cli`：`DEV_AGENT_MCP_TIMEOUT_MS` > 配置项 `timeoutMs` > 默认值
  - 新 fixture：`silent-mcp-server.mjs`（默认不回任何包；
    `MOCK_MCP_ANSWER_INITIALIZE=1` 时只回 initialize）、`slow-mcp-server.mjs`
    （`MOCK_MCP_DELAY_MS` 后回包）
  - 测试：`packages/mcp/tests/mcp-timeout.test.ts`（4 个）、
    `apps/cli/tests/mcp-timeout.test.ts`（1 个）
- 验证命令与结果：
  - 修复前后对照：
    - `connect()` 对静默服务器：修复前 3s 仍 pending -> 现在 703ms 后
      reject（`MCP request "initialize" timed out after 700ms`）
    - 已连接后的 `listTools()`：修复前 3s 仍 pending、`pendingRequestCount` 停在 1
      -> 现在 700ms 后 reject 且计数回落到 **0**
    - 慢但未超时：`MOCK_MCP_DELAY_MS=300` + `timeoutMs=2000` 仍成功返回
    - CLI 端到端：修复前 `--tools` 配静默服务器时 6s 仍存活、stdout/stderr 全空；
      现在 **1.6s 内以退出码 1 报错**（`MCP request "initialize" timed out after 900ms`）
  - 顺带修掉一个**测试竞态**（v20 引入，本次全量回归在高负载下暴露）：
    `interactive.test.ts` 原来固定 sleep 再发 SIGINT，若 CLI 还没装上处理器，
    进程会被信号杀死（`code: null` 而非 130）。改为等待 banner 出现后再发信号
    （banner 与 `process.on("SIGINT", …)` 在同一同步块内，因此是可靠信号），
    连跑 5 轮该用例全过
  - `packages/mcp`：40 passed（36 + 新增 4）；`apps/cli`：92 passed（91 + 新增 1）
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**437 passed / 0 failed**
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 文档、完整回归矩阵、提交推送

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
