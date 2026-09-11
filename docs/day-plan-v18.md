# dev-agent 开发计划 v18

> 目标：CLI 目前对**拼错的参数**完全沉默。`--nope` 会被忽略并进入交互模式，
> `--once --json` 会把 `--json` 当成提示词发给模型，`--session --once hi`
> 会把 `--once` 当成会话 id 并在磁盘上创建 `once.json`。这些都是静默做错事，
> 在脚本/CI 里尤其危险。本计划让参数解析变严格。

当前基线（v17 完成时已验证）：

- TypeScript 407 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- 测试已全部迁移为 TypeScript（`tests/` → `tests-dist/` 由 `node --test` 执行）
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：严格参数校验（~1.5 小时）

**任务**：

1. 在 `apps/cli/src/index.ts` 的 `main()` 开头加 `validateCliArgs(args)`：
   用一张「参数规格表」声明每个 flag 的取值个数（无 / 一个 / 两个 / 可选一个）。
2. 三类错误都要报错并 `exitCode = 1`（stderr，且不进入交互模式）：
   - 未知 flag：`Unknown option '--nope'. Run with --tools to list options.`
   - 取值缺失或取值本身是 flag：`--session requires a session id`
     （即 `--session --once hi` 这种"把下一个 flag 当值吞掉"）
   - 多余的位置参数：`Unexpected argument 'hello'`
3. 合法输入行为**完全不变**（含 `--compact` 无值默认 5、`--check-rust [path]` 可选值）。

**验收**：

- `apps/cli` 新增 >= 6 个用例：未知 flag、取值被 flag 顶掉、`--once --json`、
  多余位置参数、合法组合仍正常、`--compact` 可选值仍正常
- 手工复现：三条错误命令都退出码 1 且不再创建会话文件
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `apps/cli/README.md`（说明未知参数会被拒绝）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v18-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
