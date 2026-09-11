# dev-agent 开发计划 v8

> 目标：补上作为编程 agent 最关键的能力缺口——**改代码的方式**。现在模型只能整文件
> 重写（`filesystem write`），既慢又容易误伤；同时把大文件读取做成可按行范围取，避免
> 一次把上下文撑爆。顺带收掉 v7 留下的审批边界与索引落地。

当前基线（v7 完成时已验证）：

- TypeScript 329 个测试 + Rust 46 个测试（43 lib + 3 bin）全部通过
- 真实 Rust 二进制集成用例 10 个通过
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：编辑工具与按行读取（~1.5 小时）

**任务**：

1. `FilesystemTool` 增加 `edit` action：给定 `oldText` / `newText`，只在文件中
   **唯一匹配**时替换；0 处或多处匹配都返回可读错误（多处时告诉模型"补充上下文使其唯一"）。
2. `read` 支持 `offset`（1 起）与 `limit`（默认 2000 行）：返回
   `{ content, startLine, endLine, totalLines, truncated }`，让模型能分段读大文件。
3. 工具 schema 与描述同步更新，`createDefaultTools` 无需改动（同一个工具）。

**验收**：

- tools 新增 >= 5 个用例：唯一替换成功、0 匹配报错、多匹配报错、删除片段（`newText: ""`）、
  `offset/limit` 分页读与 `truncated` 标记
- `pnpm --filter @dev-agent/tools test` 与全量测试通过

---

## 阶段 1：审批覆盖 edit（~30 分钟）

**任务**：

1. `denyDangerousPolicy` 的"工作目录外写入"检查把 `edit` 与 `write` / `mkdir` 同等对待。
2. 文档说明 `edit` 与 `write` 受同一条策略约束。

**验收**：

- agent-core 新增用例：工作目录外的 `edit` 被拒绝、目录内的 `edit` 放行
- `pnpm test` 全绿

---

## 阶段 2：`--index` 命令（~1 小时）

**问题**：`JsonFileCodeIndex` 已实现却没有出口，`code-search` 也只在进程内缓存，
跨进程仍然要重扫。

**任务**：

1. CLI 新增 `--index <path>`：扫描目录（复用 `scanFile` + 与 code-search 相同的
   忽略规则），把索引写到 `<path>/.dev-agent/index.json`。
2. 输出统计（文件数、符号数、语言分布）；`--json` 输出机器可读结果。
3. 失败（路径不存在、不可写）时退出码 1 并给出明确错误。

**验收**：

- CLI 新增 >= 3 个用例：索引 TypeScript 目录并报告符号数、忽略 `node_modules`、
  路径不存在时报错
- `pnpm test` 全绿

---

## 阶段 3：审批决定记忆（~45 分钟）

**任务**：

1. CLI `ask` 模式新增第三个选项：输入 `a` 表示"本会话内总是允许这条命令"，
   记在进程内存里的 allowlist（不写磁盘）。
2. 桌面端在 `Ask` 提示条上加 "Always allow" 按钮，通过 `POST /api/approval`
   的 `decision: "allow-always"` 表达同一语义；服务端把该命令加入本次运行的允许集合。
3. 文档写明范围：只对本次会话/进程生效，不会持久化。

**验收**：

- CLI 与 desktop 各新增 >= 1 个用例：第一次询问选择"总是允许"后，同一命令第二次
  不再询问且直接执行
- `pnpm test` 全绿

---

## 阶段 4：文档、全量回归与提交（~45 分钟）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新 `packages/tools/README.md`、`apps/cli/README.md`、`apps/desktop/README.md`
3. 更新 `docs/architecture.md` 与 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v8-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完（实现 + 测试 + 验收命令），更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3 > 阶段 4
