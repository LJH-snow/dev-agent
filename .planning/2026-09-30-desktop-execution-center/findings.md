# Findings — Desktop 执行状态中心

## 已有能力

- apps/desktop/src/run-state.ts 已提供 bounded run snapshot、live tool/approval 状态和游标恢复。
- apps/desktop/src/parallel-runs.ts 已提供跨 session 的安全运行卡片和统计，但 UI 只显示并行运行列表。
- apps/desktop/src/status.ts 已提供 allowlisted executor/runtime/approval/validation metadata。
- apps/desktop/public/index.html 已有 Runtime status、Run timeline、Runtime Trace 和 Parallel Runs，但它们由多个独立请求/面板维护。
- Desktop server 已有 /api/sessions/:id/run、/api/parallel-runs、/api/status，适合新增只读聚合入口而不改变现有协议。

## 设计决定

- 复用 DesktopRunSummary 与 DesktopRunLiveState，不复制运行状态机。
- 聚合接口只返回 session id、用户显式 presentation title、状态、stage、工具名/进度、审批等待和时间元数据。
- 当前 session 的 executor/runtime/approval/validation 使用现有 DesktopStatusSnapshot 的 allowlisted 子集。
- 面板使用独立模块和 textContent，不把新逻辑继续塞入 index.html 内联脚本。
