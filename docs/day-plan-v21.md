# dev-agent 开发计划 v21

目标：桌面端**没有停止按钮**。服务端已经具备"中止运行"的全部能力——断线时
`res` 的 close 事件会 `controller.abort()`，`ChatSession.run` 收到 abort 会发
`done { status: "aborted" }`，执行器也会杀掉在跑的命令——但用户没有触发它的入口：
发送后 `send.disabled = true`，在模型或命令跑完之前只能干等，或者刷新页面
（那反而会销毁整个流）。

当前基线（v20 完成时已验证）：

- TypeScript 421 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：显式取消正在运行的会话（~1.5 小时）

任务：

1. 服务端把每个会话在飞的 `AbortController` 存进 `Map<sessionId, AbortController>`
   （与现有 `inFlight` 集合一起维护），断线逻辑继续复用同一个 controller。
2. 新增 `POST /api/chat/cancel`，body `{ sessionId }`：
   - 该会话有在飞运行时：`abort()` 并返回 `{ sessionId, cancelled: true }`；
     被中止的流以既有 `done { status: "aborted" }` 收尾；
   - 没有在飞运行时：返回 `{ sessionId, cancelled: false }`（不报错，便于前端
     把按钮做成幂等）；
   - 非法 body -> 400；未知会话按现有其它路由的惯例处理。
3. UI 在 header 增加 `Stop` 按钮：仅在流式进行中可用，点击后 POST cancel，
   状态显示 `aborted`；流结束后按钮恢复禁用（由流本身结束时统一收尾，
   不依赖 cancel 响应）。

验收：

- desktop 新增 >= 3 个用例：
  - 在飞运行被 cancel：SSE 流以 `done {status:"aborted"}` 结束，且
    `cancelled: true`
  - 空闲时 cancel：`cancelled: false` 且不产生副作用
  - cancel 之后同一会话可以立刻再发起新请求（锁已释放，不再 409）
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `apps/desktop/README.md`（新增接口与停止按钮说明）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v21-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
