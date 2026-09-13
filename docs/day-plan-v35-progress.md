# v35 开发进度：验证证据与显式重跑

> 最后更新：2026-09-13

> 本文件记录当前实现状态、验证结果和下一步路线；具体接口约束以 `docs/day-plan-v35.md` 为准。

## 当前结论

v35 的目标已经全部完成：

1. approved apply 产生的 validation result 会作为结构化 evidence 写入 session memory，并可在后续查询、CLI JSON 和 Desktop 导出/历史中读取。
2. applied change set 可以通过显式入口重跑 trusted validation。重跑不会接收模型提供的命令，不会自动修复或回滚文件，并会为每一次重跑生成独立 attempt id。
3. validation policy 已限制为代码内的 `fast`、`default`、`strict` 三个选项，且 planner 命令和 timeout 都有安全边界。

## 已完成

### Task 0：validation record contract

- `ValidationRecord` 增加 `recordedAt`。
- `InMemoryMemory` 和 `FileMemory` 支持写入、读取、clear 和旧 `version: 1` 文件兼容。
- evidence 不进入发给模型的普通 ChatMessage 上下文。
- AgentLoop 在发出 validation 事件后 best-effort 持久化，持久化失败不会伪造 apply 失败。
- 已完成提交：`3b55acd`。

### Task 1：查询与导出

- Desktop session history 返回 `messages` 与 `validations`。
- Desktop Markdown export 增加结构化 validation evidence。
- CLI `--json` 使用持久化 validation records。
- session 切换后可显示历史 validation card。
- 已完成提交：`0409e63`。

### Task 2：受 guard 保护的显式 rerun

- 核心复用 `runValidationAttempt`，支持 `createValidationAttemptId`，严格检查 planner/runner 的 change-set identity。
- Filesystem change-set guard 在回调前后校验 postimage，并在 rerun 与 rollback 之间保持串行。
- CLI 交互命令：`:validate <changeSetId>`。
- Desktop HTTP 入口：`POST /api/changesets/validate`；验证卡提供 rerun 按钮。
- rerun 失败、取消、超时或 blocked 不会写回用户文件；postimage 冲突以 blocked evidence 呈现。
- 验证门槛：agent-core **92/92**、tools **112/112**、Desktop **68/68**、CLI **108/108**、inline script **1/1**。
- 已完成提交：`c672859`。

### Task 3：受限 validation policy

- planner 支持三个代码内预定义 policy：`fast`、`default`、`strict`。
- `fast` 对源码变更只运行相关 typecheck，对 test-only 变更保留对应 test，Rust 只运行 fmt；`default` 保持 v34 的 changed-path checks；`strict` 在相关 package 或 workspace 配置变化时增加固定的 `pnpm typecheck` 和 `pnpm test`。
- timeout 只允许正整数，并受每类 check 的代码内上限约束；workspace strict timeout 也是固定值。
- CLI/Desktop 配置只允许选择 policy 名称；validation 配置中的 executable、shell、args、cwd、diff/check 定义等注入字段会被拒绝。
- 验证：agent-core **92/92**、tools **115/115**、Desktop **68/68**、CLI **109/109**，typecheck 和 `git diff --check` 通过。
- 已完成提交：`da635b0`。

### Task 4：全量回归、文档和发布

- README、CLI、Desktop、tools 文档已补充 validation evidence、显式 rerun、三种 policy、timeout 上限和配置拒绝规则。
- CHANGELOG 已记录 v35 的实现范围和验证结果；day plan 与本进度文件已收口。
- 完整验证通过：结构检查、build、typecheck、TypeScript **565/565**、Executor real-Rust integration **10/10**、Rust unit/doc **46/46**、fmt/clippy/test、`git diff --check`。
- 人工 review 确认旧 session migration、evidence 与模型上下文隔离、rerun/Undo guard、session isolation、no-auto-rollback、MCP 无交互拒绝和 Rust 进程清理边界保持不变。
- 本轮发布提交完成后推送到 `origin/main`。

## 后续路线（在 v35 后）

1. **跨进程 change-set evidence（可选 v36）**：只持久化经过本地 apply 的可信 review、postimage hashes、working directory 和 state；加载时必须重新做路径约束、postimage 校验和 session 绑定，不能把 history JSON 当作无条件可信输入。
2. **可见的 validation 详情与筛选（可选 v36）**：支持按 change set、attempt、状态查看历史，但仍保持 evidence 与模型上下文分离。
3. **自动化回归守护（可选 v37）**：把已验证的 guard、cancel、no-auto-rollback 和 session isolation 纳入持续回归，避免后续 UI/CLI 扩展破坏安全边界。

## 工作约定

- 每项任务先写失败测试并确认 RED，再实现最小改动。
- validation 失败不触发 rollback；任何回滚都必须是显式用户动作，并经过 postimage guard。
- 不把命令字符串、shell、任意 args 或 diff 文本从模型输入传给 validation runner。
- 新进度必须同时更新 `docs/day-plan-v35.md` 与本文件。
