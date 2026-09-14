# v52 开发进度：Desktop UX 触发条件与最小迭代

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v52.md` 为准。v52 要求下一次实现必须由具体用户反馈、
> 可重复 harness 或回归 test 触发，不预设继续扩展 preview/integrity。

## 当前状态

v51 已确认当前 in-app browser 可做 DOM、screenshot、keyboard 和 console smoke，但没有
viewport override 或真实 screen-reader announcement。v52 Task 0 发现一个独立的、可验证的
release docs trigger：README 的 543 TypeScript tests 已落后于 gate 记录。v52 先做了最小文档
修正；随后 v53 新一轮验证发现当前 workspace 实际为 614/614，因此当前 README 改为不硬编码
易漂移的数字。现有 Desktop Evidence summary 和 accessibility semantics 保持 Preserve。

## 初始任务

- [x] 确认具体 trigger：README 测试摘要与 authoritative gate 结果不一致。
- [x] 选择一个最小文档 slice：只修正 README 当前测试摘要，不改代码或 runner。
- [x] 记录无 runtime UX trigger，保持 Preserve/NO-GO，不添加 speculative dependency/UI。
- [x] 跑最终文档检查并建立 `docs/day-plan-v53.md` 与其 progress 入口。

## 当前实现

- [x] v52 初始修正已记录在 `docs/release-docs-accuracy-v52.md`；它使用了当时记录的 612
  数字，但没有改变 runtime 或 gate。
- [x] v53 重新验证得到 workspace **614/614**，并将 README 当前摘要稳定为 suite-category-only
  文案；精确计数转移到带日期的 source-of-truth decision doc。
- [x] 决策记录：`docs/release-docs-accuracy-v52.md` 与
  `docs/release-summary-source-of-truth-v53.md`。

## 发布状态

- [x] README、CHANGELOG、v52 progress 和 decision doc 已更新；本轮没有 runtime code 变更。
- [x] v53 已完成 source-of-truth 评估，并建立 `docs/day-plan-v54.md` 与其 progress 入口。
