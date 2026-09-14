# Day plan v47：evidence canonical metadata digest 设计与可信边界

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v46.md`。v46 通过了 core/CLI/Desktop preview parity，并
> 保留 Desktop 的兼容 query 语义。v47 只评估 v43 提出的 canonical metadata digest
> 方向：先确认真实消费场景、算法和信任边界，再决定是否有必要改公开 schema；没有
> consumer 或 authenticity proof gap 时，不把 digest 植入 preview，不新增 schema v2。

## Goal

判断是否需要一个基于完整 v1 canonical UTF-8 projection 的 metadata digest，用于
跨进程/跨宿主比对、缓存失效或审计关联；若需要，定义一个不会泄露 evidence、不会
伪装成签名、不会成为 execution/validation/restore/Undo authority 的最小契约。

## Questions

- 真实 caller 是否需要 bytes 之外的稳定内容身份，还是 `serializedBytes` 与现有 v1
  export 已足够？
- digest 的输入是否严格等于 `serializeEvidenceAuditExport()` 的 UTF-8 bytes，并使用
  domain separation、明确算法和 schema version，避免不同 projection 发生碰撞语义？
- 公开 digest 会不会改变固定 preview allowlist、缓存/日志中的 session correlation，或
  被误用为“已验证/可恢复/可执行”的授权凭证？
- 如果产品需要 authenticity，是否有 key lifecycle、rotation、verification、failure
  handling 和 trust anchor？没有这些要素时只能谈 deterministic hash，不能称作签名。
- CLI、Desktop、MCP/CI caller 是否需要同一 digest，还是先提供内部测试/工具层 utility
  并等待真实 consumer？

## Global constraints

- 当前 `EvidenceAuditPreview` v1 success allowlist、v1 export、canonical serializer、
  v41 limits 和 CLI/Desktop operation isolation 默认不变。
- digest 不能包含 command、args、cwd、output/error、diff、patch、file bytes、before-image、
  provider values、environment values 或秘密；不能从 hash 反推出这些内容。
- digest 不是 signature；没有密钥和验证链时，不得宣称 authenticity、non-repudiation 或
  trust。不得把 digest/bytes 当作 execution、validation、restore、rollback 或 Undo authority。
- 不引入 pagination、cursor、partial、schema v2 或隐式 negotiation；如要改变公开 schema，
  必须先有兼容性设计和明确版本边界。
- 若只是 design-only 或 tests-only，benchmark/fixture 不访问真实 workspace/provider/chat
  queue；任何 runtime 改动仍先 RED 后 GREEN。

## Task 0：消费场景与威胁模型

**Produces:** digest 是否有必要的证据，以及不可接受的误用场景。

- [ ] **Step 1: 收集真实 consumer 需求。** 从现有 CLI/Desktop/CI/release gate 使用方式
  区分 content identity、cache key、audit correlation 和 authenticity，不把理论便利
  当作需求。
- [ ] **Step 2: 固化输入与字段边界。** 证明 digest 只能建立在完整 v1 canonical serializer
  bytes 上，输入 filter/session/schema 的绑定关系明确，敏感字段永不进入 projection。
- [ ] **Step 3: 写 abuse/compatibility matrix。** 覆盖 replay、cross-session mix-up、
  stale digest、algorithm migration、unknown/old client、logging correlation 和误当
  recovery authority 的风险。

## Task 1：deterministic digest contract（条件执行）

**Produces:** 最小、可实现、可验证的 hash contract；默认不改变公开 response。

- [ ] **Step 1: 评估算法与 domain separation。** 比较 Node/Rust/CI 可用的 SHA-256 语义，
  明确文本前缀、NUL/长度边界、lowercase hex/base64url 编码、schema version 和 algorithm
  label；不依赖运行时对象枚举偶然顺序。
- [ ] **Step 2: 证明 parity。** 同一 fixture 在 agent-core、CLI、Desktop（以及需要时 Rust）
  产生相同 digest；reordered input、UTF-8、filtered projection 和 empty snapshot 均
  有固定 vectors。
- [ ] **Step 3: 决定 surface。** 若无真实 consumer，保持 internal/test utility 或 NO-GO；
  若有明确 consumer，先单独写公开 schema/CLI flag 兼容方案，不直接修改 v1 preview。

## Task 2：公开 surface 或签名（严格条件执行）

**Produces:** only if Task 0--1 prove a product need and trust model.

- [ ] **Step 1: TDD implement only the approved surface.** 优先独立、只读、metadata-only
  surface；不把 digest 自动注入 v1 response，除非明确 versioning/compatibility 已获证据。
- [ ] **Step 2: Verify misuse resistance.** 错误只返回稳定 metadata；digest mismatch、旧
  algorithm、unknown schema 和跨 session 绑定不能触发执行或恢复动作。
- [ ] **Step 3: Signature gate.** 只有明确 key ownership、rotation、verification、revocation
  和 failure semantics 才能另开签名实现；否则 deterministic hash 保持非认证属性。

## Task 3：验证、发布和下一阶段

**Produces:** v47 decision record and a bounded next plan.

- [ ] **Step 1: focused/full verification。** 如无 runtime 改动，至少跑 digest vectors、
  parity、sensitive-field、structure、diff check 和现有 full gates。
- [ ] **Step 2: 更新 README、CHANGELOG、progress 和 digest review。** 清楚区分 hash、signature、
  preview/export schema 与 authority boundaries。
- [ ] **Step 3: commit/push 并制定 v48。** 若没有真实 consumer，结束为 design-only/NO-GO，
  不继续堆 speculative integrity fields。

## Acceptance checklist

- [ ] digest 是否必要有真实 consumer 证据，而非单纯理论需求。
- [ ] canonical input、algorithm、encoding、schema/filter/session binding 和 migration
  语义可复现。
- [ ] digest 不泄露 evidence，不成为执行/恢复授权；signature 只有在 key trust model
  完整时才可提议。
- [ ] v1 export、preview allowlist、v41 caps、pagination/schema v2、before-image/cross-process
  Undo boundaries remain intact.
