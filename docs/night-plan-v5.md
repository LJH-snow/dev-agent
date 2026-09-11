# dev-agent 开发计划 v5

> 目标：处理 v4 收尾时记录的两个真实边界——取消是"直接 SIGKILL"，以及上下文预算
> 超限时直接丢弃旧消息。前者让子进程没有清理机会，后者让长会话丢信息。

当前基线（v4 完成时已验证）：

- TypeScript 262 个测试 + Rust 42 个测试全部通过
- 真实 Rust 二进制集成用例 9 个通过（含取消）
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：优雅终止（~1.5 小时）

**问题**：`child.kill()` 与 Rust 的 `Child::kill()` 都是 SIGKILL，子进程没有机会
清理；且沙箱路径下 `sandbox-exec`/`bwrap` 是包装进程，直接杀包装进程可能留下
真正在跑的子进程（孤儿进程）。

**任务**：

1. Rust：`Command::process_group(0)`（Unix）让每条命令自成进程组；终止时先
   `killpg(SIGTERM)`，等待宽限期（2s），仍在跑就 `killpg(SIGKILL)`。
2. Rust：把取消、超时统一走这套 `terminate()`；输出截断仍用立即结束（此时管道
   已停止读取，命令必然阻塞在写上）。
3. TS `LocalExecutor`：spawn 时 `detached: true`（非 Windows），终止时先对进程组
   发 SIGTERM，2s 后未退出再 SIGKILL；超时路径同样走这套。
4. 非 Unix 平台退回单个进程的 `kill()`。

**验收**：

- Rust：新增用例——子进程 `trap "" TERM` 时仍能被结束（宽限期后升级 SIGKILL），
  且返回 `Cancelled`
- TS：同样场景下 `LocalExecutor` 在宽限期内拒绝为 `ExecutorCancelledError`
- 既有取消用例保持 < 3s 通过
- `cargo test`、`pnpm test` 全绿

---

## 阶段 1：上下文预算改为增量摘要（~2 小时）

**问题**：v3 的 `contextBudget` 超限时直接丢最旧的条目，只留一行
`[context] N earlier entries omitted`，长会话里的决定、路径、命令全部丢失。

**任务**：

1. `contextBudget` 增加 `summarize?: boolean`（默认 false，保持现状）。
2. 开启后，被裁掉的条目改为增量摘要：只对"新被裁掉的那一段"调用一次模型生成
   摘要，追加进已有摘要，而不是每次重跑全量。
3. 摘要以 `[summary] …` 系统消息插入 system prompt 之后；摘要调用消耗的 token
   计入会话 usage 并触发 `onUsage`。
4. 摘要失败（网络、超时、空结果）时回退到原来的 `[context] N earlier entries
   omitted` 行为，不能因为摘要失败而中断对话。
5. CLI/桌面端配置：`DEV_AGENT_SUMMARIZE_CONTEXT=1` 或 `summarizeContext: true`
   开启（与 `maxChars` 配套使用）。

**验收**：

- agent-core 新增 >= 5 个用例：开启摘要后请求里出现 `[summary]`、被裁条目不再
  原样出现、增量摘要只处理新增部分、摘要调用计入 usage、摘要失败时回退提示
- CLI 端到端用例：设置预算 + 开启摘要时，provider 收到的请求包含摘要消息
- `pnpm test` 全绿，未配置时行为与现在完全一致

---

## 阶段 2：文档、回归与提交（~45 分钟）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新 `docs/architecture.md`（终止策略、摘要路径）
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行约束

- 不引入新的运行时依赖（进程组用 `libc`，已有）。
- 未开启新选项时行为不变。
- 每个阶段结束跑对应验收；不通过就地修复再继续。
- 提交信息沿用 `feat:` / `fix:` / `test:` / `docs:` 约定。

## 优先级

阶段 0 > 阶段 1 > 阶段 2

先修"杀不干净"的正确性问题，再做会让长会话变贵的摘要（摘要本身也依赖 v4 的
usage 统计来观察成本）。
