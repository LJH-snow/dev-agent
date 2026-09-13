# day-plan v34 进度账本

> 按 `/Users/Admin/Desktop/dev-agent/docs/day-plan-v34.md` 执行；每个 Task 完成后记录 RED/GREEN、实际测试数量、提交和失败原因。

## 当前状态

- 当前阶段：Task 4，CLI 验证展示和结构化输出
- v33 release：`4ee7ab7 docs: record v33 review workflow`，已推送到 `origin/main`
- 工作区基线：v33 release 后代码相对 `origin/main` 无修改；Task 0 计划与账本已提交
- v33 最近一次验证：TypeScript 512/512、Rust unit/doc 46/46、真实运行时集成 10/10 通过

## 阶段目标

- 根据已应用 change set 生成稳定、最小、不可注入的 validation plan。
- 只在 approved apply 完成后运行验证，并把 apply 成功与 validation 失败分开表达。
- 验证继承取消、超时、bounded output 和现有 executor/Rust sandbox 行为。
- CLI 与 Desktop 复用同一 validation DTO；MCP 无交互路径继续安全拒绝。

## Task 记录

| Task | 状态 | 实际结果 | 提交 |
|------|------|----------|------|
| Task 0 | 已完成 | structure check 通过；build/typecheck 通过；TypeScript **512/512**、Rust unit/doc **46/46**、real-binary integration **10/10** 通过 | `036c0b7 docs: add v34 validation plan` |
| Task 1 | 已完成 | RED 因 validation 导出/planner 不存在而失败；agent-core **80/80**、tools **98/98** 通过；planner 仅输出结构化 allowlisted commands | `82adf30 feat(validation): add change-set validation plans` |
| Task 2 | 已完成 | RED 因 runner 导出不存在而失败；tools **105/105**、agent-core **80/80** 通过；runner 复用 executor 并支持 bounded output/abort/stop-on-failure | `eb880b6 feat(validation): run bounded change-set checks` |
| Task 3 | 已完成 | RED 因 AgentLoop 无 validation 注入点而失败；agent-core **85/85** 通过；approved apply 后才规划/运行验证，失败不伪装 apply 失败 | `7adcf1d feat(agent): validate applied change sets` |
| Task 4 | 未开始 | - | - |
| Task 5 | 未开始 | - | - |
| Task 6 | 未开始 | - | - |

### Task 0：建立 v34 进度账本和验证基线（已完成）

- RED：无；本 Task 只建立计划与基线账本，不改变运行时代码。
- 基线：`4ee7ab7 (HEAD -> main, origin/main) docs: record v33 review workflow`；代码工作区干净，只有待提交的 v34 计划与账本。
- 验证：`node scripts/check.mjs` 通过（13 个目录、34 个预期文件）；`pnpm build`、`pnpm typecheck` 通过；TypeScript **512/512**；真实 Rust-binary integration **10/10**；Rust fmt、clippy 和 unit/doc **46/46**。
- 提交：`036c0b7 docs: add v34 validation plan`。

### Task 1：定义 validation contract 和确定性最小集合 planner（已完成）

- RED：首次 focused test 编译失败，`@dev-agent/agent-core` 没有 `ValidationCheck`/`ValidationPlan`/`ValidationResult`/`ValidationRunner`/`ValidationStatus` 导出，tools 也没有 `deriveValidationPlan`；修正测试 helper 后仍保持这些缺失导出的预期失败。
- GREEN：`pnpm --filter @dev-agent/agent-core typecheck`、build 与全套测试通过，agent-core **80/80**；tools build 与全套测试通过，tools **98/98**。
- 覆盖：单/跨 package TypeScript、test-only、Rust fmt/clippy/test、docs/config `git diff --check`、无变化/未知路径 skipped、重复/越界路径 blocked、稳定排序和 diff 文本不可进入命令；实际 change-set 的绝对路径会先归一化到 working directory。
- 实现：agent-core 新增 validation DTO、结构化 command、runner contract 和 deterministic id；tools 新增路径归一化 planner，固定 `pnpm`/`cargo`/`git` 可执行文件与参数，并补上 workspace dependency/lockfile。
- 提交：`82adf30 feat(validation): add change-set validation plans`。

### Task 2：实现受约束 runner、超时和取消（已完成）

- RED：首次 focused test 编译失败，tools 尚未导出 `createValidationRunner` 和 `ValidationRunnerOptions`，确认 runner contract 尚不存在。
- GREEN：`pnpm --filter @dev-agent/agent-core typecheck` 与全套测试 **80/80** 通过；tools typecheck 与全套测试 **105/105** 通过。
- 覆盖：成功/失败、失败后 skipped、executor timeout、运行前/运行中 abort、cwd/timeout/signal/maxOutputBytes 透传、UTF-8 bounded output、空/blocked plan，以及结构化 args 不经 shell 拼接。
- 实现：`createValidationRunner` 顺序运行 planner 生成的 command；复用现有 Executor 的进程终止、Rust cancel 和 quota；将非零退出、timeout、executor error、abort 归一化为 check result，并保留可审计 reason。
- 提交：`eb880b6 feat(validation): run bounded change-set checks`。

### Task 3：将验证接入 AgentLoop 的 apply 生命周期（已完成）

- RED：首次 focused test 编译失败，`AgentLoopOptions` 没有 `validation`，agent-core 没有 `ValidationAdapter`。
- GREEN：`pnpm --filter @dev-agent/agent-core typecheck` 与全套测试通过，agent-core **85/85**。
- 覆盖：approved apply 后才调用 planner/runner；deny、apply 错误和无 review 不触发；validation passed/failed/blocked 都写入模型可见 tool result；事件顺序为 tool-result → validation；validation planning/runner 非 abort 异常转为 blocked；外层 AbortSignal 透传且不自动 rollback。
- 实现：AgentLoop 新增可注入 `ValidationAdapter` 与 `onValidation` callback；仅识别带相同 changeSetId 的成功 `{ ok: true, action: apply }` 结果，验证结果与 apply 输出合并到同一 tool memory entry，保持 provider 的 tool-call 对应关系。
- 提交：`7adcf1d feat(agent): validate applied change sets`。

## 错误与卡点

| 时间 | Task | 问题 | 处理 |
|------|------|------|------|
| - | - | 暂无 | - |

## 后续路线

- Task 1：先锁定 validation DTO 和最小集合 planner，再实现 runner。
- Task 2：复用现有 executor 的取消、超时和输出配额，不重新实现进程终止。
- Task 3–5：接入 AgentLoop、CLI、Desktop，并保持 v33 Undo 与 review payload 不变。
- Task 6：全量回归、文档和发布；未完成前不宣称 v34 完成。
