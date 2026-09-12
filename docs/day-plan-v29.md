# dev-agent 开发计划 v29

目标：工作目录不存在时，工具会给出**指向错误实体**的诊断信息，把模型引向错误方向。

实测（`workingDirectory` 指向不存在的路径）：

- `shell` 工具返回 `spawn echo ENOENT`
- `git` 工具返回 `spawn git ENOENT`
- `search` 工具返回 `spawn rg ENOENT`

但 `echo` / `git` / `rg` 明明都装好了——真正不存在的是工作目录。Node 的
`child_process.spawn` 在 cwd 无效时给出的就是这个误导性信息（`error.path` 甚至
是命令名），所以调用方无法从错误里判断该修哪个。

后果：模型看到"找不到 echo"，会去检查 PATH、尝试 `/bin/echo`、或换命令，
而真正要修的是工作目录。尤其常见于：会话从已删除的 worktree 恢复、
`--session` 指向旧目录、或用户传了拼错的路径。

当前基线（v28 完成时已验证）：

- TypeScript 453 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：spawn 前校验工作目录（~1 小时）

任务：

1. `LocalExecutor.execute()` 在 spawn 之前检查 `options.cwd`：
   - 不存在 -> 明确报错：`working directory does not exist: <path>`
     （说明是工作目录问题，而不是命令问题）；
   - 存在但不是目录 -> `working directory is not a directory: <path>`；
   - 未传 `cwd` -> 行为不变（用进程当前目录）。
2. `RustExecutor` 同样在 `runSandboxed()` 发请求前做一次校验，保证两条执行路径
   给出同样的诊断（sandbox 的 cwd 违规也应是"目录问题"而非别的）。
3. 校验只在**调用时**发生（不做缓存），这样目录被删除后下一次调用立刻能报出来。
4. 现有行为保持不变：`cwd` 合法但命令确实不存在时，仍然报命令不存在。

验收：

- executor 新增 >= 4 个用例：
  - `LocalExecutor` 对不存在的 cwd 报出 `working directory does not exist`
  - `LocalExecutor` 对"cwd 是文件"报出 `not a directory`
  - cwd 合法 + 命令不存在：仍然报命令相关错误（回归保护）
  - `RustExecutor` 对不存在的 cwd 给出同样清晰的错误（不 spawn runtime 也成立）
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/executor/README.md`（cwd 校验与错误语义）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v29-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
