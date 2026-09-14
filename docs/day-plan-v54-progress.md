# v54 开发进度：按需定义机器可读测试指标契约

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v54.md` 为准。v54 作为 v53 的后续入口建立，尚未开始；
> 在出现明确消费者或维护反馈前，继续保持 category-only README 和 Preserve/NO-GO 边界。

## 当前状态

v53 fresh gate 证明当前 TypeScript workspace 为 614/614，但也证明把总数手工写进 evergreen
README 会产生 543→612→614 漂移。当前没有 CI、仪表板或其他消费者要求 machine-readable
counts，因此 v54 暂不添加 reporter、脚本或 release-report 字段。

## 初始任务

- [ ] 记录明确的 metrics 消费者与字段需求（若出现）。
- [ ] 评估 suite/package/skip/todo/dynamic test 的契约边界。
- [ ] 有低风险方案才写 RED contract；否则记录 Preserve/NO-GO。
- [ ] 通过 fresh evidence 后再决定是否实现，并建立 v55 入口。
