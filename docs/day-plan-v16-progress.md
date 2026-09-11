# day-plan v16 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v16.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（`code-search` 校验行号/列号）未开始
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 02:2x-02:4x）
- 工作区：阶段 0 的改动待提交

## 日志

### 运行 1 — 2026-09-12 02:2x-02:4x

- 阶段/工作项：阶段 0（工具错误写回给模型）完成
- 复现：工具抛错时 `runTool` 的异常冒泡到 run 的 catch，模型只被调用 1 次，
  结果 `status: "error"`, `lastError: "bad path"`；超时与审批拒绝却会把错误
  写回给模型
- 做了什么：
  - `AgentLoop` 新增 `runToolSafely()`：捕获工具异常（abort 仍向上抛），
    把 `{"error": <message>}` 作为该工具的 result 写入 memory 并继续下一轮；
    未知工具名与「无 tools 配置」前的 `Tool not found` 走同一路径
  - 用例更新/新增：缺失工具后模型能恢复（status done、模型调用 2 次）、
    工具抛错后同样恢复、持续失败时仍以 maxTurns 收口（status error）
  - 实测复测：抛错工具后模型收到 `{"error":"bad path"}`，第二次调用返回最终答案，
    `status: done`
- 验证命令与结果：
  - `pnpm build` / `pnpm typecheck`：通过
  - `packages/agent-core`：62 passed（60 + 2；缺失工具用例按新语义重写）
  - `pnpm test`：全绿（TypeScript 405 个测试，0 失败）
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — `code-search` references/definition 的行号/列号校验

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | - |
