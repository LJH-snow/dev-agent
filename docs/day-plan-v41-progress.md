# v41 开发进度：audit export fail-closed 限额实现

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v41.md` 为准。本文件记录每一步的实现、验证和后续路线。

## 当前状态

v40 已在 `21fdb8f` 完成 metadata-only verification report、audit export 限额设计和完整门禁并推送到 `origin/main`。当前 v41 的 agent-core 限额契约和 CLI/Desktop 只读映射已完成，正在进入全量验证；分页、schema v2 和 before-image 仍不实现。

## 已完成

### v40 交付基线

- [x] 固定 release gate 支持默认无报告和显式 `.dev-agent/release-gate-report.json` metadata-only 报告。
- [x] audit export record/file/byte limit、canonical UTF-8 serialization、keyset pagination 和 schema negotiation 设计完成；v1 不静默截断。
- [x] v40 完整 `pnpm verify`：TypeScript workspace **600/600**、release-gate contract **9/9**、Rust unit/doc **46/46**、real-Rust integration **10/10**。

### v41 计划与边界

- [x] 新建 `docs/day-plan-v41.md`，明确 rejection-only limits、CLI/Desktop 映射和 v42 路线。
- [x] 继承 before-image 七项 NO-GO 闸门；本阶段不修改 memory schema，不实现跨进程 Undo。

## 已完成

### Task 1：Agent-core audit limit contract

- [x] 先写 RED 测试；首轮测试因限额 API 不存在而失败。
- [x] 新增 `EvidenceAuditLimits`、`EvidenceAuditLimitError`、固定 cap 和共享输入校验。
- [x] 完整 projection、稳定排序后检查 validations/changeSets/files 计数和 canonical UTF-8 JSON bytes；超限不返回 partial snapshot。
- [x] agent-core 聚焦回归 **116/116**，输入 evidence 保持不变，错误 JSON 只包含 `code/kind/limit/actual`。

### Task 2：CLI/Desktop 超限映射

- [x] CLI 增加 `--audit-max-validations`、`--audit-max-change-sets`、`--audit-max-files` 和 `--audit-max-bytes`。
- [x] Desktop evidence API 增加匹配的 `maxValidations`、`maxChangeSets`、`maxFiles`、`maxBytes` query 参数。
- [x] CLI **115/115**、Desktop **73/73** 聚焦回归通过；无效限额在 provider/session side effect 前拒绝，超限分别返回非零结构化 stderr / HTTP `413`。
- [x] 根文档、`docs/README.md`、CLI 和 Desktop README 已记录 cap、UTF-8 计量和 v1 fail-closed 语义。

## 进行中

### Task 3：全量验证、发布和下一阶段计划

- [ ] 运行完整 `pnpm verify` 和分阶段 gate。
- [ ] 复跑 report smoke、结构检查、diff check 和人工边界 review。
- [ ] 更新 CHANGELOG、进度和发布提交。

## 设计原则

- v1 只有完整 snapshot 或明确错误，不返回 partial/pagination/cursor。
- 限额检查只作用于完整 allowlist projection 和过滤后的稳定排序结果；错误不触碰 workspace/session memory。
- report、audit export 和 before-image 是相互分离的 metadata-only/NO-GO 边界。
- audit request caps 固定为 validations/changeSets 各 10,000、files 100,000、bytes 10,485,760；超限错误不回显命令、路径、输出或文件内容。
