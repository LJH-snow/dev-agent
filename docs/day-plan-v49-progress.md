# v49 开发进度：Desktop evidence preview 可发现性与只读 UX

> 最后更新：2026-09-14

> 详细目标和约束以 `docs/day-plan-v49.md` 为准。v49 承接 v48 gate coverage，先验证
> Desktop UI 是否需要现有 metadata-only preview API，不预设一定新增导出按钮或 schema。

## 当前状态

v48 已完成 preview contract gate coverage 并推送；v49 已完成 UI baseline、只读 view model
和 decision matrix，并实现了 Desktop evidence summary 面板。当前面板只调用已有 preview
endpoint；下一步是跑完整 release gates，并在验证后提交 v49、写入 v50 计划。

## v48 baseline

- [x] `preview-contract` fixed phase 运行 8 个 root contract tests。
- [x] TypeScript workspace 612/612、preview 8/8、release-gate contract 11/11、Rust
  unit/doc 46/46、real-Rust integration 10/10。
- [x] full benchmark 仍为显式 dev command；v1/preview/digest/integrity boundaries 未变。

## 进行中

### Task 0：现有 UI 与 API baseline

- [x] inventory current controls、session switch/history load 与 evidenceSummary。
- [x] 定义 metadata-only preview view model、copy、loading/error/stale handling。
- [x] 写 UI decision matrix 与 no-side-effect invariants；详见 `docs/evidence-preview-ui-v49.md`。

### Task 1：metadata-only preview panel（条件执行）

- [x] 先写 RED UI contract tests；旧 HTML 在缺少 preview 控件时失败，GREEN 后 Desktop 为 75/75。
- [x] 加入最小只读 panel；AbortController、request identity 和 data revision 防止旧响应串入新 session。
- [x] 浏览器回归 hidden/success/error/session switch/keyboard 和 screenshot；UTF-8 preview
  values 继续由既有 cross-surface parity contract 覆盖。

### Task 2：导出入口（严格条件执行）

- [x] 先区分 transcript 与 audit export 语义。
- [x] 没有明确下载需求，采用 NO-GO；只交付 panel，导出保持 CLI/API。

### Task 3：验证与发布

- [x] full gates、commit/push 和 v50 计划；UI decision/docs 已完成。

## 设计原则

- preview panel 是只读可发现性层，不是新的证据权限层。
- 不把 bytes/counts 当成执行、validation、restore、rollback 或 Undo authority。
- 不渲染 raw evidence，不持久化 response，不改变 v1 export/preview API。
- 所有 runtime/UI behavior 先 RED 后 GREEN；没有需求证据时明确 NO-GO。

## 当前实现

- Header 的 `Evidence` 按钮位于 transcript `Download` 附近，面板默认隐藏，支持明确点击和
  Refresh；只显示 Validations、Change sets、Files、Estimated export size。
- 面板成功和错误状态均为 generic；切换/new/rename/delete session 会取消请求并清理旧状态，
  validation/rerun/Undo 造成的 evidence 变化会提示刷新。
- 新增 UI contract 在 `apps/desktop/tests/server.test.ts`；实现位于
  `apps/desktop/public/index.html`；决定矩阵位于 `docs/evidence-preview-ui-v49.md`。

## 发布前验证

- [x] `pnpm verify`：TypeScript workspace **612/612**、preview contract **8/8**、
  release-gate contract **11/11**、Rust unit/doc **46/46**、real-Rust integration **10/10**。
- [x] `pnpm verify:typescript --report`：report 仍只含固定 metadata allowlist，step ids 为
  `structure`, `build`, `typecheck`, `typescript-test`, `preview-contract`, `gate-contract`。
- [x] `node scripts/check.mjs`、嵌入脚本 `node --check` 和 `git diff --check` 通过。
