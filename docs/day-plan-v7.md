# dev-agent 开发计划 v7（2026-09-11 14:20 → 18:50）

> 目标：把 v6 留下的审批边界补完（桌面端目前只能"一律拒绝"，不能点按钮确认），
> 再加一个运维自检命令与最小可用的会话管理，让这套东西在真实使用中好排查、好清理。

当前基线（v6 完成时已验证）：

- TypeScript 304 个测试 + Rust 46 个测试（43 lib + 3 bin）全部通过
- 真实 Rust 二进制集成用例 10 个通过
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿
- 工作区干净，`main` 与 origin 同步

时间窗：约 4.5 小时。执行协议见文末。

---

## 阶段 0：桌面端交互式审批（~1.5 小时）

**问题**：v6 里桌面端 `ask` 被降级成 `deny-dangerous`，因为没有让用户点"允许/拒绝"的通道。

**任务**：

1. `ChatSession.run(message, emit, { signal, requestApproval })`：新增可选的审批请求函数，
   由调用方决定"问谁"。开启 `ask` 且提供了该函数时，用"先策略判定、命中后再询问"的策略；
   没有函数时维持 v6 的保守行为（按拒绝处理）。
2. `server.ts`：SSE 新增 `approval-request` 事件（`{ id, tool, reason, input }`），
   新增 `POST /api/approval` 接收 `{ id, decision }`；未决请求在超时
   （`DEV_AGENT_APPROVAL_TIMEOUT_MS`，默认 120s）后按拒绝处理；未知 id 返回 404。
3. UI：`approval-request` 事件渲染一张带"允许/拒绝"按钮的提示条，点击后 POST，
   并把按钮置为不可再点；随后 `approval` 事件显示最终决定。
4. `DEV_AGENT_APPROVAL=ask` 在桌面端变成真正的交互式确认，文档同步更新。

**验收**：

- desktop 新增 >= 3 个用例：拒绝路径（命令没跑、模型看到 denial）、允许路径（命令跑了）、
  超时按拒绝（用很短的超时环境变量）
- `pnpm test` 全绿；未配置 `ask` 时行为不变

---

## 阶段 1：`dev-agent doctor` 自检（~1 小时）

**任务**：

1. CLI 新增 `--doctor`：逐项检查并输出 `ok` / `warn` / `fail`：
   - Node 版本（>= 20）
   - `rg` 可用（搜索工具依赖）
   - `protoc` 可用（仅构建 Rust 时需要，缺失记 warn）
   - Rust 执行器二进制（`--rust-executor` / `DEV_AGENT_RUST_BINARY`）存在，
     存在时发一次 HealthCheck 并显示版本与能力
   - 当前 provider 的 API key 是否齐备（ollama 记为 ok）
   - 会话目录存在且可写（不存在则尝试创建）
2. `--doctor --json` 输出机器可读结果，存在 `fail` 时退出码为 1。
3. 复用现有的 protobuf 解码与 spawn 逻辑，避免重复实现。

**验收**：

- CLI 新增 >= 3 个用例：全绿场景（用 mock 二进制与临时会话目录）、缺 provider key 记 fail、
  `--json` 输出可解析且退出码与 fail 对应
- `pnpm test` 全绿

---

## 阶段 2：会话删除（~1.5 小时）

**任务**：

1. CLI：`--session-delete <id>` 删除该会话的记忆文件；`--json` 时输出
   `{ sessionId, deleted }`；不存在的会话输出 `deleted: false` 且不算失败。
2. 桌面端：`DELETE /api/sessions/<id>` 删除记忆文件并从内存注册表移除；
   删除不存在的会话返回 404。
3. UI：会话选择器旁加删除按钮，`confirm()` 后调用接口，随后刷新列表并切回默认会话。
4. 文档：CLI/桌面端 README 补充删除用法与 `--json` 形状。

**验收**：

- CLI 新增 >= 2 个用例：删除已存在会话（文件消失）、删除不存在会话（不报错）
- desktop 新增 >= 2 个用例：删除成功返回 `{ deleted: true }` 且文件消失、删除不存在返回 404
- `pnpm test` 全绿

---

## 阶段 3：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新 `docs/architecture.md`（交互式审批、doctor、会话删除）
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## Backlog（阶段 0-3 都完成且时间未到 18:50 时继续）

1. **会话重命名**（~1 小时）：CLI `--session-rename <old> <new>` 与桌面端
   `POST /api/sessions/<id>/rename`，含冲突处理与测试。
2. **桌面端会话导出**（~1 小时）：`GET /api/sessions/<id>/export` 返回 Markdown 对话记录，
   UI 提供下载按钮。
3. **审批规则可配置**（~1.5 小时）：允许在 `~/.dev-agent/config.json` 里追加
   自定义危险模式与白名单（例如永远允许 `npm test`），CLI 与桌面端共用。

---

## 执行协议

每一轮开始时：

1. 读本文件与 `docs/day-plan-v7-progress.md` 恢复上下文；
2. `git status` 确认工作区；有未提交改动先按性质提交；
3. 取下一个未完成阶段，端到端做完（实现 + 测试 + 该阶段验收命令）；
4. 结果追加到进度账本；阶段通过后提交并推送，再进入下一阶段。

约束：

- 未开启新选项时行为不变；不引入新的运行时依赖。
- 单轮控制在 45 分钟左右，接近就先落盘进度。
- 用户不在场不要提问；不确定的取舍按"保守、可回退"决定并记录。
- **18:50 停止**：即便还有阶段未完成，也要写清状态并总结；若阶段与 backlog 都完成，
  直接收尾总结。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3 > Backlog
