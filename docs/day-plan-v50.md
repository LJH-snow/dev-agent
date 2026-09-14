# Day plan v50：Desktop shell accessibility 与交互稳健性

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v49.md`。v49 已将已有 metadata-only preview 做成可发现的
> 只读面板，并明确不新增 audit JSON 下载、digest 或 integrity authority。v50 聚焦 Desktop
> 静态 shell 的真实交互质量：键盘路径、焦点可见性、响应式 header、状态播报和 session
> 操作边界；不借 UI 改变后端 preview/export contract。

## Goal

让 Desktop 用户在键盘、窄窗口和异步 session 操作中仍能清楚知道当前 session、请求状态、
Evidence summary 状态和可用操作；保持现有 chat、transcript Download、preview API、
validation、Undo 和 session isolation 语义不变。

## Questions

- 当前 header 的 session picker、new/rename/delete/download/evidence/stop 的 tab 顺序和
  focus-visible 样式是否清楚，是否存在按钮 disabled 但用户不知道原因的状态？
- `status`、usage、validation、Evidence summary 是否在屏幕阅读器和键盘路径中有稳定的
  label/live-region 语义，而不重复或泄露 raw error/evidence？
- 窄窗口下 header controls、Evidence summary grid 和 composer 是否保持可操作；是否需要
  把控件分组或折叠，而不是继续压缩文字？
- 是否有足够的实际需求支持新的 shortcut、通知或导出入口？没有证据就保持 NO-GO。

## Global constraints

- 不改变 `EvidenceAuditPreview` v1、v1 export、filters、v41 rejection-only caps、CLI
  contract、fixed release gate 或 session storage。
- 不新增 provider/workspace/chat side effect；只读 preview 仍是唯一的 Evidence 面板数据源。
- 不渲染 raw evidence、commands、args、cwd、output/error、diff、patch、file bytes、
  before-image、provider values 或 environment values。
- 不引入 schema v2、digest、signature、pagination、cursor、partial response 或隐式
  execution/recovery/Undo authority。
- UI/runtime behavior 先写 RED contract；没有可验证的用户价值时采用 Preserve/NO-GO。

## Task 0：交互基线与可访问性契约

**Produces:** 可操作的 tab/focus/status contract 和窄窗口问题清单。

- [ ] **Step 1: inventory。** 记录当前 DOM 顺序、按钮 disabled 条件、session switch、
  preview loading/error/stale、chat streaming 和 validation/rerun 状态。
- [ ] **Step 2: define contract。** 明确 label、role、`aria-expanded`、`aria-live`、
  `:focus-visible`、键盘 activation、操作中禁用和恢复语义；不增加 raw error 详情。
- [ ] **Step 3: write matrix。** 覆盖 empty session、unknown session、concurrent request、
  rename/delete failure、narrow width 和 reduced-motion/contrast 不变量。

## Task 1：键盘与焦点路径（条件执行）

**Produces:** 不依赖鼠标也能完成 session 选择、Evidence preview、发送/停止和 retry。

- [ ] **Step 1: RED tests。** 在现有轻量 HTML contract 中锁定 focus-visible、稳定 labels、
  button activation 和 disabled 状态；不引入重量级测试框架除非证据需要。
- [ ] **Step 2: minimal implementation。** 修复 focus ring、控件分组、键盘顺序、status/live
  announcements 和可恢复的 async state；保持默认视觉风格。
- [ ] **Step 3: browser regression。** 用 in-app browser 验证 desktop/窄窗口截图、Tab/Space/
  Enter、loading/error/success/stale 和 console health。

## Task 2：异步 session 操作的可理解性

**Produces:** session 切换、rename/delete、streaming 与 preview 并发时的清晰状态。

- [ ] **Step 1: model transitions。** 对每个操作定义 idle/loading/success/error/cancelled/stale
  状态，禁止旧响应覆盖新 session。
- [ ] **Step 2: TDD only where needed。** 若发现真实状态丢失或误导，先写失败 contract，再做
  最小修复；若当前行为已满足则记录 Preserve，不做重构。
- [ ] **Step 3: no new authority。** 不把 status/usage/bytes/counts 解释为执行、验证、恢复、
  回滚或 Undo 授权。

## Task 3：验证、发布和下一阶段

**Produces:** v50 decision、验证证据、文档和 v51 入口。

- [ ] **Step 1: focused/full verification。** UI contract/browser、TypeScript、Rust、integration、
  report、structure、diff check 全部通过。
- [ ] **Step 2: docs and decision。** 更新 README、CHANGELOG、progress 和 accessibility/interaction
  decision doc；明确 Preserve/NO-GO 的需求边界。
- [ ] **Step 3: commit/push and next plan。** 只有验证通过才发布；若无新的真实需求，继续保持
  preview/integrity surface 冻结。

## Acceptance checklist

- [ ] 键盘路径、focus-visible、稳定 aria labels/live regions 和 async disabled 语义有证据。
- [ ] session switch/rename/delete/chat/preview 并发下没有 stale response 串入或误导状态。
- [ ] 窄窗口下控件和 Evidence summary 仍可读、可操作，不泄露敏感字段。
- [ ] API/schema/export/limits/release gate/Undo boundaries 未改变，或任何改变都有独立
  contract 与明确用户需求。
