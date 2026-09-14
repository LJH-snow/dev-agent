# v44 preview 输入契约与 bounded-work 安全评审

**评审日期：2026-09-14**

**状态：进行中；Task 0 完成，Task 1 进入 TDD。**

## Scope

本评审只覆盖 v43 的 metadata-only audit preview：

- agent-core 的 `createEvidenceAuditPreview()`、`serializeEvidenceAuditExport()`；
- CLI `--preview-evidence`；
- Desktop `GET /api/sessions/<id>/evidence/preview`；
- filters、错误边界、projection 工作量和宿主操作组合。

不把 preview 变成完整 evidence、执行输入、validation 输入、restore 凭证或 Undo
授权。v1 `EvidenceAuditExport`、pagination、schema v2、before-image 和跨进程 Undo
不在本次 runtime 变更范围内。

## v43 baseline

1. agent-core 先创建完整、稳定排序的 allowlist projection，再用
   `serializeEvidenceAuditExport()` 计算 canonical UTF-8 JSON bytes。
2. `EvidenceAuditPreview` 是独立 schema version 1，固定字段为
   `schemaVersion`、`sessionId`、`generatedAt`、`validationCount`、
   `changeSetCount`、`fileCount`、`serializedBytes`。
3. CLI 和 Desktop 都只读 selected session memory，复用
   `selectEvidenceForAudit()`，不调用 provider、workspace tool、chat queue 或
   rollback/validation API。
4. CLI 已拒绝 preview 与 export、cleanup、audit-limit flags 的组合；Desktop
   preview 已拒绝 `maxValidations`、`maxChangeSets`、`maxFiles`、`maxBytes` query。
5. preview success 和 generic error 都不返回 command、args、cwd、path、stdout、
   stderr、error text、diff、patch、file bytes、before-image、cursor 或 partial fields。

## Threat model

| 资产/边界 | 可能的输入 | 需要保持的性质 |
| --- | --- | --- |
| CLI argv | preview 与另一个操作 flag 组合 | preview 不应因分支优先级变成删除、索引、MCP、doctor 或执行操作 |
| Desktop URL | unknown/duplicate/empty query values | 语义要么明确且兼容，要么明确拒绝；不能悄悄改变 selected session |
| persisted memory | 损坏记录、非法路径、异常长字符串或大量 files | fail-closed；错误不回显 evidence；不得静默截断 |
| canonical projection | filters、sorting、UTF-8 字节计算 | CLI/Desktop/core 的 count 和 byte 语义一致 |
| preview response | 外部 caller | 只可用于选择 v41 limit，不能成为 execution/recovery authority |

## Findings and preliminary decisions

### 1. CLI operation precedence is a real proof gap — GO for hardening

当前 `--preview-evidence` 分支位于 `--index`、session delete/rename、doctor、MCP
server、tools、metadata、session-list、compact 等操作分支之后。仅靠后面的 preview
分支不能保证组合调用最终是 preview：例如 preview 与 `--index` 或
`--session-delete` 组合时，另一个操作可能先执行；preview 与 `--once` 虽然不会
执行 provider，但会被当成一个含义不清的组合。

**决定：**在 CLI 入口增加显式 preview-exclusive operation validation，并在任何
provider、MCP、workspace 或 session mutation 之前拒绝不兼容操作。只保留
`--session`、三个 evidence filters、`--json`/输出相关无副作用选项和 preview 本身。
该改动不改变 v1 export。

### 2. Desktop unknown/duplicate/empty query semantics — CONDITIONAL / preserve for now

当前 filter parser 对 query 使用 `URLSearchParams.get()`：重复值取第一个，空值被
视为未提供，未知 query 被忽略。这与 history/export 的既有兼容语义一致，且这些
值不会进入 preview response；但调用者可能因 typo 或重复参数得到意外的全量/首值
结果。

**决定：**本轮不直接收紧 Desktop query allowlist，不引入新 schema 或版本协商。
先保留当前语义并补齐 decision matrix；若未来要 reject duplicate/empty/unknown，
必须单独评估 client compatibility、错误码和迁移策略。

### 3. Full projection work can be large — CONDITIONAL / no silent cap

memory retention 对 validation/change-set record 有上限，但单个 change set 的 files
数量和字段长度仍可能使完整 projection 的构造和 canonical serialization 产生较大
CPU/memory 工作量。preview 的 `serializedBytes` 必须是完整 projection 的真实值，
不能通过截断来降低成本。

**决定：**本轮不加入未经证明的硬截断或隐式降级。需要进一步的 bounded-work
benchmark、单条 files 上限分析和明确 rejection contract；在证据不足前保持
CONDITIONAL，必要时另开实现计划。

### 4. Error and sensitive-field handling — GO for regression evidence

CLI preview 对失败只输出固定 `Evidence preview failed`；Desktop preview 对失败只
返回固定 `evidence preview failed`；core projection 本身只投影 allowlist。仍需用
损坏 memory、非法 path 和异常输入回归确认没有从外层错误路径泄露 persisted evidence。

**决定：**补 focused tests；若测试发现泄露，只做 generic metadata-only error 修复。

### 5. Cross-surface parity — GO for regression evidence

两宿主都使用 core preview 和同一 evidence filter selection。需要继续用相同 fixture
验证 count、file count、canonical bytes 的关系；不在宿主层各自计算 bytes。

## Out of scope / frozen boundaries

- 不增加 `partial`、`hasMore`、`nextCursor`、cursor binding 或 pagination endpoint；
- 不发布 schema v2 或 negotiation/fallback；
- 不持久化 before-image、patch、diff 或 file bytes；
- 不增加跨进程 Undo、restore authorization 或 historical command replay；
- 不把 `serializedBytes`、未来 digest 或 preview response 当作执行授权。

## Next evidence required

1. CLI operation-exclusive RED/GREEN tests，证明 preview 组合不会触发其他操作。
2. 损坏 memory / 非法 path generic-error tests，证明 preview 不回显敏感数据。
3. 一个跨 surface parity fixture，证明 filters、counts、file count 和 UTF-8 bytes
   均由 core 语义决定。
4. 如要处理 bounded work，先记录 benchmark 和 rejection design；没有证据就不改
   runtime。
