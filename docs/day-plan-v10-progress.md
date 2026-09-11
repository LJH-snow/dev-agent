# day-plan v10 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v10.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 3（文档、全量回归与提交）未开始
- 已完成阶段：阶段 0、阶段 1、阶段 2
- 最近一次运行：运行 3（2026-09-11 20:4x-20:5x）
- 工作区：阶段 2 的改动待提交；`bf20461` 起的推送被 GitHub 403 阻塞
  （账号邮箱未验证，见错误与卡点）

## 日志

### 运行 3 — 2026-09-11 20:4x-20:5x

- 阶段/工作项：阶段 2（桌面端会话重命名 UI）完成
- 做了什么：
  - 会话选择器旁新增 `Rename` 按钮，`prompt()` 输入新 id 后 POST
    `/api/sessions/<id>/rename`；空输入/取消不发请求
  - 成功后用响应里的规范化 `to` 更新当前会话、重载列表与历史并提示
    `session renamed`；409 显示 `rename conflict`，其他失败显示 `rename failed`
  - 测试：静态资源用例增加断言（页面含 `rename-session` 控件与 `/rename` 调用），
    `multi-session` 的 3 个 rename API 用例保持全绿
  - 文档：`apps/desktop/README.md` 补 Rename 说明
- 验证命令与结果：
  - `apps/desktop`（`tests/server-edge-cases.test.mjs`）：11 passed
  - `apps/desktop`（`tests/multi-session.test.mjs`）：10 passed
- 提交：见阶段 2 的 feat 提交（本地；推送被 GitHub 邮箱验证问题阻塞）
- 下一步：阶段 3 — 文档、全量回归矩阵与推送收尾（推送需先解除 403）

### 运行 2 — 2026-09-11 20:2x-20:4x

- 阶段/工作项：阶段 1（会话用量持久化）完成
- 做了什么：
  - `AgentMemory` 增加可选 `recordUsage(usage)`；`InMemoryMemory` 在进程内累计，
    `FileMemory` 把累计写进会话文件的 `metadata.usage`
  - `AgentLoop` 收到 provider usage 时 `await memory.recordUsage(...)`，
    保证 `--once` 退出前已经落盘；`addUsage` 抽到 `usage.ts` 供 memory 复用
  - `SessionMetadata` 增加可选 `usage`；CLI `--metadata` 打印
    `Usage: prompt=… completion=… total=…`，`--session-list --json` 每个会话带
    `usage`（无记录时为 `null`），文本模式追加 token 数
  - 桌面端 `GET /api/sessions` 的 summary 带 `usage`，并用当前会话的模型与
    `pricing` 估算 `cost`；聊天头部在切换/刷新会话时恢复累计 token 与成本
  - 文档：agent-core / cli / desktop README 同步
- 验证命令与结果：
  - `pnpm build`：通过（一处 import 别名写错，修正后重跑全绿）
  - `pnpm typecheck`：通过
  - `packages/agent-core`：56 passed（新增 3 个：InMemory 累计、FileMemory
    跨实例读回、loop 落盘）
  - `apps/cli`（`tests/cli-e2e.test.mjs`）：6 passed（新增 1 个 metadata usage）
  - `apps/desktop`（`tests/multi-session.test.mjs`）：10 passed
    （summary 断言带 usage 与 cost）
  - `pnpm test`：全绿（TypeScript 368 个测试，0 失败）
- 提交：见阶段 1 的 feat 提交
- 下一步：阶段 2 — 桌面端会话重命名 UI（Rename 按钮 + prompt + POST，
  HTML 冒烟断言）

### 运行 1 — 2026-09-11 20:0x-20:2x

- 阶段/工作项：阶段 0（`--index` 增量刷新与 code-search 回写）完成
- 做了什么：
  - `indexDirectory` 现在先 stat 全树拿签名，再读回旧的
    `.dev-agent/index.json`（version 1、字段合法时）：签名一致的文件的
    sources 与 symbols 直接复用，不再读盘；变化/新增文件重扫；消失的文件
    自然被排除。索引损坏时退回全量扫描
  - `IndexReport` 增加 `reused` 计数，文本输出为
    `Indexed N files / M symbols (K reused)`，`--json` 同步带该字段
  - `CodeSearchTool` 从磁盘索引启动且增量比对确实改动索引时，把刷新后的
    `{ version, files, symbols, signatures }` 写回原文件；只在文件已存在时
    回写，写失败静默忽略；`getCacheStats()` 增加 `persisted`
  - `InMemoryCodeIndex` 增加 `listSymbols()`（写回时枚举当前符号）
  - 文档：`packages/tools/README.md`、`apps/cli/README.md` 同步新语义
- 验证命令与结果：
  - `pnpm build`：通过
  - `pnpm typecheck`：通过
  - `packages/tools`：61 passed（新增 4 个：改动后回写、未变化不重写、
    无索引不创建、写失败不影响搜索）
  - `packages/code-intelligence`：25 passed（`listSymbols` 为新增 API）
  - `apps/cli`（`tests/index-command.test.mjs`）：4 passed（新增 1 个：
    二次 `--index --json` 的 `reused` 与符号更新）
  - `pnpm test`：全绿（TypeScript 364 个测试，0 失败）
- 提交：见阶段 0 的 feat 提交
- 下一步：阶段 1 — 会话用量持久化（`AgentMemory.recordUsage`、
  `SessionMetadata.usage`、CLI `--metadata`、桌面端 summary）

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| 2026-09-11 20:4x | 阶段 1 推送 | GitHub 返回 403：`You must verify your email address`（HTTPS 与 SSH 均不可用，SSH 无公钥） | 提交保留在本地，继续做剩余阶段并周期性重试；需要账号邮箱在 github.com/settings/emails 验证后才能推送 |
