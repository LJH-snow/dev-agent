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

- [ ] **Step 1: 固化 v43 contract。** 记录 preview 固定字段、标准 filters、
  `/evidence` 独占 audit limits、generic error、no-store 和 session isolation。
- [ ] **Step 2: 画出输入/信任边界。** 区分 URL/argv、session id、persisted memory、
  canonical projection、preview response；列出敏感字段和 side effects。
- [ ] **Step 3: 建立 decision matrix。** 对 unknown query、duplicate value、empty value、
  malformed memory、oversized projection、组合 flags 给出 preserve/reject/defer 决定。

## Task 1：安全评审与可重复证据

**Produces:** review document and focused regression cases; no runtime change unless a
proof gap is found.

- [ ] **Step 1: 检查当前实现。** 确认 core/CLI/Desktop 的 allowlist、sorting、UTF-8
  measurement、error handling 和 side-effect behavior 没有分叉。
- [ ] **Step 2: 先写 RED tests。** 只覆盖已决定要改变的边界；若结论是 preserve，
  写 parity/regression test 而不是 speculative API。
- [ ] **Step 3: 形成 decision。** 对每个 proof gap 标记 GO / CONDITIONAL / NO-GO，
  未达到证据门槛的行为留在 design-only。

## Task 2：最小兼容性加固（条件执行）

**Produces:** only if Task 1 proves a concrete gap.

- [ ] **Step 1: TDD implement.** 可能的最小改动包括显式拒绝危险/歧义的 CLI 组合、
  preview query allowlist 或 bounded-work rejection；不得加入 truncation/cursor。
- [ ] **Step 2: 对 CLI/Desktop/core 做 parity 回归。** 保证 v1 export 和现有 clients
  不变；generic error 不含敏感数据。
- [ ] **Step 3: 若无足够证据，明确 NO-GO。** 只提交 review artifact，不为“看起来更严格”
  而改变兼容性。

## Task 3：验证、发布和下一阶段

**Produces:** v44 decision record and a bounded next plan.

- [ ] **Step 1: 运行 focused/full verification。** 记录 agent-core/CLI/Desktop、
  TypeScript、Rust、integration、report smoke、structure 和 diff check。
- [ ] **Step 2: 更新 CHANGELOG、progress 和使用文档。** 区分 implemented 与
  design-only，记录 v1/pagination/schema/before-image boundary。
- [ ] **Step 3: Commit and push。** 保持 `origin/main` 可复现。
- [ ] **Step 4: 新建 v45 计划。** 只选择有证据支撑的独立小步。

## Acceptance checklist

- [ ] preview 的未知/重复/空值/损坏/超大输入语义有明确 decision 和测试证据。
- [ ] preview 不泄露敏感字段，不读写 workspace，不初始化 provider，不进入 chat queue。
- [ ] canonical bytes 与 v1 byte budget 仍使用同一 serializer；无静默截断。
- [ ] v1 export schema 不变；pagination/schema v2 仍为 CONDITIONAL。
- [ ] before-image/cross-process Undo 仍为 NO-GO。
