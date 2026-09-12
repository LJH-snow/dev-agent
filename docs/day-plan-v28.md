# dev-agent 开发计划 v28

目标：桌面端 SSE **没有任何背压处理**，客户端不读（或读得很慢）时服务端内存会
无上限增长。

`streamChat()` 的 `emit()` 只做 `res.write(...)`，从不检查 `res.writableLength`
或等待 `drain`。模型流式输出 + 工具输出会以远超慢速客户端消费速度的节奏灌进
socket 缓冲区。

实测（桩会话连续 emit 20 万个 token 事件，客户端连接后立刻 `pause()` 不读）：

- 4 秒后服务端 `heapUsed` 达到 **192 MB**，且没有任何上限或告警；
- 这是一个普通的 HTTP 客户端就能触发的问题（不需要特殊权限），配合真实的
  长回复/大工具输出即可把桌面进程的内存推高。

当前基线（v27 完成时已验证）：

- TypeScript 450 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：给 SSE 输出加上限（~1.5 小时）

任务：

1. `emit()` 跟踪已写入字节数，加一个可配置上限
   （`DEV_AGENT_SSE_MAX_BYTES`，默认 32 MiB）：
   - 未超限：行为与今天完全一致；
   - 超限：停止继续写、给客户端补发一个 `error` 事件（说明上限与原因）、
     然后 `res.end()` 并 `controller.abort()`，让正在跑的工具/模型一起停下，
     而不是继续在内存里堆积。
2. 该上限按**单个流**计数（每个 `/api/chat` 一个），流结束即释放。
3. 正常规模的回话（含大工具输出）必须在默认上限内，行为不变。

验收：

- desktop 新增 >= 4 个用例：
  - 超过上限时收到 `error` 事件，且流被结束（不再无限缓冲）
  - 上限触发时正在运行的会话收到 abort（工具被取消）
  - 未超限的长回复仍完整送达（回归保护）
  - `DEV_AGENT_SSE_MAX_BYTES` 可覆盖默认值
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `apps/desktop/README.md`（SSE 上限与其行为）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v28-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
