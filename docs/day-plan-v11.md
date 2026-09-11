# dev-agent 开发计划 v11

> 目标：补上三处仍然「半开」的边界——`--mcp-server` 模式完全绕过审批策略；
> provider 的缓存命中 token 没有被记账或计价；`code-search` 遇到损坏的索引只会
> 回退全量扫描、不会修复它。

当前基线（v10 完成时已验证）：

- TypeScript 368 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：MCP 服务模式遵守审批策略（~1.5 小时）

**问题**：`dev-agent --mcp-server` 在解析完参数后就 return，`--approval` 与
`~/.dev-agent/config.json` 的 `approval` 段完全不生效；宿主 agent 通过 MCP
调用 `shell` 时可以绕过 CLI 的危险命令策略。

**任务**：

1. `runMcpServer` 接收解析好的审批模式与编译后的规则；`allow` 保持现状（全部放行），
   `deny-dangerous` 与 `ask` 都用 `denyDangerousPolicy` 拦截（MCP 没有交互通道，
   `ask` 在服务模式下等价于拒绝，文档写明）。
2. 工具执行前构造 `ApprovalRequest` 并经过策略；命中拒绝时抛错，
   MCP 侧表现为 `{ isError: true }` 与拒绝原因，宿主模型可以换路。
3. 危险命令表与 `approval.allow` / `approval.deny` 配置复用 CLI 现有逻辑。

**验收**：

- `--approval deny-dangerous --mcp-server`：`filesystem write` 写到工作目录之外
  返回 `isError`；安全的 `echo` 调用正常返回
- `approval.allow` 命中的命令可以放行（>= 1 用例）
- `--approval allow --mcp-server` 行为与之前一致（>= 1 用例）
- `pnpm test` 全绿

---

## 阶段 1：缓存命中 token 的记账与计价（~2 小时）

**问题**：OpenAI 的 `prompt_tokens_details.cached_tokens` 与 Anthropic 的
`cache_read_input_tokens` 现在被丢弃，用量少算优惠部分；价格表也只能给一个
输入单价。

**任务**：

1. `ChatUsage` 增加可选 `cachedPromptTokens`（缓存命中的输入 token，包含在
   `promptTokens` 内）。
2. OpenAI 解析 `usage.prompt_tokens_details.cached_tokens`；Anthropic 解析
   `cache_read_input_tokens`；Gemini / Ollama 保持 undefined。
3. `ModelPrice` 增加可选 `cachedInputPerMillion`；`estimateCost` 在配置了该值时
   对缓存部分按缓存价、其余按输入价计算，未配置时保持原来的全量输入价。
   缓存 token 数量按 `promptTokens` 截断，避免脏数据算出负价。

**验收**：

- model 新增 >= 4 个用例：OpenAI 解析缓存 token、Anthropic 解析缓存 token、
  配置缓存价时按折扣计价、未配置缓存价时等价于原价
- 既有 usage 用例（无缓存字段）全绿，行为不变
- `pnpm test` 全绿

---

## 阶段 2：`code-search` 修复损坏的持久化索引（~45 分钟）

**问题**：v10 让 `code-search` 把「从磁盘加载后发生变化」的索引写回，但索引本身
损坏或版本不符时只回退全量扫描，坏文件会一直留在磁盘上，每次冷启动都要全量扫描。

**任务**：

1. 全量扫描路径记住「磁盘上存在索引文件但无法解析」；扫描完成后用同一份
   `{ version, files, symbols, signatures }` 覆盖该文件（文件已不存在时不创建）。
2. 写入失败静默忽略；`getCacheStats()` 的 `persisted` 同样计数，便于测试与诊断。

**验收**：

- tools 新增 >= 2 个用例：损坏索引被重写成合法索引、索引缺失时不创建
- v10 的 4 个索引读回用例保持全绿
- `pnpm test` 全绿

---

## 阶段 3：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新受影响的 README 与 `docs/architecture.md`
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v11-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3
