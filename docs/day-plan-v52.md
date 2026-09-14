# Day plan v52：Desktop UX 触发条件与最小迭代

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v51.md`。v51 的结论是 Preserve/deferred：当前 harness 没有
> viewport override 或真实 screen-reader output，且没有可复现 UI 缺陷。v52 不预设继续改
> preview/integrity surface，而是把下一次迭代绑定到具体用户反馈、可重复 harness 或可复现
> failure。

## Goal

在出现明确触发条件时，快速把 Desktop UX 问题转成最小 RED→GREEN 修复；没有触发条件时，
保持当前 API/UI/测试边界不变，不用猜测代替需求。

## Trigger sources

至少满足下列一项，才进入实现：

- 真实用户报告的键盘、焦点、窄窗口、读屏或 session 异步状态问题；
- 可重复的 in-app browser/Playwright viewport 或 assistive-tech harness；
- 现有 release/contract/browser test 捕获的具体回归；
- 明确要求新的 Desktop evidence/export 工作流，并能定义 authority/limit 边界。

## Global constraints

- 没有 trigger 时只做 inventory、decision doc 或 Preserve/NO-GO，不添加依赖和 speculative UI。
- 不改变 `EvidenceAuditPreview` v1、v1 export、filters、v41 rejection-only caps、CLI、
  session memory、fixed release gate 或 transcript Download，除非有独立 contract。
- 不渲染 raw evidence、commands、args、cwd、output/error、diff、patch、file bytes、
  before-image、provider values 或 environment values。
- 不引入 schema v2、digest、signature、pagination、cursor、partial response 或隐式
  execution/recovery/Undo authority。

## Task 0：确认是否有 trigger

- [ ] **Step 1: inventory signal。** 从现有 tests、docs、browser capability 和用户反馈中
  记录具体问题；没有反馈时明确 `no trigger`。
- [ ] **Step 2: bound the problem。** 为每个 trigger 定义重现步骤、受影响控件、可观测结果和
  不变量；拒绝把偏好写成故障。
- [ ] **Step 3: choose one slice。** 只选择一个最小可验证改动，禁止把多个猜想合并成一次
  UI/API 重构。

## Task 1：条件实现

- [ ] **Step 1: RED test。** 先在现有轻量 contract 或可用 browser harness 中复现问题。
- [ ] **Step 2: minimal fix。** 只改受影响的 UI/runtime 边界，并保留 generic/safe behavior。
- [ ] **Step 3: regression。** 验证成功、错误、取消、stale、session isolation 和 console
  health；若涉及 preview，继续保持 metadata-only allowlist。

## Task 2：无 trigger 时的 Preserve

- [ ] **Step 1: document.** 记录 no trigger、未测能力和保留理由。
- [ ] **Step 2: avoid churn.** 不添加快捷键、折叠、通知、导出、依赖或 schema 字段。
- [ ] **Step 3: next signal.** 把需要用户/工具提供的最小信息写入下一次计划，不假设答案。

## Task 3：验证与发布

- [ ] **Step 1: focused/full verification。** 只要改了代码，跑 UI contract、TypeScript、Rust、
  integration、report、structure 和 diff check。
- [ ] **Step 2: docs/decision。** 更新 CHANGELOG、progress 和 decision doc，说明 trigger 与
  authority boundary。
- [ ] **Step 3: commit/push and next plan。** 只有验证通过才发布，并保留下一次计划入口。

## Acceptance checklist

- [ ] 有明确 trigger，或明确记录 no trigger/Preserve。
- [ ] 每个代码改动都有 RED→GREEN 证据，且没有 stale/session/sensitive-field 回归。
- [ ] 未引入未经需求证明的 API、依赖、schema、authority 或导出 surface。
