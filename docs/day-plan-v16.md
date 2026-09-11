# dev-agent 开发计划 v16

> 目标：继续「先复现、再修」。本轮收口两处 agent 会「无法自救」的失败路径——
> 工具抛错会直接结束整轮（模型看不到错误、没法改路），以及
> `code-search` 的 references/definition 在行号/列号越界时抛出 TypeScript
> 内部错误（`Debug Failure. Bad line number`）。

当前基线（v15 完成时已验证）：

- TypeScript 403 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：工具错误写回给模型，而不是结束整轮（~1 小时）

**证据**（2026-09-12 实测 `AgentLoop`）：工具抛错时
`runTool` 的异常直接冒泡到 run 的 catch：模型只被调用 1 次，结果
`status: "error"`, `lastError: "bad path"`，对话里只有一条
`assistant: [error] bad path`。同样的循环对「超时」和「审批拒绝」都会把错误写成
工具结果让模型改路，只有硬错误例外。

**任务**：

1. `AgentLoop` 调用 `runTool` 时捕获异常（abort 仍然向上抛），把
   `{ error: <message> }` 作为该工具的 result 写入 memory，并继续下一轮。
2. 未知工具名（`Tool not found: X`）走同一条路径。
3. 模型持续调用失败工具时仍由 `maxTurns` 收口，不会无限循环。

**验收**：

- agent-core 用例：失败工具后模型收到错误并能给出最终答案（status done，
  模型调用 >= 2 次）；未知工具同样可恢复；持续失败时以 maxTurns 结束
- 既有 `Tool not found` 用例按新语义更新
- `pnpm test` 全绿

---

## 阶段 1：`code-search` 校验行号/列号（~45 分钟）

**证据**（2026-09-12 实测）：对只有 1 行的文件请求
`mode: "references", line: 99`，工具抛出
`Debug Failure. Bad line number. Line: 98, lineStarts.length: 2`。

**任务**：

1. references / definition 在调用 TypeScript language service 之前，用扫描到的
   源码校验：行号超出文件行数、列号超出该行长度时给出可读错误
   （`code-search line 99 is beyond the end of …`）。
2. line/column 合法时行为不变。

**验收**：

- tools 新增 >= 2 个用例：行号越界与列号越界都返回可读错误而不是 TS 内部错误
- 既有 references/definition 用例保持全绿
- `pnpm test` 全绿

---

## 阶段 2：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新受影响的 README 与 `docs/architecture.md`
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v16-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2
