# v38 开发进度：metadata-only 审计导出与长期回归守护

> 最后更新：2026-09-13

> 详细目标和约束以 `docs/day-plan-v38.md` 为准。本文件记录每一步的实现、验证和后续路线。

## 当前状态

v37 已在 `d7b68a1` 完成全量验证并推送到 `origin/main`。v38 已建立计划，当前从 Task 0 的 before-image 与 metadata-only audit projection 边界评审开始；跨进程 Undo 暂不实现。

## 已完成

### v37 交付基线

- [x] evidence retention、applied guard 保护、rolled-back 状态同步和 metadata-only cleanup 已完成。
- [x] CLI/Desktop 已暴露结构化 evidence summary；v37 全量 TypeScript **593/593**、Executor integration **10/10**、Rust unit/doc **46/46** 通过。
- [x] v37 发布提交 `d7b68a1` 已推送，工作区保持干净。

### v38 计划与安全边界

- [x] 新建 `docs/day-plan-v38.md`，明确审计投影、before-image 设计评审、长期回归矩阵和验收标准。
- [x] 新建 `docs/evidence-audit-design-v38.md` 并完成 Task 0 评审，提交 `636947c`。

## 进行中

### Task 0：before-image 与导出边界设计评审

- [x] 列出 before-image 完整性、容量、敏感信息、用户确认、恢复失败和版本兼容决策；v38 明确不实现跨进程 Undo。
- [x] 定义 validation/change-set/retention summary 的导出 allowlist 和明确拒绝项，禁止内部 DTO 直接 dump。
- [x] 为 projection、CLI、Desktop 和长期回归矩阵写 RED 测试契约。
- [x] 设计记录：`docs/evidence-audit-design-v38.md`，提交 `636947c`。

## 后续任务

- [ ] Task 1：Agent-core metadata-only audit projection。
- [ ] Task 2：CLI/Desktop 只读导出入口。
- [ ] Task 3：长期 evidence 回归矩阵。
- [ ] Task 4：全量验证、文档和发布。

## 设计原则

- audit export 是固定字段 projection，不是内部 memory DTO 的 JSON dump。
- 任何 command、executable、args、cwd、output、error、diff、patch、文件内容、before-image 和宿主机绝对路径都不进入导出。
- 导出只读；cleanup 仍只改 memory metadata；两者都不能执行历史输入或触碰 working directory。
- `applied` guard 继续受保护，rolled-back evidence 不能重新激活，也不能因为导出而获得 Undo 能力。
- 不在 before-image 设计评审完成前实现跨进程 Undo。
