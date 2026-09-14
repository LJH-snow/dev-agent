# Day plan v54：按需定义机器可读测试指标契约

**建立日期：2026-09-14**

**状态：v54 完成；metrics 需求为 Preserve/NO-GO，新的 CI coverage gap 转入 v55。**

> 本计划承接 `docs/day-plan-v53.md`。v53 选择 Preserve/NO-GO：README 当前只描述 suite
> 类别，精确计数放在带日期的验证记录中。v54 确认当前没有 CI、仪表板或其他消费者要求
> machine-readable counts，因此没有实现计数器；inventory 期间发现的 live Rust integration
> CI 缺口是独立问题，转入 `docs/day-plan-v55.md`。

## Goal

避免再次为了“永远最新”而引入不稳定计数。若确有消费者需要机器可读 metrics，先定义边界、
来源、失败语义和 privacy/metadata contract，再决定是否实现最小方案。

## Trigger sources

- CI 或发布工具明确需要读取每个 gate suite 的 pass/fail/count；
- 仪表板需要跨运行比较测试覆盖，并能接受明确的 schema/version contract；
- README/发布维护再次出现可验证的当前摘要漂移；
- 提供了不重复运行完整 gate、可处理 skip/todo/dynamic tests 且不泄露原始输出的 reporter 方案。

## Global constraints

- 无 trigger 时不写脚本、不改 gate、不改 package test command、不扩展 report schema。
- 不解析不稳定 stdout 作为安全/发布 authority，不静态猜测动态 test 数，不接受隐式或重复 gate
  execution。
- 若未来实现，只能输出 metadata-only、最小 schema、明确版本、来源和失败语义；不得包含命令、
  args、cwd、stdout/stderr、环境值、路径、文件 bytes、provider 值或 session evidence。
- 不改变 `EvidenceAuditPreview` v1、v1 export、filters、v41 caps、CLI、Desktop UI、session
  memory、Undo boundary 或 fixed gate order，除非独立需求和 contract 已批准。

## Task 0：确认 trigger 与消费者

- [x] 检查 `.github/workflows`、scripts、package scripts 和 docs，未发现 metrics 消费者。
- [x] 区分当前 docs-only 维护需求与真正的 machine-readable contract 需求。
- [x] 将 inventory 期间发现的 CI live-integration coverage gap 记录为独立 v55 trigger，避免
  把不同问题混进 metrics 方案。

## Task 1：契约设计（仅在有 trigger 时）

- [x] 没有 metrics consumer，因此不写 RED contract、不扩展 report schema、不添加 reporter。
- [x] 不实现 stdout parsing、静态 test 扫描或重复 gate wrapper。
- [x] 保留 metadata-only、fail-fast、固定 cwd/shell=false 和现有 report allowlist。

## Task 2：Preserve / NO-GO 路径

- [x] `docs/release-summary-source-of-truth-v53.md` 继续作为当前 metrics decision；v54 保持
  **Preserve / NO-GO**。
- [x] README 继续使用 suite-category-only 文案，精确计数只写入带日期的验证记录。
- [x] 下一次明确的 CI coverage 需求已写入 v55，不把它伪装成 metrics 自动化需求。

## Task 3：发布与下一阶段

- [x] v54 docs-only 结论通过 structure/diff 检查；没有 metrics runtime/code 变更。
- [x] 更新 CHANGELOG、progress 和 v55 plan；现有 release report、gate order 和 Evidence 边界
  不变。
- [x] v55 已建立并开始处理 macOS real Rust integration CI coverage。

## Decision

**Preserve / NO-GO for automatic public test-count generation.** v54 没有明确消费者，也没有
足够稳定的低风险 source-of-truth；继续维护 category-only README。CI live integration 是另一个
可验证的工程质量问题，不应通过扩展 metrics report 来解决。

## Acceptance checklist

- [x] 没有 metrics consumer 时未增加脚本、依赖、report 字段或 gate 行为。
- [x] 没有把 stdout、命令、环境、路径、文件 bytes 或 session evidence 引入公开 artifact。
- [x] 已记录 Preserve/NO-GO 和下一阶段的独立触发条件。
