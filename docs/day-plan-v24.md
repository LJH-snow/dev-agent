# dev-agent 开发计划 v24

目标：MCP 客户端**没有任何请求超时**，一个不响应的服务器会把整个 CLI 挂死。

实测（桩服务器只读 stdin、从不回包）：

- `client.connect()` 3 秒后仍在 pending（`initialize` 没有超时）；
- 连接成功后 `client.listTools()` 3 秒仍在 pending，`pendingRequestCount` 停在 1；
- 端到端：`dev-agent --tools` 配了这样一个服务器时，6 秒后进程仍存活、
  stdout/stderr 全空，既没输出也没报错。

对比：服务器**命令不存在**时行为是正确的——立刻 `exit 1` 并打印
`spawn … ENOENT`。所以问题不是"容错策略"，而是"不响应 = 永久挂起"。

补充观察（不在本计划范围）：agent-core 的 `runTool` 有 30s 工具超时，
所以**运行中**的 MCP 工具调用最终会被上层超时兜住，但启动阶段
（`registerMcpTools` → `session.connect()`）没有任何兜底，而且超时后客户端
`pending` 里的条目不会被清理。本计划只修"永久挂起 + pending 泄漏"。

当前基线（v23 完成时已验证）：

- TypeScript 432 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：给 MCP 请求加超时（~1 小时）

任务：

1. `McpClientConfig` 增加 `timeoutMs?: number`，默认 30000，可用
   `DEV_AGENT_MCP_TIMEOUT_MS` 覆盖。
2. `McpStdioClient.request()` 在超时后：
   - 从 `pending` 中删除该条目（不再泄漏，`pendingRequestCount` 回落）；
   - 以 `McpRequestError(-32000, 'MCP request "<method>" timed out after <n>ms')`
     拒绝，错误信息里带方法名，便于定位是哪个服务器/哪一步。
3. `connect()` 复用同一条路径，因此 `initialize` 挂起会失败而不是永久等待；
   CLI 会像遇到 ENOENT 一样退出 1，并打印可读原因。
4. 正常响应的路径行为完全不变（含"先到先得"的并发 id 匹配）。

验收：

- mcp 新增 >= 4 个用例：
  - 不响应的 `listTools` 在超时后 reject（且错误里含方法名）
  - 超时后 `pendingRequestCount` 归零
  - `connect()` 在 `initialize` 不响应时 reject（不再挂起）
  - 慢但未超时的响应仍成功（回归保护）
- CLI 新增 >= 1 个用例：配置静默服务器时 `--tools` 在超时内以非 0 退出并给出提示
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/mcp/README.md` 与 `apps/cli/README.md`（超时配置）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v24-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
