# v47 开发进度：evidence canonical metadata digest 设计与可信边界

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v47.md` 为准。v47 先确认真实消费场景与信任模型，
> 不因为“有一个 hash 很方便”就扩展 preview/export schema。

## 当前状态

v47 design-only 已完成；v46 已完成 core/CLI/Desktop preview parity、query compatibility decision 和全量验证，
并已建立 v47 digest design 计划。v47 已完成 consumer inventory、abuse matrix 和 digest
surface decision；没有真实 consumer，当前收束为 **design-only / NO-GO**，未改变 runtime。

## v46 baseline

- [x] 同一 session fixture 的 4 组标准 filter case 在 core/CLI/Desktop 上 counts、file count、
  canonical bytes 完全一致。
- [x] Desktop empty/duplicate/unknown/encoded query 与 `/messages` compatibility 已验证，
  decision 为 **Preserve / tests-only**。
- [x] TypeScript workspace 612/612、release-gate 9/9、Rust unit/doc 46/46、real-Rust
  integration 10/10，以及 parity 3/3、report/structure/diff checks 均通过。

## 已完成

### Task 0：消费场景与威胁模型

- [x] inventory content identity、cache、audit correlation 与 authenticity；当前没有真实
  digest consumer。
- [x] 固化 canonical serializer input、session/filter/schema binding 和敏感字段边界。
- [x] 写 replay、stale、algorithm migration、cross-session mix-up 与 authority misuse matrix。

### Task 1：deterministic digest contract

- [x] 评估 domain-separated SHA-256 与 encoding/schema/filter/session binding；确认候选可行但
  不构成需求。
- [x] 复用 v45/v46 canonical bytes parity evidence；没有 consumer，不新增 digest vectors/runtime。
- [x] surface decision：**NO-GO / design-only**，继续使用 `serializedBytes`。

### Task 2：公开 surface 或签名（严格条件执行）

- [x] 无 consumer 前不改 v1 preview/export，不增加 digest 字段、CLI flag 或 Desktop query。
- [x] key trust model 缺失，signature 不提议；hash 不宣称 authenticity。

### Task 3：验证与发布

- [x] digest decision、文档、full gates、structure/diff checks 和 v48 计划已完成。
- [x] v47 不改变 runtime；commit/push 与 v48 gate-coverage 计划已建立。

## Evidence

- 详细 inventory、候选 contract 和 abuse matrix：`docs/evidence-digest-review-v47.md`。
- v47 当前结论：**design-only / NO-GO**，没有真实 consumer，不改 runtime。

## 设计原则

- deterministic hash ≠ signature；digest/bytes ≠ execution、validation、restore 或 Undo authority。
- 公开 schema 默认保持 v1；不新增 pagination、cursor、partial 或隐式版本协商。
- 任何 runtime 改动先 RED 后 GREEN；没有 consumer proof 时以 design-only/NO-GO 收束。
