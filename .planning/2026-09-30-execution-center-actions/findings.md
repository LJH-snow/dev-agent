# Findings — Execution Center v2

## 可复用入口

- Stop 当前调用 POST /api/chat/cancel，并由 index.html 的 stopButton 管理状态。
- Trace 当前通过 loadTraceSnapshot(sessionId) 加载现有 Runtime Trace 面板。
- Validation 当前由 taskValidationUI.refresh/sessionChanged 管理，面板在 task workspace 内。
- Autofix 当前由 enqueueAutoFix(sessionId) 进入已有 plan-mode queue，并由已有 validation action 触发。

## 设计决定

- execution-center.js 只负责选择、详情渲染和回调调度；session 生命周期仍由 index.html 持有。
- Autofix 能力依据当前聚合快照的 validation.lastResult 判断，实际执行仍由已有队列和服务端 fail-closed 逻辑决定。
