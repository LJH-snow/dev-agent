# Day plan v38：metadata-only 审计导出与长期回归守护

**建立日期：2026-09-13**

> 本计划承接 `docs/day-plan-v37.md`。v37 已完成 evidence retention、显式 cleanup、Undo 状态同步和完整发布门禁；v38 继续收紧 evidence 的对外可见边界，但不把跨进程 Undo 变成默认能力。

## Goal

为 CLI 和 Desktop 增加可审计、可过滤、只读的 metadata-only evidence 导出，并把 restore、retention、cleanup、rollback、validation、cancellation 固化成长期回归矩阵。导出必须可供调试或合规记录使用，同时不能泄露可执行输入、命令输出、diff、patch、文件字节、before-image 或宿主机绝对路径。

## Architecture

- `AgentMemory` 保留现有最小 evidence 存储；新增一个版本化的 allowlist projection，而不是直接序列化内部 `ValidationRecord` 或 `AppliedChangeSetRecord`。
- 审计 projection 只包含稳定的身份、状态、时间、计数、哈希和相对路径元数据；validation 的 executable/args/cwd/output/error/reason 等字段不进入导出。
- CLI 以显式、只读命令导出 JSON；Desktop 以选定 session 的只读 API 提供同一 projection。两者共享 agent-core 的投影逻辑，避免字段漂移。
- 导出和 cleanup 都不读取或写入 working directory，不执行历史命令，不恢复 before-image，不改变 memory 状态。
- 跨进程 Undo 暂不实现。只有在 before-image 完整性、容量、用户确认、恢复失败策略和敏感信息处理都通过单独设计评审后，才允许进入实现阶段。

## Global Constraints

- 新增接口必须向后兼容旧 `version: 1` memory；缺失 evidence 时返回空的、版本化的导出，而不是要求迁移。
- projection 使用固定字段 allowlist；内部 DTO 新增字段时，导出不会自动扩散字段。
- 不导出绝对 `workingDirectory`、validation command、shell、args、cwd、output、error、diff、patch、before-image 或文件内容。
- `path` 仅保留受 working-directory 约束的相对路径；路径必须使用 `/` 分隔，并拒绝 `..`、绝对路径和 NUL 字符。
- 导出按 session 隔离；未知 session、非法过滤器和不支持的格式必须显式返回错误。
- 导出只读且幂等；同一 memory 输入的投影字段顺序和排序稳定。
- v37 的 applied guard 保护、postimage conflict、session/workdir/path/type/existence 校验、no-auto-rollback、cancellation、MCP denial 和 Rust sandbox 边界保持不变。
- 新增行为遵循 TDD：先写预期失败测试并确认 RED，再写最小实现，先跑聚焦回归，再跑完整验证。

## 文件与边界

- Add/Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/memory.ts` 或独立 evidence projection 模块 — 定义版本化审计 DTO、字段 allowlist、稳定排序和空导出。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts` — 增加显式只读 evidence export 命令；默认输出不混入模型或普通 transcript。
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts` — 增加选定 session 的 JSON evidence export API，与现有 history filters 保持 session 隔离。
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/memory.test.ts`、`validation-lifecycle.test.ts` — projection allowlist、旧 memory、排序、敏感字段排除和输入不可变。
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`、`interactive.test.ts` — 显式命令、JSON 单对象输出、非法参数、无 workspace 副作用。
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/multi-session.test.ts`、`server.test.ts` — API 结构、session 隔离、过滤、未知 session 和只读性。
- Add/Modify: `/Users/Admin/Desktop/dev-agent/docs/evidence-audit-design-v38.md`、`README.md`、`apps/cli/README.md`、`apps/desktop/README.md`、`packages/tools/README.md`、`docs/CHANGELOG.md`、`docs/day-plan-v38-progress.md`。

## Task 0：before-image 与导出边界设计评审

**Produces:** 可审计的安全决策记录，不直接实现跨进程 Undo。

- [x] **Step 1: 写设计评审记录。** `docs/evidence-audit-design-v38.md` 明确 before-image 的完整性、容量、敏感信息、用户确认、恢复失败和版本兼容问题。
- [x] **Step 2: 定义 projection allowlist。** 已为 validation、change-set、retention summary 定义固定字段表、来源、稳定性和执行输入/文件内容排除规则。
- [x] **Step 3: 确认拒绝项和测试断言。** command、args、cwd、output、error、reason、absolute working directory、diff、patch、before-image 均列为禁止进入导出 JSON 的字段。
- [x] **Step 4: 提交设计记录。** `636947c`。

## Task 1：Agent-core metadata-only audit projection

**Produces:** 一个版本化、不可变、字段显式 allowlist 的 evidence audit snapshot。

- [x] **Step 1: 写 RED 测试。** 覆盖稳定排序、相对路径校验、敏感字段排除、旧 memory 空导出和输入对象不被修改。
- [x] **Step 2: 写最小实现。** `createEvidenceAuditExport()` 只读取已提供的 evidence 和 summary，显式重建 DTO，不改变 memory，不触碰 workspace。
- [x] **Step 3: 聚焦回归。** agent-core **109/109** 通过，包含 projection 的 allowlist、排序、路径和 legacy 空快照测试。
- [x] **Step 4: 提交。** `9e3beac`。

## Task 2：CLI/Desktop 只读导出入口

**Produces:** 两个宿主表面都能获取同一 schema 的 audit JSON。

- [x] **Step 1: 写 RED 测试。** CLI 显式命令和 Desktop API 在多 session、非法过滤、未知 session 下返回确定结果；首轮按预期暴露未知 CLI flag 和 Desktop `404`。
- [x] **Step 2: 写最小实现。** CLI `--export-evidence` 不初始化 provider/MCP；Desktop `GET /api/sessions/<id>/evidence` 不进入 in-flight chat 队列；两者不读写 working directory。
- [x] **Step 3: 聚焦回归。** agent-core **109/109**、CLI **114/114**、Desktop **73/73** 通过，输出不混入普通 transcript 或模型上下文。
- [x] **Step 4: 更新使用文档并提交。** README、CLI/Desktop/tools 文档已同步；实现提交 `2439d09`。

## Task 3：长期 evidence 回归矩阵

**Produces:** 发布前可重复运行的安全不变量矩阵。

- [x] **Step 1: 扩展 table-driven tests。** 新增 evidence lifecycle matrix，覆盖 applied/rolled-back 状态、status/change-set/validation 过滤、retention 上限、显式 cleanup、active guard 保留和审计投影结果；v37 既有 restore、rollback、validation、cancellation 的跨层回归继续作为组合基线。
- [x] **Step 2: 增加 projection schema/compatibility checks。** 覆盖旧 memory、缺失 evidence、未知内部字段、敏感字段排除、稳定排序、输入不可变性和绝对/逃逸/NUL 路径拒绝。
- [x] **Step 3: 检查 no-auto-rollback、MCP、Rust 边界未回退。** 既有 v37 回归矩阵与本次全量 TypeScript、Executor real-Rust integration、Rust unit/doc 验证均通过。
- [x] **Step 4: 提交回归护栏。** `6e245a0`。

## Task 4：全量验证、文档和发布

**Produces:** v38 审计导出可交付，且没有削弱 v37 安全边界。

- [x] **Step 1: 更新 README、CLI/Desktop/tools 文档和 CHANGELOG。** 增加 CLI `--export-evidence`、Desktop evidence API、allowlist/过滤规则和 v38 发布记录。
- [x] **Step 2: 运行结构检查、build、typecheck、全量 TypeScript、Executor real-Rust integration、Rust fmt/clippy/unit-doc 和 diff check。** 结构检查、build、typecheck、TypeScript **600/600**、Executor integration **10/10**、Rust unit/doc **46/46** 全部通过。
- [x] **Step 3: 人工 review。** 确认 audit export 是 projection 而不是内部 DTO dump；没有命令、输出、绝对 cwd、diff、patch、文件字节或 before-image；cleanup/export 都没有 workspace 副作用；旧 memory 和 active guard 行为保持兼容。
- [x] **Step 4: Commit and push。** 实现与回归提交已完成；发布文档提交后推送到 `origin/main`。

## Acceptance Checklist

- [x] 审计导出有显式 schema version、稳定排序和固定字段 allowlist。
- [x] CLI/Desktop 返回同一语义的 metadata-only projection，并保持 session 隔离。
- [x] 导出不包含可执行输入、命令输出、diff、patch、文件内容、before-image 或绝对 working directory。
- [x] 导出、cleanup、过滤均为只读或 metadata-only，幂等且不触碰 workspace。
- [x] 旧 `version: 1` memory 和缺失 evidence 字段继续可读。
- [x] v37 的 applied guard、restore、postimage、rollback、validation、cancellation、MCP 和 Rust 回归全部通过。
- [x] 未在设计评审完成前实现跨进程 Undo；before-image 仍不持久化。

## v38 完成后的后续路线

1. 如果审计投影在真实使用中需要更多字段，逐字段评审并增加兼容性测试，不直接暴露内部 DTO。
2. 只有完成 before-image 安全设计后，才评估受用户确认的跨进程恢复能力。
3. 将 evidence 矩阵接入每次发布前门禁，并保留可重复的失败诊断。
