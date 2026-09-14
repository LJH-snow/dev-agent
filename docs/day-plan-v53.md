# Day plan v53：release summary 的 source-of-truth 评估

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v52.md`。v52 修正了 README 与历史测试摘要不一致的问题，但
> v53 新验证又发现 612 与当前 workspace 的 614/614 不一致。v53 只评估如何避免同类文档
> 漂移；不预设修改 gate report、增加计数器或把测试输出写入公开 artifact。

## Goal

确认测试覆盖摘要是否需要自动生成/校验的稳定 source-of-truth；如果自动化成本、契约风险或
输出稳定性不值得，则记录 Preserve/NO-GO，并用不含易漂移数字的当前摘要消除重复维护。

## Questions

- 固定 release gate 当前能提供哪些权威且稳定的测试计数，是否足以生成摘要？
- 直接解析测试 stdout、静态扫描 `test()` 调用、或扩展 report 各自会不会受并发、skip、动态
  tests、包边界和输出格式变化影响？
- 若要自动化，是否可以只生成 ignored/local metadata，避免把 stdout、命令、环境、路径或
  session evidence 写入 report/README？
- 这个维护问题的收益是否足以引入新的脚本、测试和 release-gate contract？

## Global constraints

- 不改变 `EvidenceAuditPreview` v1、v1 export、filters、v41 caps、CLI、Desktop UI、session
  memory、fixed release gate 或 Undo boundary，除非有独立需求和 contract。
- 不把命令、args、cwd、stdout/stderr、环境值、文件 bytes、provider 值或 session evidence
  写入公开报告或文档 artifact。
- 不为了“永远最新”而放宽 gate、接受不稳定计数、解析不可信模型输出或引入隐式执行路径。
- 先做 inventory 和 bounded prototype；没有稳定收益时采用 Preserve/NO-GO。

## Task 0：当前 source-of-truth inventory

- [x] **Step 1: inspect gate outputs。** 记录 workspace tests、preview contract、release-gate
  contract、Rust unit/doc 和 real integration 的来源与稳定性。
- [x] **Step 2: inspect drift cases。** 确认 README 的 543→612→614 漂移，并区分历史 changelog
  与当前状态摘要。
- [x] **Step 3: define acceptance。** 自动化若未来实施，必须保持 metadata-only、fail-fast、固定
  cwd/shell=false 和现有 report allowlist。

## Task 1：自动化方案（严格条件执行）

- [x] **Step 1: RED proof。** 没有发现可在不改变 gate/report 契约的前提下稳定生成总数的方案，
  因此不添加失败 test 来锁定错误口径。
- [x] **Step 2: minimal prototype。** 不写会重复运行完整 gate、解析不稳定 stdout 或扫描源码
  猜测动态测试数的 prototype；将当前 README 改为类别摘要是更小且更安全的修正。
- [x] **Step 3: regression。** 无 runtime/code prototype，因此没有新增并发、skip/empty、取消或
  输出泄露回归；新鲜完整 gate 已验证现有边界仍然通过。

## Task 2：Preserve / NO-GO 路径

- [x] **Step 1: record decision。** `docs/release-summary-source-of-truth-v53.md` 记录
  Preserve/NO-GO：暂不自动生成公开测试总数。
- [x] **Step 2: keep docs accurate。** README 只保留 suite 类别；精确计数写入带日期的验证
  记录，不再把手工数字放进 evergreen 当前摘要。
- [x] **Step 3: next trigger。** 把 CI/仪表板需要 machine-readable counts、重复漂移反馈或明确
  的发布指标契约需求写入 v54，不猜测自动化结果。

## Task 3：验证、发布和下一阶段

- [x] **Step 1: focused/full verification。** 新鲜 `pnpm verify` 全部通过；另运行 `node
  scripts/check.mjs`、`git diff --check` 和对应的 workspace test-count inventory。
- [x] **Step 2: docs/decision。** 已更新 CHANGELOG、v53 progress、source-of-truth decision、
  v52 handoff，并移除 README 的漂移数字。
- [x] **Step 3: commit/push and next plan。** 验证通过后发布本轮 docs-only slice，并建立 v54
  入口。

## Decision

**Preserve / NO-GO for automatic public test-count generation in v53.** 当前稳定边界是每个
fixed gate command 及其自身验证输出；`release-gate-report.json` 继续只保存阶段状态、时间和
exit code。扩展 report、改变 package test reporter、静态推断动态测试或隐式重复运行完整 gate
都会引入超出本轮收益的契约和维护风险。

## Acceptance checklist

- [x] 测试摘要的当前口径有明确权威来源，或明确 Preserve/NO-GO；本轮选择后者并记录 gate
  commands 与 fresh counts。
- [x] 没有把不稳定 stdout、命令、环境、路径或 session evidence 引入公开 artifact。
- [x] 没有无需求扩展 release report、gate 顺序、API、schema 或 UI authority。
