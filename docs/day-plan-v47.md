# Day plan v47：evidence canonical metadata digest 设计与可信边界

**建立日期：2026-09-14**

**状态：v47 design-only 完成；没有真实 consumer，deterministic digest 与 signature 均 NO-GO。**

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

- [x] **Step 1: 收集真实 consumer 需求。** inventory 现有 CLI/Desktop/CI/release gate
  使用方式；没有发现 cache、同步、审计关联或 authenticity consumer，`serializedBytes`
  已满足当前 export-limit selection。
- [x] **Step 2: 固化输入与字段边界。** 记录 digest 只能建立在完整 v1 canonical serializer
  UTF-8 bytes 上；session/filter/schema binding 与敏感字段边界见
  `docs/evidence-digest-review-v47.md`。
- [x] **Step 3: 写 abuse/compatibility matrix。** 覆盖 replay、cross-session mix-up、
  stale digest、algorithm migration、unknown/old client、logging correlation 和误当
  recovery authority 的风险；没有 consumer 前不扩大公开 surface。

## Task 1：deterministic digest contract（条件执行）

**Produces:** 最小、可实现、可验证的 hash contract；默认不改变公开 response。

- [x] **Step 1: 评估算法与 domain separation。** 确认 SHA-256 + 明确 domain separation 是
  可行候选，但算法便利不构成需求，也不能解决 authenticity/key lifecycle。
- [x] **Step 2: 证明 parity。** v45/v46 已证明同一 canonical serializer bytes 在 core/CLI/Desktop
  一致；没有真实 digest consumer，因此不新增 vectors 或 runtime utility。
- [x] **Step 3: 决定 surface。** 结论为 **NO-GO / design-only**；不增加公开 digest 字段、
  CLI flag、Desktop query、MCP resource 或 v1 schema 变化。

## Task 2：公开 surface 或签名（严格条件执行）

**Produces:** only if Task 0--1 prove a product need and trust model.

- [x] **Step 1: 未触发 TDD runtime implementation。** 没有 approved surface 或真实 consumer，
  不自动注入 v1 preview/export。
- [x] **Step 2: 固化 misuse resistance。** review 记录 digest 不得触发执行/恢复；未来 mismatch、
  旧 algorithm、unknown schema 必须明确失败，不能静默降级。
- [x] **Step 3: Signature gate。** 当前没有 key ownership、rotation、verification、revocation
  或 trust anchor，signature **NO-GO**；deterministic hash 也不公开。

## Task 3：验证、发布和下一阶段

**Produces:** v47 decision record and a bounded next plan.

- [x] **Step 1: focused/full verification。** design-only review 后的现有 full gates、structure、
  report smoke 和 diff check 均通过；没有新增 runtime test surface。
- [x] **Step 2: 更新 README、CHANGELOG、progress 和 digest review。** 明确区分 hash、signature、
  preview/export schema 与 authority boundaries。
- [x] **Step 3: commit/push 并制定 v48。** v48 改为把既有 root preview contract tests 接入固定
  TypeScript release gate，不继续堆 speculative integrity fields。

## Artifacts

- `docs/evidence-digest-review-v47.md`
- `docs/day-plan-v47-progress.md`

## Acceptance checklist

- [x] inventory 证明当前没有真实 digest consumer；不因理论便利扩大 runtime。
- [x] canonical input、候选 algorithm、encoding、schema/filter/session binding 和 migration
  风险已记录。
- [x] digest 不泄露 evidence，不成为执行/恢复授权；signature 因 trust model 缺失保持 NO-GO。
- [x] v1 export、preview allowlist、v41 caps、pagination/schema v2、before-image/cross-process
  Undo boundaries remain intact.


## v47 decision summary

- metadata digest：**NO-GO / design-only**；当前没有真实 consumer，继续使用 `serializedBytes`。
- signature：**NO-GO**；没有 key ownership、rotation、verification、revocation 或 trust anchor。
- runtime：**未改变**；v48 转向将既有 preview contract tests 纳入固定 TypeScript gate。
- 详细 review：见 `docs/evidence-digest-review-v47.md`。
