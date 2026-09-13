# v35 开发进度：验证证据与显式重跑

> 最后更新：2026-09-13

> 本文件记录当前实现状态、验证结果和下一步路线；具体接口约束以 `docs/day-plan-v35.md` 为准。

## 当前结论

v35 的前两项基础能力已经完成：

1. approved apply 产生的 validation result 会作为结构化 evidence 写入 session memory，并可在后续查询、CLI JSON 和 Desktop 导出/历史中读取。
2. applied change set 可以通过显式入口重跑 trusted validation。重跑不会接收模型提供的命令，不会自动修复或回滚文件，并会为每一次重跑生成独立 attempt id。

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

## 当前未完成

### Task 3：受限 validation policy

下一步实现三个代码内预定义 policy：

- `fast`：仅运行最小且快速的相关检查，适用于交互反馈。
- `default`：保持当前按 changed paths 派生的 package/Rust/diff checks。
- `strict`：在安全上限内补充更完整的 package 与 workspace 检查。

共同约束：policy 只能选择固定 check id 和固定 timeout 上限；配置只能声明 policy 名称，不能声明 executable、shell、args、任意工作目录或 diff 文本。未知 policy、非法 timeout 和注入字段都必须拒绝。

### Task 4：全量回归、文档和发布

Task 3 完成后再运行结构检查、全量 build/typecheck/test、executor integration、Rust fmt/clippy/test、diff check，并完成 README、CHANGELOG 和发布记录。

## 后续路线（在 v35 后）

1. **跨进程 change-set evidence（可选 v36）**：只持久化经过本地 apply 的可信 review、postimage hashes、working directory 和 state；加载时必须重新做路径约束、postimage 校验和 session 绑定，不能把 history JSON 当作无条件可信输入。
2. **可见的 validation 详情与筛选（可选 v36）**：支持按 change set、attempt、状态查看历史，但仍保持 evidence 与模型上下文分离。
3. **自动化回归守护（可选 v37）**：把已验证的 guard、cancel、no-auto-rollback 和 session isolation 纳入持续回归，避免后续 UI/CLI 扩展破坏安全边界。

## 工作约定

- 每项任务先写失败测试并确认 RED，再实现最小改动。
- validation 失败不触发 rollback；任何回滚都必须是显式用户动作，并经过 postimage guard。
- 不把命令字符串、shell、任意 args 或 diff 文本从模型输入传给 validation runner。
- 新进度必须同时更新 `docs/day-plan-v35.md` 与本文件。
