# dev-agent 开发计划 v27

目标：工具超时**只对模型说谎，不真的停止工作**。

`runTool()` 用 `Promise.race` 实现超时：时间到就返回
`{"error":"Tool \"shell\" timed out after 300ms"}`，但**没有取消那个工具**。
`ToolExecutionContext.signal` 只承载了外层的运行中断信号，超时路径从不 abort 它，
所以被判定超时的命令会继续跑到底。

实测（`sh -c "sleep 3; echo ran > marker"`，工具超时 300ms）：

- `runTool` 在 304ms 后返回超时错误；
- 3.5 秒后 **marker 文件被写出来了**——命令从未停止。

后果不只是资源浪费：模型被告知"超时了"，于是它以为事情没做，但副作用（写文件、
改状态、网络请求、甚至破坏性命令）照旧发生。这会让模型基于错误前提继续行动。

当前基线（v26 完成时已验证）：

- TypeScript 446 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：超时时真正取消工具（~1 小时）

任务：

1. `runTool()` 为每次调用建立一个 `AbortController`：
   - 把它的 signal 传给 `tool.execute(...)`（与已有的 `context.signal` 合并：
     外层中断**或**本次超时都会 abort）；
   - 超时触发时先 `abort()`，再返回超时错误——这样 `LocalExecutor` 会杀掉子进程、
     `RustExecutor` 会发 `Envelope.cancel`。
2. 保持既有契约不变：超时仍以 `{"error":"Tool ... timed out after ...ms"}`
   字符串返回（模型可读），不抛异常；工具抛出的其它错误仍照原样抛出。
3. 已经完成/失败的调用不得被超时误伤（定时器要清理）。

验收：

- agent-core 新增 >= 3 个用例：
  - 超时会 abort 传入工具的 signal（工具能观察到）
  - 真实 shell 命令超时后不再产生副作用（`sleep 3; echo … > marker`，
    超时后等待足够长时间，marker 不存在）
  - 正常完成的工具不会被 abort（回归保护）
- 既有 `tool-timeout` / `tool-truncation` 用例保持通过
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/agent-core/README.md`（超时会取消工具）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v27-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
