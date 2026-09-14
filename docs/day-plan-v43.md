# Day plan v43：audit export canonical preflight 与只读 preview

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v42.md`。v42 冻结了 v1、将 pagination/schema v2 标为 CONDITIONAL、将 before-image 保持 NO-GO；v43 只增加一个独立的 metadata-only preflight/preview，不改变 v1 export，不实现分页、schema v2 或跨进程 Undo。

## Goal

让操作者在请求 v1 audit export 前获得稳定的记录数、文件数和 canonical UTF-8 JSON
字节数，以便选择合适的 rejection-only limit。preview 是独立的只读 schema，不携带
路径、命令、输出、文件内容或 before-image，也不能作为执行、restore、validation 或
rollback 输入。

## Architecture

- agent-core 继续先完成同一份完整 allowlist projection 和稳定排序；新增的 canonical
  serializer 统一 v1 byte budget 和 preview 的字节计量，避免 CLI/Desktop 各自估算。
- `EvidenceAuditPreview` 使用独立 schema version 1，只包含 `sessionId`、`generatedAt`、
  validation/change-set/file counts 和完整 projection 的 `serializedBytes`；v1
  `EvidenceAuditExport` 成功字段不增加 preview/partial/pagination 元数据。
- CLI 新增 `--preview-evidence`；Desktop 新增
  `GET /api/sessions/<id>/evidence/preview`。两个 surface 只读 session memory，绕过
  provider、chat queue、workspace 和执行边界。

## Global Constraints

- 不持久化 before-image、patch、diff、文件字节、命令、args、cwd 或绝对 working directory；不实现跨进程 Undo。
- preview 不能返回路径、命令、stdout/stderr、错误、秘密、文件内容或 session evidence；只返回固定 metadata allowlist。
- preview 不接受或生成 cursor、partial、hasMore、nextCursor、schema v2 negotiation 或恢复授权。
- `serializedBytes` 必须来自完整 canonical UTF-8 JSON projection，并使用
  `Buffer.byteLength(serialized, "utf8")`；不得按字符数估算或静默截断。
- 新增行为遵循 TDD：先写 RED 测试，再实现最小 serializer/preview 和宿主映射；完整门禁前不宣称交付。

## Task 0：v42 基线冻结

**Produces:** v1 不变和 preview 的独立边界。

- [x] **Step 1: 记录 v42 决策。** pagination/schema v2 为 CONDITIONAL，before-image/cross-process Undo 为 NO-GO。
- [x] **Step 2: 固化 preview allowlist。** 只允许 preview schema version、session id、生成时间、三类计数和 canonical bytes。
- [x] **Step 3: 写 v43 计划与进度文档。** 本计划记录实现和后续路线。

## Task 1：Agent-core canonical serializer 与 preview

**Produces:** 可复用、稳定计量的 `EvidenceAuditPreview`，不改变 v1 成功响应。

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/evidence.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/packages/agent-core/src/index.ts`
- Test: `/Users/Admin/Desktop/dev-agent/packages/agent-core/tests/memory.test.ts`

- [x] **Step 1: 写 RED 测试。** 覆盖 preview allowlist、稳定排序、UTF-8 多字节计量、三类计数、输入不变性和 v1 输出不变。
- [x] **Step 2: 运行聚焦测试确认 RED。** 预期 preview 类型/serializer 尚不存在而失败。
- [x] **Step 3: 写最小实现。** 统一 `serializeEvidenceAuditExport()` 与 byte budget；新增独立 preview schema 和计数 projection，不返回完整 evidence 内容。
- [x] **Step 4: 运行 agent-core 聚焦回归。** 确认 preview 和 v1 export 的 canonical bytes 一致，且无 workspace/session side effect；118/118 通过。
- [x] **Step 5: 提交。** 提交 agent-core canonical preflight contract。

## Task 2：CLI/Desktop preview surface

**Produces:** 两个宿主提供同一语义的只读 preview。

**Files:**

- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/src/index.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/src/server.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/cli/tests/validation.test.ts`
- Test: `/Users/Admin/Desktop/dev-agent/apps/desktop/tests/multi-session.test.ts`
- Modify: `/Users/Admin/Desktop/dev-agent/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/docs/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/cli/README.md`
- Modify: `/Users/Admin/Desktop/dev-agent/apps/desktop/README.md`

- [ ] **Step 1: 写 RED 测试。** CLI `--preview-evidence` 和 Desktop preview endpoint 返回固定 allowlist，拒绝/忽略不受支持的执行输入，并不加载 provider、进入 chat queue 或读写 workspace。
- [ ] **Step 2: 写最小实现。** CLI/HTTP 复用 filters、agent-core serializer 和 preview schema；preview 与 export/cleanup 的组合关系明确。
- [ ] **Step 3: 运行聚焦回归。** agent-core/CLI/Desktop 相关测试通过，v1 export 字段不变，preview byte count 使用 UTF-8 canonical bytes。
- [ ] **Step 4: 更新使用文档。** 说明 preview 只用于选择 limit，不是完整 evidence，也不提供分页或恢复能力。
- [ ] **Step 5: 提交。** 提交 CLI/Desktop preview surface。

## Task 3：全量验证、发布和下一阶段计划

**Produces:** v43 preview 可交付，v1/pagination/schema/before-image 边界继续有效。

- [ ] **Step 1: 运行完整 `pnpm verify`，并单独复跑 TypeScript/Rust gate。** 记录所有通过计数。
- [ ] **Step 2: 运行 report smoke、结构检查、diff check 和人工边界 review。** 确认 preview 不含敏感字段且不产生 workspace side effect。
- [ ] **Step 3: 更新 CHANGELOG、v43 progress 和使用文档。** 记录 preview schema 与 v1 compatibility。
- [ ] **Step 4: Commit and push。** 发布实现和文档到 `origin/main`。
- [ ] **Step 5: 新建 v44 计划。** 继续评估安全、可观测性或独立的兼容性小步，不默认进入 pagination/schema v2/before-image。

## Acceptance Checklist

- [ ] canonical serializer 与 v1 byte budget 使用同一 UTF-8 bytes。
- [ ] preview 只包含固定 metadata allowlist，不返回 evidence 内容或敏感字段。
- [ ] CLI/Desktop preview 不初始化 provider、不进入 chat queue、不访问 workspace，session 隔离保持不变。
- [ ] v1 export 成功 schema 不增加 preview/partial/pagination/cursor 字段。
- [ ] pagination/schema v2 仍为 CONDITIONAL；before-image/cross-process Undo 仍为 NO-GO。

## v43 完成后的后续路线

1. 若 preview 稳定，可在独立计划中评估带签名的 metadata digest，但不把 digest 当作执行授权。
2. pagination/schema v2 只有在 v42 的兼容性和 cursor proof gap 补齐后才可另开实现计划。
3. before-image 七闸门未全部具备可重复证据前，继续保持 production NO-GO。
