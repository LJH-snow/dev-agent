# Day plan v54：按需定义机器可读测试指标契约

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v53.md`。v53 选择 Preserve/NO-GO：README 当前只描述 suite
> 类别，精确计数放在带日期的验证记录中。v54 只有在出现明确的 CI、仪表板或维护反馈时，才
> 设计机器可读测试指标；没有 trigger 时继续 Preserve。

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

- [ ] 记录谁消费 metrics、需要哪些字段、更新频率和失败处理。
- [ ] 区分当前 docs-only 维护需求与真正的 machine-readable contract 需求。
- [ ] 若没有消费者，记录 Preserve 并停止 speculative implementation。

## Task 1：契约设计（仅在有 trigger 时）

- [ ] 先写 RED contract，覆盖 suite/package 边界、pass/fail、skip/todo、动态 tests 和空结果。
- [ ] 定义来源与版本，不允许把 reporter 文本或任意命令输出直接当 authority。
- [ ] 设计最小 metadata-only artifact，评估是否需要单独文件而非扩展现有 gate report。

## Task 2：实现与回归（严格条件执行）

- [ ] 只在契约通过评审后实现 bounded prototype；禁止隐藏重复运行完整 gate。
- [ ] 验证 fail-fast、取消、并发、失败/空结果和 output/privacy boundary。
- [ ] 代码变更才运行对应 focused/full gate；docs-only 继续运行 structure/diff checks。

## Task 3：发布与下一阶段

- [ ] 更新 source-of-truth decision、CHANGELOG、progress 和后续计划。
- [ ] 只有 fresh evidence 通过且无 report/authority 回归才 commit/push。
- [ ] 没有 trigger 时保留 category-only README，并把下一次具体信号写入 v55。

## Acceptance checklist

- [ ] 有明确消费者和字段 contract，或明确 Preserve/NO-GO。
- [ ] 不泄露 stdout、命令、环境、路径、文件 bytes 或 session evidence。
- [ ] 不无需求扩展 API、schema、gate order、report allowlist 或 Undo authority。
