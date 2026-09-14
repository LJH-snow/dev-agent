# v50 开发进度：Desktop shell accessibility 与交互稳健性

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v50.md` 为准。v50 是 v49 的后续计划，尚未开始实现；
> 先从当前静态 Desktop shell 的真实交互问题建立基线，不预设新增 API 或导出入口。

## 当前状态

v49 已完成 Evidence summary 的可发现性和只读边界；v50 已开始并完成第一轮轻量
accessibility hardening。当前正向证据是 Evidence 控件可通过鼠标和键盘 Space 激活、
session 切换会清理旧面板、成功/错误状态均为 generic，且 header status、session、usage、
message 和 preview loading 都有稳定的 ARIA 语义。Enter activation、窄窗口细节和更完整的
screen-reader announcement 仍保留为后续 focused review。

## 初始任务

- [x] inventory 当前 DOM/tab/focus/status transitions。
- [x] 写 RED accessibility/interaction contract；旧页面缺少 focus-visible/ARIA 语义时失败。
- [x] 仅做有失败证据支持的最小修复；详见 `docs/desktop-accessibility-v50.md`。
- [x] 跑 focused/full gates；已更新 `docs/day-plan-v51.md` 与其 progress 入口。

## 当前实现

- `apps/desktop/public/index.html` 增加统一 `:focus-visible`、显式控件 labels、header live
  status 和 Evidence panel `aria-busy` 状态。
- `apps/desktop/tests/server.test.ts` 新增 served-HTML accessibility contract；focused
  Desktop suite 当前为 **76/76**。

## 发布状态

- [x] v50 实现、decision doc、README/CHANGELOG 已准备发布；当前工作树待 commit/push。
- [x] v51 已建立为 deferred viewport/assistive-tech verification plan，不预设新增依赖或
  preview/integrity surface。

## 验证结果

- [x] `pnpm verify`：TypeScript workspace **612/612**、preview contract **8/8**、
  release-gate contract **11/11**、Rust unit/doc **46/46**、real-Rust integration **10/10**。
- [x] `pnpm verify:typescript --report`：report status `passed`，固定 step ids 保持
  `structure`, `build`, `typecheck`, `typescript-test`, `preview-contract`, `gate-contract`。
- [x] `node scripts/check.mjs`、嵌入脚本 `node --check` 和 `git diff --check` 通过。
