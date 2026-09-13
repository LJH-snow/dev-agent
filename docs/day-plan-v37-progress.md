# v37 开发进度：证据生命周期与持续回归守护

> 最后更新：2026-09-14

> 本文件记录当前实现状态、验证结果和后续路线；详细约束以 `docs/day-plan-v37.md` 为准。

## 当前状态

v37 计划已建立，当前从 Task 0 开始。v36 已经让 applied change-set evidence 可以跨进程安全恢复，但 validation attempts 和历史 evidence 仍缺少明确的生命周期治理；本阶段先建立回归护栏，再实现“只清理非 active evidence”的 retention contract。

## 已完成

### 计划与范围

- [x] 新建 `docs/day-plan-v37.md`，记录 retention、cleanup、Undo 状态同步、回归矩阵、验收清单和 v38 路线。
- [x] 新建本进度文件，后续每个任务完成后同步更新。

## 进行中

### Task 0：建立持续回归矩阵

- [x] 为 restore、postimage conflict、session isolation、no-auto-rollback、cancellation 和 rolled-back state 建立 table-driven regression coverage；新增矩阵覆盖 session、working directory、postimage 和 rolled-back 四类 restore 阻断边界，并确认工作区字节不变。
- [x] 该任务仅增加 v36 安全语义的持续回归护栏，不修改运行时行为；tools 聚焦回归 **121/121** 通过。
- [x] 已完成提交：`bac8e76`。

### Task 1：Memory retention contract

- [x] 为 validation 上限、applied guard 保护、rolled-back 清理和并发写入建立失败测试。
- [x] `InMemoryMemory` / `FileMemory` 默认保留 100 条 validation 和 100 条 change-set evidence；超过 change-set 软上限时仍保护全部 `applied` records。
- [x] 增加 `pruneEvidence()`、`markChangeSetRolledBack()` 和防止 rolled-back evidence 重新激活的状态约束；清理只改 memory 元数据。
- [x] 聚焦回归：agent-core **105/105** 通过；非法上限、旧 memory、并发写入和跨实例持久化均覆盖。
- [x] 已完成提交：`8bfecbf`。

### Task 2：Undo 状态和显式 cleanup 生命周期

- [ ] 设计并实现 rollback 成功后的 durable state 同步与 session-bound cleanup。

### Task 3：CLI/Desktop 可见性、API 和文档

- [ ] 暴露 retention 摘要和结构化 cleanup 结果，同时保持旧 history/JSON 兼容。

### Task 4：全量回归、文档和发布

- [ ] 运行完整 TypeScript、Executor、Rust、结构检查和 diff check。
- [ ] 更新 README、CHANGELOG、本计划和本进度文件。
- [ ] 提交并推送 v37。

## 验证记录

- 计划建立日期：2026-09-14。
- v36 发布提交：`308b685`；进度记录：`49af56d`；已推送到 `origin/main`。
- v36 全量结果：TypeScript **580/580**、Executor real-Rust integration **10/10**、Rust unit/doc **46/46**。
- v37 当前没有新增运行时改动；Task 0 的聚焦测试结果将在首次实现后补充。

## 安全不变量

- persisted evidence 不成为执行输入；不存储命令、shell、diff、patch、文件内容或 before-image。
- 仍为 `applied` 的记录受保护；自动 retention 不得让跨进程 validation 失去安全 guard。
- cleanup 只改 session memory 元数据，不能创建、修复、覆盖、回滚或删除 working directory 中的文件。
- rollback 只有在 postimage guard 成功后才可将 durable record 标为 `rolled-back`；冲突、失败、取消和 blocked 均保持原状态。

## 后续路线

v37 完成后默认进入 v38：

1. before-image 完整性、容量和用户确认设计评审；不直接实现跨进程 Undo。
2. metadata-only 审计导出和长期回归矩阵。
3. 如 retention 的“active guard 受保护”语义在真实使用中仍不足，再单独设计显式 release 流程，不通过隐式删除解决。
