# dev-agent 开发计划 v30

目标：**"重命名成同一个名字"被报成"会话不存在"**，CLI 与桌面端都不区分
「源与目标相同」和「源不存在」。

CLI 实测（会话文件 `a.json` 确实存在）：

- `--session-rename a a` -> `Session a not found.`，退出码 0

原因：`main()` 里 `if (from !== to)` 才会执行 rename，所以同名时 `renamed` 一直是
`false`，输出落到 `Session ${from} not found.` 分支——但文件明明在。用户会以为
会话丢了。

桌面端（`POST /api/sessions/<id>/rename`）实测：源文件不存在、且新旧 id 相同时，
返回 `{ from, to, renamed: false }`（200），与"文件确实存在、只是名字没变"无法区分。

当前基线（v29 完成时已验证）：

- TypeScript 457 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：区分"没变化"与"不存在"（~1 小时）

任务：

1. CLI `--session-rename`：
   - `from === to` 时不再谎报 not found：若源文件存在，输出
     `Session <id> already has that name.`；若不存在，仍报 `Session <id> not found.`
   - `--json` 的 `{ from, to, renamed }` 结构保持不变（`renamed: false`），
     但语义正确：只有真改名才 `renamed: true`。
2. 桌面端 `POST /api/sessions/<id>/rename`：
   - `from === to` 且源文件不存在 -> `404 unknown session`（与其它未知会话一致）；
   - `from === to` 且源文件存在 -> 200 `{ from, to, renamed: false }`（幂等成功）；
   - 已有的"目标已存在 -> 409"、"源缺失 -> 404"、"正常改名 -> 200"行为不变。

验收：

- cli 新增 >= 2 个用例：同名且存在（不再说 not found）、同名且不存在（仍报 not found）
- desktop 新增 >= 2 个用例：同名且存在（200 / renamed:false）、
  同名且不存在（404）
- 既有 rename 用例保持通过
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `apps/cli/README.md` 与 `apps/desktop/README.md`（同名重命名的语义）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v30-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
