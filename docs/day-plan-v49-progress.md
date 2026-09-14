# v49 开发进度：Desktop evidence preview 可发现性与只读 UX

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v49.md` 为准。v49 承接 v48 gate coverage，先验证
> Desktop UI 是否需要现有 metadata-only preview API，不预设一定新增导出按钮或 schema。

## 当前状态

v48 已完成 preview contract gate coverage 并推送；v49 已建立计划。当前已确认 Desktop
header 有 session picker、Rename/Delete、transcript Download 和 Stop，但没有 evidence
preview 控件；下一步冻结 UI view model 与安全边界。

## v48 baseline

- [x] `preview-contract` fixed phase 运行 8 个 root contract tests。
- [x] TypeScript workspace 612/612、preview 8/8、release-gate contract 11/11、Rust
  unit/doc 46/46、real-Rust integration 10/10。
- [x] full benchmark 仍为显式 dev command；v1/preview/digest/integrity boundaries 未变。

## 进行中

### Task 0：现有 UI 与 API baseline

- [ ] inventory current controls、session switch/history load 与 evidenceSummary。
- [ ] 定义 metadata-only preview view model、copy、loading/error/stale handling。
- [ ] 写 UI decision matrix 与 no-side-effect invariants。

### Task 1：metadata-only preview panel（条件执行）

- [ ] 先写 RED UI contract tests。
- [ ] 如有价值证据，加入最小只读 panel；防止旧 session response 串入新 session。
- [ ] 浏览器回归 focus/loading/responsive/UTF-8/sensitive-field 边界。

### Task 2：导出入口（严格条件执行）

- [ ] 先区分 transcript 与 audit export 语义。
- [ ] 有明确需求才 TDD；否则只交付 panel，导出保持 CLI/API。

### Task 3：验证与发布

- [ ] UI decision、full gates、docs、commit/push 和 v50 计划。

## 设计原则

- preview panel 是只读可发现性层，不是新的证据权限层。
- 不把 bytes/counts 当成执行、validation、restore、rollback 或 Undo authority。
- 不渲染 raw evidence，不持久化 response，不改变 v1 export/preview API。
- 所有 runtime/UI behavior 先 RED 后 GREEN；没有需求证据时明确 NO-GO。
