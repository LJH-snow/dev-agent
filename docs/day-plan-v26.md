# dev-agent 开发计划 v26

目标：审批策略的"工作目录外写入"检查可以被**符号链接绕过**，而这正是它要防的事。

`outsideWorkingDirectoryWrite()` 只做字符串层面的路径归一化
（`resolve(workingDirectory, path)` 然后比较前缀）。如果工作目录里有一个指向
外部的符号链接，写入会跟随该链接落到目录之外，策略却认为它在目录内。

实测（工作目录内 `link.txt` -> 目录外 `secret.txt`）：

1. `filesystem write` 到 `link.txt`：策略判定 **allow**，实际把目录外的
   `secret.txt` 覆盖成了写入内容；
2. `filesystem mkdir` 到工作目录内的符号链接 `outdir/`（指向外部目录）：
   同样 allow，外部目录里真的被创建了 `newdir`。

这属于安全边界失效，不是体验问题。`deny-dangerous` 与 `ask` 两种模式都建立在
这个判断上。

当前基线（v25 完成时已验证）：

- TypeScript 441 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：用真实路径解析做边界判断（~1.5 小时）

任务：

1. `outsideWorkingDirectoryWrite()` 改为基于**解析后的真实路径**判断：
   - 用 `realpath` 解析工作目录本身；
   - 对目标路径，逐级解析到最深的**已存在**祖先（`realpathSync`），
     再把剩余的不存在部分拼回去；这样 `write`/`mkdir`（目标可能还不存在）
     也能覆盖；
   - 判断解析后的真实路径是否仍在工作目录的真实路径之内；不在则拒绝，
     错误信息里同时给出请求路径与解析后的真实路径。
2. 解析失败（例如权限问题、路径过长）时**保守拒绝**并说明原因，而不是放行。
3. 符号链接指向工作目录**内部**的情况必须保持放行（合法用法）。
4. 该检查仍只在 `filesystem` 的写类动作上生效，且 `deny-dangerous` / `ask`
   两种模式共用同一实现。

验收：

- agent-core 新增 >= 5 个用例：
  - 指向外部的文件符号链接：`write` 被拒
  - 指向外部的目录符号链接：`write` 与 `mkdir` 被拒
  - 指向**内部**的符号链接：仍然放行
  - 目标不存在但父目录是外部符号链接：被拒
  - 普通目录内路径：仍然放行（回归保护）
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/agent-core/README.md`（边界判断基于真实路径）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v26-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
