# day-plan v11 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v11.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 2（`code-search` 修复损坏的持久化索引）未开始
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 2（2026-09-11 20:5x-21:0x）
- 工作区：阶段 1 的改动待提交

## 日志

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
