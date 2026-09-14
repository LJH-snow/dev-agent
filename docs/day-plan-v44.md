# Day plan v44：preview 输入契约与 bounded-work 安全评审

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v43.md`。v43 已交付 canonical serializer、独立
> `EvidenceAuditPreview`、CLI `--preview-evidence` 和 Desktop preview endpoint。
> v44 只评审 preview 的输入歧义、失败边界与工作量上限；不默认修改 v1 export、
> 不实现 pagination、schema v2、before-image 或跨进程 Undo。

## Goal

确认 metadata-only preview 在重复/未知输入、损坏或异常大的 persisted evidence、
以及 CLI 操作组合下仍然 fail-closed、无敏感泄露、无 workspace side effect，并决定
是否需要最小的兼容性安全加固。若缺少可重复证据，保持 design-only，不直接扩大 runtime
行为。

## Review questions

- Desktop preview 对未知 query、重复 filter、空值和编码值的语义是否明确且可重复？
- CLI preview 与 `--once`、`--mcp-server`、`--doctor`、`--cleanup-evidence`、
  `--export-evidence` 等操作组合是否应拒绝，而不是依赖分支优先级？
- preview 为计算完整 canonical UTF-8 bytes 需要构造完整 projection；在 v41 的
  10,000 records / 100,000 files / 10 MiB export caps 之外，是否还存在可证明的
  memory、CPU 或单条 files 数量风险？
- 损坏 memory、非法 evidence path、异常字符串和 projection error 是否始终只返回
  generic metadata-only failure，不回显 path、command、output、error 或 file bytes？
- CLI 与 Desktop 是否保持同一个 filter、count、file-count、byte-count 语义？

## Global constraints

- v1 `EvidenceAuditExport` 成功 schema 不变；不增加 preview/partial/cursor 字段。
- 不实现或暗示 pagination、schema v2 negotiation、restore、rollback、before-image
  或跨进程 Undo authority。
- 不把 digest、serializedBytes 或 preview 当作执行授权、validation 输入或恢复凭证。
- 不静默截断 canonical projection；任何工作量/大小保护都必须是明确的 metadata-only
  rejection，并提供可测试的 reason/code，不泄露 evidence 内容。
- 新增 runtime 行为继续遵循 TDD；先写 RED 测试并确认失败，再实现最小改动。

## Task 0：v43 基线与威胁模型

**Produces:** v44 的兼容性边界和 review evidence。

- [x] **Step 1: 固化 v43 contract。** 记录 preview 固定字段、标准 filters、
  `/evidence` 独占 audit limits、generic error、no-store 和 session isolation。
- [x] **Step 2: 画出输入/信任边界。** 区分 URL/argv、session id、persisted memory、
  canonical projection、preview response；列出敏感字段和 side effects。
- [x] **Step 3: 建立 decision matrix。** 对 unknown query、duplicate value、empty value、
  malformed memory、oversized projection、组合 flags 给出 preserve/reject/defer 决定；
  详见 `docs/evidence-preview-input-matrix-v44.md`。

## Task 1：安全评审与可重复证据

**Produces:** review document and focused regression cases; no runtime change unless a
proof gap is found.

- [x] **Step 1: 检查当前实现。** 确认 core/CLI/Desktop 的 allowlist、sorting、UTF-8
  measurement、error handling 和 side-effect behavior 没有分叉；发现并记录 CLI
  operation precedence proof gap。
- [x] **Step 2: 先写 RED tests。** 为 preview 与 14 类竞争 CLI 操作组合写测试并确认旧实现
  先失败；未对 Desktop query 或 bounded-work 做 speculative API。
- [x] **Step 3: 形成 decision。** CLI operation isolation 标记 GO 并已实现；Desktop query
  tightening 与 bounded-work cap 标记 CONDITIONAL，继续 design-only。

## Task 2：最小兼容性加固（条件执行）

**Produces:** only if Task 1 proves a concrete gap.

- [x] **Step 1: TDD implement.** 仅实现已证明的 CLI operation-exclusive validation；
  不加入 preview query allowlist、bounded-work cap、truncation 或 cursor。
- [x] **Step 2: 对 CLI/Desktop/core 做 parity 回归。** CLI 118/118、agent-core 118/118、
  Desktop 74/74；v1 export regression 保持通过。
- [x] **Step 3: 若无足够证据，明确 NO-GO。** Desktop query tightening 与 bounded-work cap
  暂不改变 runtime，并保留 review artifact。

## Task 3：验证、发布和下一阶段

**Produces:** v44 decision record and a bounded next plan.

- [x] **Step 1: 运行 focused/full verification。** 记录 agent-core/CLI/Desktop、
  TypeScript、Rust、integration、report smoke、structure 和 diff check。
  TypeScript workspace 612/612、release-gate contract 9/9、Rust unit/doc 46/46、
  real-Rust integration 10/10；report allowlist smoke 通过。
- [x] **Step 2: 更新 CHANGELOG、progress 和使用文档。** 区分 implemented 与
  design-only，记录 v1/pagination/schema/before-image boundary。
- [x] **Step 3: Commit and push。** 保持 `origin/main` 可复现。
- [x] **Step 4: 新建 v45 计划。** 只选择有证据支撑的独立小步。

## Acceptance checklist

- [x] preview 的未知/重复/空值/损坏输入语义有明确 decision 和回归证据；超大输入
  保持 CONDITIONAL，等待 v45 benchmark/rejection design。
- [x] preview 不泄露敏感字段，不读写 workspace，不初始化 provider，不进入 chat queue。
- [x] canonical bytes 与 v1 byte budget 仍使用同一 serializer；无静默截断。
- [x] v1 export schema 不变；pagination/schema v2 仍为 CONDITIONAL。
- [x] before-image/cross-process Undo 仍为 NO-GO。
