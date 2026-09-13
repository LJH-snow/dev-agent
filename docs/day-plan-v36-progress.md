# v36 开发进度：跨进程变更集证据与安全重跑

> 最后更新：2026-09-13

> 本文件记录当前实现状态、验证结果和后续路线；详细接口约束以 `docs/day-plan-v36.md` 为准。

## 当前状态

v36 计划已建立，目标是解决 v35 明确留下的限制：change-set 状态此前只保存在当前进程内，应用重启后无法安全识别已应用变更集，因此不能继续使用显式 validation rerun。

本阶段先落地三条边界：

1. memory 只保存最小、结构化、session-bound 的 applied evidence。
2. 新进程恢复前必须重新校验 working directory、相对路径、文件类型、存在性和 postimage hash。
3. 恢复记录只允许只读 validation guard，不允许伪造 before-image，也不允许跨进程 Undo。

## 已完成

### 计划与范围

- [x] 新建 `docs/day-plan-v36.md`，记录目标、架构、文件边界、TDD 步骤、验收清单和完成后的 v37 路线。
- [x] 新建本进度文件，后续每个任务完成后同步更新。

## 进行中

### Task 0：evidence contract 与 memory 持久化

- [ ] 定义 `AppliedChangeSetRecord` 和文件级 evidence 类型。
- [ ] 为 `InMemoryMemory`、`FileMemory` 增加记录/读取/clear。
- [ ] 补齐旧 memory 兼容和非法记录测试。

### Task 1：FilesystemTool restore guard

- [ ] 增加恢复入口和 postimage-only guard。
- [ ] 覆盖 session/workdir/path/hash/type/rollback 边界。

### Task 2：AgentLoop、CLI、Desktop 生命周期

- [ ] 成功 apply 后写 evidence。
- [ ] 新进程/新 session 实例加载 evidence。
- [ ] 显式 rerun 在恢复成功和恢复冲突时都保持安全行为。

### Task 3：详情、筛选和兼容性

- [ ] 评估并补充 CLI JSON、Desktop history/export 的 evidence 摘要和筛选。
- [ ] 保持 evidence 与模型上下文分离。

### Task 4：全量回归、文档和发布

- [ ] 运行完整 TypeScript、Executor、Rust、结构检查和 diff check。
- [ ] 更新 README、CHANGELOG、本计划和本进度文件。
- [ ] 提交并推送 v36。

## 验证记录

- 计划建立日期：2026-09-13。
- 当前分支起点：v35 release commit `9b33aac`。
- 当前全量基线：TypeScript **565/565**、Executor real-Rust integration **10/10**、Rust unit/doc **46/46**。
- v36 新增测试和实现完成后，在这里追加聚焦测试、完整回归和发布提交。

## 后续路线

v36 完成后默认进入 v37：

1. 自动化回归守护：固定 restore、postimage conflict、session isolation、no-auto-rollback、cancellation 的回归矩阵。
2. evidence retention：有限保留、压缩、显式删除和安全审计。
3. 暂不实现跨进程 Undo；除非未来单独设计 before-image 的完整性、容量和用户确认机制。

## 工作约定

- 先写失败测试并确认 RED，再实现最小改动；每个任务独立提交。
- 不把 history JSON、diff、命令或任意路径当作可信执行输入。
- validation 失败、取消、超时、blocked 都不自动 rollback。
- 只有所有验收条件和全量回归通过后，才把 v36 标记为完成并进入 v37。
