# v50 开发进度：Desktop shell accessibility 与交互稳健性

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v50.md` 为准。v50 是 v49 的后续计划，尚未开始实现；
> 先从当前静态 Desktop shell 的真实交互问题建立基线，不预设新增 API 或导出入口。

## 当前状态

v49 已完成 Evidence summary 的可发现性和只读边界；v50 等待 v49 的提交/发布完成后开始。
当前已知的正向证据是 Evidence 控件可通过鼠标和键盘 Space 激活、session 切换会清理旧面板、
成功/错误状态均为 generic。Enter activation、窄窗口细节和更完整的 screen-reader contract
留给 v50 的 focused review。

## 初始任务

- [ ] inventory 当前 DOM/tab/focus/status transitions。
- [ ] 写 RED accessibility/interaction contract。
- [ ] 仅在有失败证据时做最小修复；否则记录 Preserve/NO-GO。
- [ ] 跑 focused/full gates 并更新 v51 入口。
