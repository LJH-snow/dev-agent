# Day plan v51：Desktop viewport 与 assistive-tech 验证

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v50.md`。v50 已补齐显式 labels、focus-visible、live status
> 和 Evidence `aria-busy`，但当前 in-app browser harness 没有 viewport override，因此窄窗口
> 和更完整的 screen-reader announcement 只完成了契约定义，尚未形成可重复的浏览器证据。
> v51 先验证工具能力和真实问题，再决定是否新增测试依赖或继续改 UI。

## Goal

建立一套低成本、可重复的 Desktop viewport/assistive-tech QA 证据；若发现真实可用性缺口，
只做最小 UI 修复，否则记录 Preserve/NO-GO，不为假想用户增加折叠、快捷键、通知或新的
preview/export surface。

## Questions

- 当前可用的 in-app browser 或本地 harness 能否固定 desktop、窄窗口和高对比/缩放状态，
  并保存可比较的 DOM/screenshot/console 证据？
- header controls、Evidence summary grid、validation card 和 composer 在窄窗口是否仍有
  清晰的 tab 顺序、可见焦点、可读文本和不溢出的操作区域？
- status live region 是否只播报必要的完整状态，避免流式 token/usage 噪声或重复公告？
- 如果现有 harness 不支持 viewport 或真实辅助技术，添加浏览器依赖是否有明确收益；否则
  是否应继续保持轻量 served-HTML contract？

## Global constraints

- 不改变 `EvidenceAuditPreview` v1、v1 export、filters、v41 rejection-only caps、CLI、
  session memory、fixed release gate 或 Desktop transcript Download。
- 不新增 provider/workspace/chat side effect；Evidence 仍只调用 metadata-only preview GET。
- 不渲染 raw evidence、commands、args、cwd、output/error、diff、patch、file bytes、
  before-image、provider values 或 environment values。
- 不引入 schema v2、digest、signature、pagination、cursor、partial response 或隐式
  execution/recovery/Undo authority。
- 先建立可复现失败或用户反馈，再改代码；工具缺失本身不是新增重量级依赖的充分理由。

## Task 0：QA 能力与现状基线

**Produces:** harness capability matrix、DOM/focus/status inventory 和 viewport decision。

- [ ] **Step 1: inspect available harness。** 记录 in-app browser 的 viewport、screenshot、DOM、
  console 和 keyboard 能力；不猜测未暴露的 API。
- [ ] **Step 2: capture baseline。** 覆盖 initial、Evidence success/error/stale、session switch、
  validation card 和 composer；记录可见文本、focus target、ARIA 属性和 console health。
- [ ] **Step 3: decide test investment。** 只有现有证据证明需要时才引入 browser/DOM dependency；
  否则扩展 served-HTML contract 并记录 Preserve。

## Task 1：响应式布局验证（条件执行）

**Produces:** desktop/窄窗口布局证据或明确 deferred decision。

- [ ] **Step 1: RED contract。** 锁定 header wrapping、Evidence grid、composer width、
  overflow 和 focus-visible 的结构性不变量。
- [ ] **Step 2: minimal fix。** 只修复可复现的溢出、遮挡、不可操作或对比问题；保持现有视觉语言。
- [ ] **Step 3: browser regression。** 在能固定 viewport 时验证 desktop/窄窗口；否则记录 harness
  limitation，不用截图推断未测尺寸。

## Task 2：辅助技术播报验证（条件执行）

**Produces:** status/live-region 的 announcement decision。

- [ ] **Step 1: trace transitions。** 检查 idle、streaming、done、error、aborted、preview
  loading/success/error/stale 是否有一个清晰的播报来源。
- [ ] **Step 2: TDD only on a concrete gap。** 发现重复、缺失或敏感字段泄露时先写 RED，再做
  最小修复；没有问题则 Preserve。
- [ ] **Step 3: authority boundary。** 不把 ARIA/status/usage/counts/bytes 解释为执行、验证、
  恢复、回滚或 Undo 授权。

## Task 3：验证、发布和下一阶段

**Produces:** v51 decision、验证证据、文档和 v52 入口。

- [ ] **Step 1: focused/full verification。** UI contract/browser、TypeScript、Rust、integration、
  report、structure、diff check 全部通过。
- [ ] **Step 2: docs and decision。** 更新 README、CHANGELOG、progress 和 viewport/assistive-tech
  decision doc；明确 tool limitation 与 Preserve/NO-GO。
- [ ] **Step 3: commit/push and next plan。** 只有验证通过才发布；没有真实需求就冻结 preview/
  integrity surface。

## Acceptance checklist

- [ ] harness capability 和未测尺寸边界有明确记录。
- [ ] desktop/窄窗口（若可测）无操作溢出，keyboard/focus/status 语义有证据。
- [ ] screen-reader/live-region 公告不重复、不泄露 raw evidence，或明确 Preserve。
- [ ] API/schema/export/limits/release gate/Undo boundaries 未改变，或任何改变都有独立
  contract 与明确用户需求。
