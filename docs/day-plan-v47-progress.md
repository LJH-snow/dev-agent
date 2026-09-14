# v47 开发进度：evidence canonical metadata digest 设计与可信边界

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v47.md` 为准。v47 先确认真实消费场景与信任模型，
> 不因为“有一个 hash 很方便”就扩展 preview/export schema。

## 当前状态

v46 已完成 core/CLI/Desktop preview parity、query compatibility decision 和全量验证，
并已建立 v47 digest design 计划。v47 尚未改变 runtime；下一步从 consumer inventory
和 abuse matrix 开始。

## v46 baseline

- [x] 同一 session fixture 的 4 组标准 filter case 在 core/CLI/Desktop 上 counts、file count、
  canonical bytes 完全一致。
- [x] Desktop empty/duplicate/unknown/encoded query 与 `/messages` compatibility 已验证，
  decision 为 **Preserve / tests-only**。
- [x] TypeScript workspace 612/612、release-gate 9/9、Rust unit/doc 46/46、real-Rust
  integration 10/10，以及 parity 3/3、report/structure/diff checks 均通过。

## 进行中

### Task 0：消费场景与威胁模型

- [ ] inventory content identity、cache、audit correlation 与 authenticity 的真实需求。
- [ ] 固化 canonical serializer input 和敏感字段边界。
- [ ] 写 replay、stale、algorithm migration、cross-session mix-up 与 authority misuse matrix。

### Task 1：deterministic digest contract

- [ ] 评估 domain-separated SHA-256 与 encoding/schema/filter/session binding。
- [ ] 写 empty/UTF-8/reordered/filtered fixed vectors 与 core/CLI/Desktop parity tests。
- [ ] 决定 internal/test utility、独立 surface 或 NO-GO。

### Task 2：公开 surface 或签名（严格条件执行）

- [ ] 没有真实 consumer 前不改 v1 preview/export。
- [ ] 只有完整 key trust model 才评估 signature；hash 不宣称 authenticity。

### Task 3：验证与发布

- [ ] digest decision、文档、full gates、commit/push 和 v48 计划。

## 设计原则

- deterministic hash ≠ signature；digest/bytes ≠ execution、validation、restore 或 Undo authority。
- 公开 schema 默认保持 v1；不新增 pagination、cursor、partial 或隐式版本协商。
- 任何 runtime 改动先 RED 后 GREEN；没有 consumer proof 时以 design-only/NO-GO 收束。
