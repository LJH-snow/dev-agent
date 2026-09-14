# v52 开发进度：Desktop UX 触发条件与最小迭代

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v52.md` 为准。v52 尚未开始；它要求下一次实现必须由
> 具体用户反馈、可重复 harness 或回归 test 触发，不预设继续扩展 preview/integrity。

## 当前状态

v51 已确认当前 in-app browser 可做 DOM、screenshot、keyboard 和 console smoke，但没有
viewport override 或真实 screen-reader announcement。没有可复现 UX failure，因此 v52 等待
trigger；现有 Desktop Evidence summary 和 accessibility semantics 保持 Preserve。

## 初始任务

- [ ] 确认是否存在具体 trigger。
- [ ] 只选择一个最小 RED→GREEN slice。
- [ ] 若无 trigger，记录 Preserve/NO-GO，不添加 speculative dependency/UI。
- [ ] 代码改动时跑完整 gates，并建立 v53 入口。
