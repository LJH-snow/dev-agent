# v38 开发进度：metadata-only 审计导出与长期回归守护

> 最后更新：2026-09-13

> 详细目标和约束以 `docs/day-plan-v38.md` 为准。本文件记录每一步的实现、验证和后续路线。

## 当前状态

v37 已在 `d7b68a1` 完成全量验证并推送到 `origin/main`。v38 的 Task 0、Task 1、Task 2、Task 3、Task 4 已完成，并已推送到 `origin/main`；下一步进入 v39 的 before-image 可行性闸门与发布门禁自动化设计；跨进程 Undo 暂不实现。

## 已完成

### v37 交付基线

- [x] evidence retention、applied guard 保护、rolled-back 状态同步和 metadata-only cleanup 已完成。
- [x] CLI/Desktop 已暴露结构化 evidence summary；v37 全量 TypeScript **593/593**、Executor integration **10/10**、Rust unit/doc **46/46** 通过。
- [x] v37 发布提交 `d7b68a1` 已推送，工作区保持干净。

### v38 计划与安全边界

- [x] 新建 `docs/day-plan-v38.md`，明确审计投影、before-image 设计评审、长期回归矩阵和验收标准。
- [x] 新建 `docs/evidence-audit-design-v38.md` 并完成 Task 0 评审，提交 `636947c`。

## 已完成

### Task 0：before-image 与导出边界设计评审

- [x] 列出 before-image 完整性、容量、敏感信息、用户确认、恢复失败和版本兼容决策；v38 明确不实现跨进程 Undo。
- [x] 定义 validation/change-set/retention summary 的导出 allowlist 和明确拒绝项，禁止内部 DTO 直接 dump。
- [x] 为 projection、CLI、Desktop 和长期回归矩阵写 RED 测试契约。
- [x] 设计记录：`docs/evidence-audit-design-v38.md`，提交 `636947c`。

### Task 1：Agent-core metadata-only audit projection

- [x] RED 测试覆盖稳定排序、相对路径校验、敏感字段排除、legacy 空 evidence 和输入不可变性。
- [x] 新增版本化 `EvidenceAuditExport` projection，显式排除 command、args、cwd、output、error、reason、workingDirectory、diff、patch 和 before-image。
- [x] 聚焦回归：首轮 agent-core **109/109** 通过；projection 代码不读取或写入 working directory。
- [x] 实现提交：`9e3beac`。

### Task 2：CLI/Desktop 只读导出入口

- [x] RED 覆盖 CLI 显式导出、provider 未加载、非法 status、Desktop schema、过滤、未知 session 和 memory 文件不变。
- [x] CLI `--export-evidence` 输出 versioned JSON；Desktop `GET /api/sessions/<id>/evidence` 输出同一 allowlist projection。两者均为只读，不初始化模型/MCP，不触碰 working directory。
- [x] 聚焦回归：agent-core **109/109**、CLI **114/114**、Desktop **73/73**。
- [x] 实现提交：`2439d09`；README、CLI/Desktop/tools 文档已同步更新。

### Task 3：长期 evidence 回归矩阵

- [x] 新增 table-driven lifecycle matrix，验证 applied guard 在过滤、retention 和显式 cleanup 后仍保留，rolled-back evidence 可清理且不会重新激活。
- [x] 增加 legacy memory、缺失 evidence、未知内部字段、坏路径、敏感字段排除、排序和输入不可变性检查。
- [x] v37 的 restore、postimage conflict、no-auto-rollback、cancellation、MCP denial 和 Rust sandbox 边界继续通过；本轮 agent-core **111/111**、tools **121/121**、CLI **114/114**、Desktop **73/73** 聚焦/相关回归通过。
- [x] 回归提交：`6e245a0`。

### Task 4：全量验证、文档和发布

- [x] README、CLI/Desktop/tools 文档、`docs/CHANGELOG.md`、v38 计划和进度已同步。
- [x] 发布门禁通过：结构检查、build、typecheck、TypeScript **600/600**、Executor real-Rust integration **10/10**、Rust unit/doc **46/46**、Rust fmt/clippy 和 `git diff --check`。
- [x] 人工边界 review 完成：projection 为固定 allowlist；导出与 cleanup 不触碰 workspace；绝对路径、命令、输出、diff、patch、before-image 和文件字节不进入导出；legacy memory 和 active guard 保持兼容。
- [x] 发布提交：`9084db1`，已推送到 `origin/main`。

## 后续任务

- [x] Task 1：Agent-core metadata-only audit projection。
- [x] Task 2：CLI/Desktop 只读导出入口。
- [x] Task 3：长期 evidence 回归矩阵。
- [x] Task 4：全量验证、文档和发布。

## 设计原则

- audit export 是固定字段 projection，不是内部 memory DTO 的 JSON dump。
- 任何 command、executable、args、cwd、output、error、diff、patch、文件内容、before-image 和宿主机绝对路径都不进入导出。
- 导出只读；cleanup 仍只改 memory metadata；两者都不能执行历史输入或触碰 working directory。
- `applied` guard 继续受保护，rolled-back evidence 不能重新激活，也不能因为导出而获得 Undo 能力。
- 不在 before-image 设计评审完成前实现跨进程 Undo。

## v38 交付结论

- [x] v38 验收清单全部完成；审计导出和 evidence 生命周期矩阵已成为可重复的发布前护栏。
- [x] 暂不实现跨进程 Undo；任何 before-image 能力必须先通过独立安全设计评审。
- [ ] 下一步：按 `docs/day-plan-v39.md` 评估 before-image 可行性闸门，并将 evidence 回归矩阵接入发布脚本。
