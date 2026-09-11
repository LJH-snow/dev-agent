# day-plan v11 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v11.md`；结束前追加日志。

## 当前状态

- 当前阶段：无，`docs/day-plan-v11.md` 的四个阶段已全部完成
- 已完成阶段：阶段 0、阶段 1、阶段 2、阶段 3
- 最近一次运行：运行 4（2026-09-11 21:0x-21:2x）
- 工作区：阶段 3 的文档改动提交后即 clean

## 日志

### 运行 4 — 2026-09-11 21:0x-21:2x

- 阶段/工作项：阶段 3（文档、全量回归与提交）完成
- 做了什么：
  - 根 `README.md`：Current Status 增加 MCP 审批门禁、缓存 token 记账与
    索引自修复三条，测试数更新为 379 TS + 46 Rust；Roadmap 追加 37-39
  - `docs/architecture.md`：model 的缓存记账与 `cachedInputPerMillion`、
    tools 的损坏索引重写、CLI/MCP 的审批语义、agent-core 的缓存累计
  - `docs/CHANGELOG.md`：新增「Day plan v11」条目（368 -> 379）
- 验证命令与结果（完整矩阵）：
  - `node scripts/check.mjs`：Structure check passed（13 目录 / 34 文件）
  - `pnpm build`：通过
  - `pnpm typecheck`：通过
  - `pnpm test`：379 passed / 0 failed
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed / 0 failed
  - `cargo fmt --check`：通过
  - `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）/ 0 failed
- 提交：见阶段 3 的 docs 提交
- 下一步：v11 计划已收尾；下一轮先核实 `code-search` 与 `--index` 的
  文件类型/深度不一致问题，再决定 v12 计划

### 运行 3 — 2026-09-11 21:0x-21:1x

- 阶段/工作项：阶段 2（`code-search` 修复损坏的持久化索引）完成
- 做了什么：
  - 冷启动时先尝试读磁盘索引：成功则走既有增量路径；文件存在但解析失败
    （损坏、版本不符、字段缺失）时，全量扫描完成后把同一份
    `{ version, files, symbols, signatures }` 覆盖回该文件
  - 修复后的缓存标记为 disk-backed，后续增量变化继续按 v10 的规则回写；
    文件不存在时仍然不会创建索引，写失败仍静默忽略且 `persisted` 会体现
  - 文档：`packages/tools/README.md` 同步「缺失 vs 损坏」两种语义
- 验证命令与结果：
  - `pnpm --filter @dev-agent/tools build`：通过
  - `packages/tools`：62 passed（新增 1 个：损坏索引被重写为合法索引；
    v10 的「无索引不创建」用例保持全绿）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 379 个测试，0 失败）
- 提交：见阶段 2 的 feat 提交
- 下一步：阶段 3 — 根 README / architecture / CHANGELOG 更新 + 完整回归矩阵

### 运行 2 — 2026-09-11 20:5x-21:0x

- 阶段/工作项：阶段 1（缓存命中 token 的记账与计价）完成
- 做了什么：
  - `ChatUsage` 增加可选 `cachedPromptTokens`（包含在 `promptTokens` 内，
    无缓存时为 undefined，保持既有输出不变）
  - OpenAI 解析 `prompt_tokens_details.cached_tokens`；Anthropic 解析
    `cache_read_input_tokens`，并把 `cache_creation_input_tokens` 一并计入
    prompt token（缓存写入按普通输入价计），流式只在带 `input_tokens` 的事件
    上累加，避免 message_delta 重复计数
  - `ModelPrice` 增加可选 `cachedInputPerMillion`；`estimateCost` 对缓存部分
    按缓存价、其余按输入价计算，未配置时等价于原价，缓存数按 `promptTokens`
    截断；`addUsage` 同步累计缓存 token
  - 文档：model / cli README 同步语义
- 验证命令与结果：
  - `pnpm build`：通过
  - `packages/model`：52 passed（新增 6 个：OpenAI 缓存解析、Anthropic 缓存
    记账、流式不重复计数、缓存折扣计价、无缓存价回退、超量截断）
  - `packages/agent-core`：57 passed（新增 1 个 addUsage 缓存累计）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 378 个测试，0 失败）
- 提交：见阶段 1 的 feat 提交
- 下一步：阶段 2 — `code-search` 在全量扫描后重写损坏的索引文件

### 运行 1 — 2026-09-11 20:3x-20:5x

- 阶段/工作项：阶段 0（MCP 服务模式遵守审批策略）完成
- 做了什么：
  - `--mcp-server` 分支现在加载配置并解析审批模式，传入 `runMcpServer`；
    `ask` 在 MCP 模式等价于 `deny-dangerous`（没有交互通道）
  - 每个工具的 `execute` 先构造 `ApprovalRequest` 走 `denyDangerousPolicy`
    （含自定义 deny 模式与 `approval.allow` 白名单）；拒绝时抛
    `[denied by approval policy] …`，MCP 侧返回 `{ isError: true }`
  - 策略抛异常也按拒绝处理；`--approval allow` 与未配置时行为不变
  - 文档：`apps/cli/README.md` 说明 MCP 模式的审批语义
- 验证命令与结果：
  - `pnpm --filter @dev-agent/cli build`：通过
  - `apps/cli`（`tests/mcp-server.test.mjs`）：4 passed（新增 3 个：
    deny-dangerous 拦截工作目录外写入且放行安全命令、allow 模式不拦截、
    配置文件白名单放行 `chmod 777`）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 371 个测试，0 失败）
- 提交：见阶段 0 的 feat 提交
- 下一步：阶段 1 — `ChatUsage.cachedPromptTokens`（OpenAI / Anthropic 解析）
  与 `ModelPrice.cachedInputPerMillion` 计价

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | - |
