# v51 开发进度：Desktop viewport 与 assistive-tech 验证

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v51.md` 为准。v51 已完成 deferred QA review；它承接
> v50 的 deferred 项，先检查当前 browser harness 能力，结论是不预设添加依赖或修改 UI。

## 当前状态

v50 已完成轻量 accessibility hardening 并推送。v51 已确认：in-app browser 能提供 DOM、
screenshot、keyboard 和 console 检查，但当前能力列表没有 viewport override，也不能提供真实
screen-reader announcement；因此窄窗口和读屏结果不能用默认窗口截图代替。

## 初始任务

- [x] inventory harness capability 和 DOM/focus/status baseline。
- [x] 评估 RED responsive/assistive-tech contract；没有可验证问题，采用 Preserve/deferred。
- [x] 记录 Preserve/NO-GO；没有做 speculative 修复。
- [x] 复用 v50 post-implementation 的 focused/full gates；当前 v51 无 runtime code，已更新
  `docs/day-plan-v52.md` 与其 progress 入口。

## 当前结论

- [x] 详见 `docs/desktop-viewport-qa-v51.md`；不新增 browser/DOM dependency，不改变 UI/API。
- [x] 可用 harness 的 desktop/default viewport smoke 与 console health 已通过；窄窗口和真实
  screen-reader announcement 明确 deferred。
