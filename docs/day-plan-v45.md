# Day plan v45：preview bounded-work benchmark 与明确拒绝契约

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v44.md`。v44 只修复了 CLI preview operation isolation，
> 将 Desktop query tightening 与 oversized projection 风险保持 CONDITIONAL。v45 先
> 做可重复 benchmark 和 rejection design；没有证据时不加入 hard cap，不实现分页、
> schema v2、before-image 或跨进程 Undo。

## Goal

量化完整 metadata-only preview 在当前 retention、file projection 和 UTF-8 canonical
serialization 下的 CPU/memory/latency 工作量，确认 v41 export caps 是否已经足够，
并为可能的 bounded-work rejection 定义一个不泄露 evidence、不会静默截断、兼容 v1
的最小契约。

## Questions

- 在 `maxValidations <= 10,000`、`maxChangeSets <= 10,000` 和不同 files-per-change-set
  的组合下，projection/serialization 的时间和内存曲线是什么？
- preview 是否会因为单个 change set 的 files 数量或异常长 metadata 字符串超出合理
  工作预算，即使 v1 export 本身最终会被 `maxFiles`/`maxBytes` 拒绝？
- 如果需要内部保护，应该在 projection 前做 count/file estimate、在 serialization
  中流式计量，还是使用明确的 rejection-only hard ceiling？哪些做法不会破坏
  `serializedBytes` 的完整 canonical 语义？
- rejection 的 status/code/kind/limit/actual 是否能保持 metadata-only，且不变成 cursor、
  partial response、schema negotiation 或执行/恢复授权？

## Global constraints

- v1 `EvidenceAuditExport` success schema、CLI export 和 Desktop `/evidence` 语义不变。
- preview 必须是完整 projection 的 canonical UTF-8 measurement；禁止静默截断或假装
  partial success。
- 不持久化 before-image、patch、diff、file bytes、command、args、cwd 或 output/error。
- 不把 preview、serializedBytes、digest 或 rejection metadata 当作 execution、validation、
  restore、rollback 或 Undo authority。
- benchmark 不访问真实 workspace、不初始化 provider、不进入 chat queue；fixture 只包含
  metadata，敏感字段仅用于确认不泄露。
- 任何 runtime 改动都必须先写 RED test；没有 proof gap 就只提交 benchmark/review docs。

## Task 0：冻结基线与 benchmark contract

**Produces:** reproducible fixture matrix and measurement rules.

- [x] **Step 1: 记录 v44 baseline。** 固化 preview allowlist、operation exclusivity、
  core serializer、v41 caps 和 current conditional decisions。
- [x] **Step 2: 设计 fixture matrix。** 覆盖 empty、small、retention-sized、files-heavy、
  UTF-8-heavy 和 malformed inputs；明确不读取 workspace。
- [x] **Step 3: 定义 measurements。** 记录 wall time、serialized bytes、record/file counts、
  heap delta（不宣称 peak）和重复运行规则；不要把 benchmark 输出加入 runtime
  response。详见 `docs/evidence-preview-benchmark-v45.md`。

## Task 1：执行 benchmark 与安全分析

**Produces:** benchmark artifact and evidence-backed decision.

- [ ] **Step 1: 先写 benchmark/regression tests。** 测试完整 bytes、稳定排序、输入不变和
  no-sensitive-output；新 rejection 行为先写 RED。
- [ ] **Step 2: 运行受控 fixture matrix。** 比较 core preview 与 full export 的 projection/byte
  semantics，记录异常点和可重复性。
- [ ] **Step 3: 形成 GO / CONDITIONAL / NO-GO。** 若 v41 caps 足够，保持 runtime；若需要
  protection，才进入 Task 2。

## Task 2：bounded-work rejection（条件执行）

**Produces:** only if benchmark proves a concrete availability/safety gap.

- [ ] **Step 1: TDD implement minimal guard.** 只能显式拒绝，不能 partial/truncate/cursor；
  error metadata 不含 evidence 内容。
- [ ] **Step 2: parity and compatibility regression.** core/CLI/Desktop 保持同一 counts/bytes
  semantics，v1 export success schema 不变。
- [ ] **Step 3: 若无证据，明确 NO-GO。** 不因理论风险添加未验证 hard cap。

## Task 3：验证、发布和下一阶段

**Produces:** v45 decision record and a bounded next plan.

- [ ] **Step 1: full verification。** focused/full TypeScript、Rust、integration、report、
  structure 和 diff check。
- [ ] **Step 2: 更新 CHANGELOG、progress、benchmark/review docs 和使用文档。**
- [ ] **Step 3: commit/push 并新建 v46 计划。**

## Acceptance checklist

- [ ] benchmark fixture 与 measurements 可重复且不接触 workspace/provider。
- [ ] oversized preview 的决定有数据支撑；没有静默截断。
- [ ] 如实现 rejection，CLI/Desktop/core 的 error contract 与敏感字段边界一致。
- [ ] v1 export、pagination/schema v2、before-image/cross-process Undo boundaries remain intact.
