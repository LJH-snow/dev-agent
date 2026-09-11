# dev-agent 开发计划 v15

> 目标：继续「先复现、再修」。本轮收口两个「状态/键过宽」问题——
> MCP 客户端 `reconnect()` 之后 `closed` 标志没有复位，服务器再次崩溃时
> 挂起的请求不会 reject；审批「总是允许」键只取第一个非选项 token，
> `npm run test` 与 `npm run build` 会共享同一个 `npm run` 键。

当前基线（v14 完成时已验证）：

- TypeScript 401 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：MCP `reconnect()` 复位 `closed` 标志（已完成）

**证据**：`McpStdioClient.close()` 会设置 `closed = true`，`connect()` 不重置。
直接调用 `client.reconnect()`（先 close 再 connect）后，`closed` 一直是 true：
新子进程退出时 `child.on("exit")` 因为 `closed` 为真而跳过 `rejectAll`，
挂起的请求永远不会 reject。

**已做**：

1. `connect()` 重置 `closed = false` 与 `buffer = ""`。
2. `fake-mcp-server` 增加 `crash` 工具（收到后直接 `process.exit(1)`，不响应）。
3. 新用例：connect → reconnect → `callTool("crash")`，2 秒内必须 reject 且
   信息含 `exited`；用 `Promise.race` 保证失败时是断言失败而不是挂起。

**负向验证**：临时移除 `closed = false` 后构建运行该用例，得到
`expected a rejection, got timeout`；恢复后通过。

---

## 阶段 1：收紧「总是允许」的键（~1 小时）

**问题**：`normalizeApprovalKey()` 目前取命令名 + 第一个非 `-` token：

| 命令 | 当前键 | 后果 |
|------|--------|------|
| `npm test -- --watch` | `npm test` | 正确 |
| `npm run test` | `npm run` | 批准后 `npm run build` / `npm run deploy` 不再询问 |
| `git -C /repo status` | `git /repo` | 批准后同目录下的其它 git 子命令共用该键 |

**任务**：

1. 键改为「命令名 + 最多两个非选项 token」，保持既有等价性：
   `npm test` 与 `npm test -- --watch` 同键、`git status` 与
   `git status --short` 同键、`chmod 777 x` 与 `chmod -R 777 x` 同键。
2. `npm run test` 与 `npm run build` 必须不同键；`git -C /repo status` 与
   `git -C /repo push` 必须不同键。
3. 文档：README / architecture 中「命令 + 第一个子命令」的说明改成
   「命令 + 最多两个前导参数」。

**验收**：

- agent-core 新增 >= 3 个用例：不同 npm 脚本不同键、同一脚本带额外 flag 同键、
  `chmod` 带/不带 `-R` 同键
- CLI / desktop 的 always-allow 用例保持全绿
- `pnpm test` 全绿

---

## 阶段 2：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新受影响的 README 与 `docs/architecture.md`
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v15-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2
