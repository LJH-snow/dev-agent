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

- [x] **Step 1: 先写 benchmark/regression tests。** 先以缺失 benchmark module 的 RED
  测试锁定 contract，再实现固定 artifact、完整 bytes、稳定排序、输入不变、malformed
  selection 和 no-sensitive-output 回归。
- [x] **Step 2: 运行受控 fixture matrix。** `pnpm benchmark:evidence` 连续运行两次；六个
  fixture 的 preview bytes 均与 full export canonical UTF-8 bytes 一致，最大 100,000-file
  fixture 为 27,489,424 bytes、74--76 ms、约 61.2 MiB heap delta。
- [x] **Step 3: 形成决策。** 当前 v41 explicit export caps 足够，v45 对 preview hard cap
  作 **NO-GO**；不改变 runtime success/error schema。

## Task 2：bounded-work rejection（条件执行）

**Produces:** only if benchmark proves a concrete availability/safety gap.

- [ ] **Step 1: TDD implement minimal guard.** 本轮没有 concrete gap，未执行；不加入
  preview-only hard ceiling、partial/truncate 或 cursor。
- [ ] **Step 2: parity and compatibility regression.** 未触发 runtime 改动；现有 core/CLI/
  Desktop parity 由既有 v43/v44 回归保持。
- [x] **Step 3: 若无证据，明确 NO-GO。** v45 benchmark 未复现 availability failure，明确
  不增加未经验证的 preview hard cap。

## Task 3：验证、发布和下一阶段

**Produces:** v45 decision record and a bounded next plan.

- [x] **Step 1: full verification。** `pnpm verify` 通过：TypeScript workspace 612/612、
  release-gate contract 9/9、Rust unit/doc 46/46、real-Rust integration 10/10；
  独立 TypeScript/Rust gate、report smoke、structure 和 diff check 随后通过。
- [x] **Step 2: 更新 CHANGELOG、progress、benchmark/review docs 和使用文档。**
- [x] **Step 3: commit/push 并新建 v46 计划。** v46 parity/query 计划已写入
  `docs/day-plan-v46.md` 与 `docs/day-plan-v46-progress.md`，提交将在最终检查后完成。

## Acceptance checklist

- [x] benchmark fixture 与 measurements 可重复且不接触 workspace/provider。
- [x] oversized preview 的决定有数据支撑；没有静默截断。
- [x] 本轮没有实现 rejection；既有 CLI/Desktop/core error boundary 与敏感字段边界保持不变。
- [x] v1 export、pagination/schema v2、before-image/cross-process Undo boundaries remain intact.


## v45 decision summary

- benchmark/rejection design：**完成**；受控 matrix 与 parity regression 已落地。
- preview hard cap：**NO-GO**；不新增 runtime 保护，避免重复 v41 export cap。
- 新增可复现入口：`pnpm test:benchmark` 与 `pnpm benchmark:evidence`。
- 详细数据与边界：见 `docs/evidence-preview-benchmark-v45.md`。
