# v51 开发进度：Desktop viewport 与 assistive-tech 验证

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v51.md` 为准。v51 尚未开始实现；它承接 v50 的 deferred
> QA 项，先检查当前 browser harness 能力，不预设添加依赖或修改 UI。

## 当前状态

v50 已完成轻量 accessibility hardening 并推送。当前已知事实：in-app browser 能提供 DOM、
screenshot、keyboard 和 console 检查，但当前能力列表没有 viewport override；因此窄窗口和
真实 screen-reader announcement 需要在 v51 重新评估，不能用默认窗口截图代替。

## 初始任务

- [ ] inventory harness capability 和 DOM/focus/status baseline。
- [ ] 写 RED responsive/assistive-tech contract（仅在有可验证问题时）。
- [ ] 记录 Preserve/NO-GO 或做最小修复。
- [ ] 跑 focused/full gates 并更新 v52 入口。
