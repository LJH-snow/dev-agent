# day-plan v15 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v15.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（收紧「总是允许」的键）未开始
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 01:2x-01:4x）
- 工作区：阶段 0 的改动待提交

## 日志

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
