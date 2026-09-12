# dev-agent 开发计划 v23

目标：MCP 服务器的**前缀会静默冲突**，导致工具凭空消失。

`McpServerSession.prefix` 是 `this.config.name ?? "mcp"`，CLI 用这个前缀给每个
服务器的工具命名（`<prefix>:tool`、`<prefix>:resource`、`<prefix>:prompt`），
再 `tools.register()` 进一个按名字索引的 Map。于是：

- 两个都**没写 name** 的服务器都用 `mcp`，后一个把前一个的工具全部覆盖；
- 两个**写了相同 name** 的服务器同样互相覆盖。

实测：把同一个桩服务器（5 个 MCP 工具）在 `DEV_AGENT_MCP_SERVERS` 里配两次且
不写 name，`--tools` 只列出 5 个 `mcp:` 工具，而正确数量应是 10 个；没有任何
警告。对使用多个 MCP 服务器的人，这是静默能力丢失。

当前基线（v22 完成时已验证）：

- TypeScript 429 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：让每个 MCP 服务器的前缀唯一（~1 小时）

任务：

1. 给服务器分配**确定性且唯一**的前缀：
   - 只有一个未命名服务器时保持 `mcp`（不破坏现有用法）；
   - 多个未命名服务器用 `mcp-1`、`mcp-2`…（按配置顺序）；
   - 显式命名且不重复的服务器继续用其 name；
   - 显式但重名的，第一个保留原名，其余追加 `-N` 消歧。
2. 冲突消歧必须在注册前完成，不能靠覆盖后再补——`tools.register()` 是
   `Map.set`，覆盖即丢失。
3. 保持 `McpServerSession.prefix` 的既有语义（会话自己的默认值），把唯一化
   逻辑放在 CLI 装配层，避免影响库的其它调用方。

验收：

- cli 新增 >= 3 个用例：
  - 两个未命名服务器：工具集合包含两组 `mcp-1:*` / `mcp-2:*`，总数翻倍
  - 两个同名服务器：第二个被消歧（`name` 与 `name-2`），工具不再互相覆盖
  - 单个未命名服务器：仍然使用 `mcp:`（回归保护）
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/mcp/README.md` 与 `apps/cli/README.md`（前缀分配规则）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v23-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
