# day-plan v23 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v23.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（文档 + 全量回归）进行中
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 11:4x-12:2x）
- 工作区：阶段 0 的改动待提交

## 日志

### 运行 1 — 2026-09-12 11:4x-12:2x

- 阶段/工作项：阶段 0（让每个 MCP 服务器的前缀唯一）完成
- 做了什么：
  - `apps/cli/src/index.ts` 新增导出函数 `assignMcpPrefixes(names)`：
    单个未命名服务器保持 `mcp`；多个未命名按配置顺序变成 `mcp-1`、`mcp-2`…；
    显式命名不重复时沿用原名；重名的从第二个起追加 `-2`、`-3`…
  - `registerMcpTools()` 在注册前先算好唯一前缀，并把该前缀写回
    `serverConfig.name`，使 `McpServerSession` 与工具命名一致
    （冲突消歧必须在 `tools.register()` 之前完成，否则 Map 直接覆盖）
  - `McpServerSession.prefix` 语义保持不变，唯一化逻辑留在 CLI 装配层
  - 新增 `apps/cli/tests/mcp-prefix.test.ts`（3 个 e2e 用例，走 `--tools`）
- 验证命令与结果：
  - 修复前后对照（同一个桩服务器配置两次，每个贡献 5 个 MCP 工具）：
    - 两个未命名：修复前 5 个 `mcp:` 工具 -> 现在 **10 个**（`mcp-1:*` / `mcp-2:*`）
    - 两个同名 `fake`：修复前 5 个 -> 现在 **10 个**（`fake:*` / `fake-2:*`）
    - 单个未命名：仍是 5 个 `mcp:*`（回归保护，行为不变）
  - `assignMcpPrefixes` 直接调用：`[undefined]` -> `["mcp"]`；
    `[undefined, undefined]` -> `["mcp-1","mcp-2"]`；
    `["files","files","files"]` -> `["files","files-2","files-3"]`
  - `apps/cli`：91 passed（88 + 新增 3）
  - `pnpm typecheck`：通过
  - `pnpm test`：**432 passed / 0 failed**
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 文档、完整回归矩阵、提交推送

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
