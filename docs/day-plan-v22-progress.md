# day-plan v22 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v22.md`；结束前追加日志。

## 当前状态

- 当前阶段：已完成（阶段 0 + 阶段 1）
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 1（2026-09-12 10:5x-11:4x）
- 工作区：全部已提交并推送

## 日志

### 运行 1 — 2026-09-12 10:5x-11:4x

- 阶段/工作项：阶段 0（暴露全部资源内容）与阶段 1（文档 + 全量回归）完成
- 做了什么：
  - `packages/mcp`：`McpStdioClient` 新增
    `readResourceContents(uri): Promise<readonly McpResourceContents[]>`，
    按顺序返回服务端给的全部 contents；`readResource(uri)` 保留为"取第一段"
    的便捷方法并在注释里写明这一点；空的 contents 仍是合法回答（返回 `[]`），
    `readResource` 在此时回退成 `{ uri }`
  - `McpClient` 接口同步新增该方法（两个既有测试桩补了实现）
  - `apps/cli`：`<prefix>:resource` 工具改用复数方法，把全部内容交给模型
  - 测试：`packages/mcp/tests/fake-mcp-server.mjs` 支持 `multi`（3 段）与
    `empty`（0 段）两种回答；新增 `mcp-resource-contents.test.ts`（3 个用例）
    与 `apps/cli/tests/mcp-resource-tool.test.ts`（1 个 e2e）
  - 文档：`packages/mcp/README.md`、根 README、CHANGELOG
- 验证命令与结果：
  - 修复前后对照（桩服务返回 3 段）：
    - `readResource()` 修复前只得到 `FIRST-PART`，另两段静默消失
    - 修复后 `readResourceContents()` -> `["FIRST-PART","SECOND-PART","THIRD-PART"]`，
      兼容方法仍返回 `FIRST-PART`
  - CLI e2e：桩模型调用 `fake:resource` 后，第二轮的 tool 消息里同时出现
    FIRST/SECOND/THIRD（修复前只有第一段）
  - `packages/mcp`：36 passed（33 + 新增 3）；`apps/cli`：88 passed（87 + 新增 1）
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**429 passed / 0 failed**
- 提交：见 v22 的 fix / docs 提交
- 下一步：v22 计划已收尾；另在验证途中发现新问题（见下），将开 v23

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| 11:2x | 验证 | 发现新缺陷：两个未命名的 MCP 服务器都用前缀 `mcp`，工具互相覆盖。实测把同一个桩服务器配置两次，本该 10 个 MCP 工具只剩 5 个（`tools.register` 按名字进 Map，静默覆盖）。命名规则见 `McpServerSession.prefix`（`config.name ?? "mcp"`） | 记录并开 v23 计划处理；v22 不扩大范围 |
