# dev-agent 开发计划 v20

目标：交互模式（`dev-agent` 不带 `--once`）的会话循环是坏的，而 README 还写着
"Ctrl-C interrupt handling with session state preservation"。三处实测问题：

1. 运行中按 Ctrl-C 只打印 `(interrupted)`，在飞的模型请求不会被取消，
   进程要等请求自己结束；
2. 空闲停在提示符时按 Ctrl-C 同样只打印一行，退不出去；
3. `interactive()` 从不接收 `runPrompt()` 返回的 context，所以每个 prompt
   都从 `turns=1` 重新开始、`[usage]` 永远只报当次（实测 15/15/15，
   而不是累加的 15/30/45）。

当前基线（v19 完成时已验证）：

- TypeScript 418 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：把交互循环修成真正的会话循环（~1.5 小时）

任务：

1. `runPrompt()` 返回 `AgentContext`，并接受一个可选的 `AbortSignal`，
   透传给 `loop.run(context, prompt, { signal })`。
2. `interactive()` 维护一个可变的 current context，每个 prompt 结束后接住
   返回值，使 `turns` 与 `usage` 跨 prompt 累加。
3. SIGINT 处理器改成真正的中断：有在飞请求时 `abort()` 它（复用 exec 与
   agent-core 已有的取消链路）；同时 `rl.close()`，把停在 `rl.question()`
   上的等待解开；中断后退出循环并置 `exitCode = 130`（与 shell 惯例一致）。
4. 中断不算失败：abort 抛出的错误在 `interrupted` 为真时被吞掉，
   会话内存保留，下一次进程启动能接着用。

验收：

- `apps/cli` 新增 >= 3 个用例：
  - 两个 prompt 后 `turns=2`，`[usage]` 第二行是累加值（15 -> 30）
  - 运行中 SIGINT：1.5 秒内退出（桩 provider 挂 20 秒），退出码 130
  - 空闲时 SIGINT：1 秒内退出，退出码 130
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `apps/cli/README.md`（交互模式的 Ctrl-C 语义与会话状态）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v20-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
