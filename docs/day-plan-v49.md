# Day plan v49：Desktop evidence preview 可发现性与只读 UX

**建立日期：2026-09-14**

> 本计划承接 `docs/day-plan-v48.md`。v48 已把 preview contract tests 纳入固定
> TypeScript gate。v49 不再扩展 digest/integrity schema，而是评估一个已有 API 的
> 用户价值缺口：Desktop 目前有 transcript Download，但没有可发现的 metadata-only
> evidence preview 控件。先做 UI/安全 contract，再决定是否实现最小只读面板。

## Goal

让 Desktop 用户能在不触发 provider、workspace、chat queue、validation 或 Undo 的
情况下查看当前 session 的 evidence 数量和完整 v1 export 的大小，理解后续导出/限额
选择；保持现有 API schema、session isolation、generic error 和 no-store 语义不变。

## Questions

- 当前用户是否需要在 Desktop 里看到 validation/change-set/file counts 与 serialized bytes，
  还是 CLI/API 已足够？UI 控件应放在 session header、Download 附近还是独立 panel？
- preview loading/error/unknown session 如何保持非阻塞、generic、可重试，且不把 evidence
  records、commands、paths、output/error 或 before-image 渲染到页面？
- `serializedBytes` 如何以易懂的单位显示，同时避免把大小提示误解为“可执行/可恢复/已验证”
  许可？
- 是否只做 preview panel；还是用户确实需要单独下载 metadata-only v1 JSON？若要下载，
  如何明确区分 transcript 与 audit export，并使用既有 explicit export limits？

## Global constraints

- 不改变 `EvidenceAuditPreview` v1、v1 export、v41 rejection-only caps、CLI contract、
  Desktop query semantics 或 fixed release gate。
- UI 只读调用现有 preview endpoint；不发送 chat、启动 provider/MCP、读取 workspace、
  触发 validation/rerun/rollback/Undo 或修改 memory。
- 不在浏览器缓存或 localStorage 持久化 evidence；不渲染 command、args、cwd、output/error、
  diff、patch、file bytes、before-image、provider values 或 environment values。
- 不引入 digest、signature、pagination、cursor、partial、schema v2 或 hidden authority。
- 新增 UI/runtime behavior 先写 RED tests；如果需求证据不足，只提交 contract review 和
  no-op/preserve decision，不做 speculative export controls。

## Task 0：现有 UI 与 API baseline

**Produces:** UI placement、copy、loading/error 和 sensitive-field contract。

- [ ] **Step 1: inventory current Desktop controls。** 记录 session picker、Download transcript、
  status area、history load 和 `/api/sessions` evidenceSummary 的现有行为；不重复实现 API。
- [ ] **Step 2: 定义 preview view model。** 只允许 schemaVersion/sessionId/generatedAt/counts/
  serializedBytes，明确 bytes formatting、empty state、loading、generic error 和 stale-session
  handling。
- [ ] **Step 3: 写 UI decision matrix。** 覆盖 session switch、concurrent chat/validation、
  unknown session、malformed memory、audit-limit query、retry 和 no-side-effect invariants。

## Task 1：metadata-only preview panel（条件执行）

**Produces:** 若 Task 0 证明 UI 有价值，增加最小只读控件。

- [ ] **Step 1: 先写 RED UI contract tests。** 覆盖 button/label、request URL、response allowlist、
  count/size rendering、generic error、session switch 和 no mutation；旧 HTML/JS 先失败。
- [ ] **Step 2: 最小实现。** 在 Download 附近加入 Evidence preview 控件；使用 AbortController 或
  request identity 防止旧 session response 覆盖新 session；只调用既有 preview endpoint。
- [ ] **Step 3: 浏览器回归。** 验证 keyboard/focus、loading/disabled 状态、small/large/UTF-8
  values 和 responsive layout；不把 raw JSON 或 sensitive fixture text 注入 DOM。

## Task 2：导出入口（严格条件执行）

**Produces:** only if a user need for audit JSON download is demonstrated.

- [ ] **Step 1: 区分 transcript 与 audit export。** 不复用或重命名现有 Download；明确 v1 JSON
  是 metadata-only complete snapshot，limits 仍是 explicit rejection-only。
- [ ] **Step 2: TDD 设计错误/大小反馈。** over-limit 返回现有 metadata-only error；不得下载 partial、
  truncate 或把 preview bytes 当作 authorization。
- [ ] **Step 3: 没有需求则 NO-GO。** 只交付 preview panel，导出仍由现有 CLI/API 使用，不加 UI
  下载复杂度或新的 response schema。

## Task 3：验证、发布和下一阶段

**Produces:** v49 UI decision、发布提交和 v50 计划。

- [ ] **Step 1: focused/full verification。** UI contract/browser tests、TypeScript、Rust、
  integration、report、structure 和 diff check 全部通过。
- [ ] **Step 2: 更新 README、CHANGELOG、progress 和 UI decision doc。** 说明 preview panel
  与 transcript/audit export 的边界。
- [ ] **Step 3: commit/push 并制定 v50。** 若没有用户价值证据，v50 转向新的真实需求，
  不继续扩展 preview/integrity surface。

## Acceptance checklist

- [ ] Desktop preview 控件或明确 NO-GO decision 有用户价值/兼容性证据。
- [ ] UI 只渲染 metadata-only allowlist，错误 generic，session switch 不串数据。
- [ ] 不触发 provider/workspace/chat/validation/Undo，不持久化 evidence。
- [ ] v1 export、preview schema、v41 caps、fixed release gate、pagination/schema v2、
  before-image/cross-process Undo boundaries remain intact.
