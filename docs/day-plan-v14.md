# dev-agent 开发计划 v14

> 目标：继续「先复现、再修」的节奏。本轮收口三类参数注入/误导问题——
> `search` 把模型给的 query 当成 ripgrep 选项；`git` 工具可以用
> `-c alias.x=!cmd` 绕过审批执行任意命令；`--metadata` 把损坏的会话文件
> 伪装成「没有会话」。

当前基线（v13 完成时已验证）：

- TypeScript 395 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：`search` 不再把 query 当作 ripgrep 选项（~45 分钟）

**证据**（2026-09-11 实测 `SearchTool` + `LocalExecutor`）：

| query | 现状 |
|-------|------|
| `hello` | 正常匹配文件内容 |
| `--files` | 被当成 `rg --files`，列出文件名而不是搜索该文本 |
| `--version` | 被当成 `rg --version`，打印 ripgrep 版本 |
| `--pre=echo` | 被当成 ripgrep 预处理器选项 |

模型可以借此触碰 ripgrep 的全部选项（`--pre`、`-f`、`--files`、`--type` 等），
在 `deny-dangerous` / `ask` 模式下也没有任何审批提示。

**任务**：

1. `SearchTool` 在 query 之前插入 `--` 选项终止符，让 query 永远按字面模式
   解释，path 也不再可能被当成选项。
2. 保持 `filesOnly`（`-l`）与默认参数不变。

**验收**：

- tools 新增 >= 3 个用例：query `--files` 按字面匹配包含该文本的文件；
  query `-e` 不会吞掉 path；普通查询行为不变
- `pnpm test` 全绿

---

## 阶段 1：审批策略拦住 `git` 的命令执行选项（~1 小时）

**证据**（2026-09-11 实测 `GitTool`）：在空白目录执行
`git -c alias.probe=!echo injected-command-ran probe` 返回 exit 0，
stdout 为 `injected-command-ran`——模型可以通过 git 别名执行任意 shell 命令，
而 `denyDangerousPolicy` 对 git 工具完全不拦。

**任务**：

1. 危险模式表新增 "git command execution"：命令行里出现 `-c`、
   `--config-env`、`--exec-path`、`--upload-pack`、`--receive-pack` 时标记为危险
   （这些选项都能让 git 执行外部命令或改写执行环境）。
2. 普通 git 命令（`status`、`log`、`diff`、`push origin main`）保持放行；
   `approval.allow` 白名单仍然优先。

**验收**：

- agent-core 新增 >= 3 个用例：`-c alias.x=!cmd` DENY、`--exec-path` DENY、
  `git status` / `git log` 保持 ALLOW、白名单可豁免该模式
- 既有 approval 用例保持全绿
- `pnpm test` 全绿

---

## 阶段 2：损坏会话文件的 `--metadata` 提示（~45 分钟）

**证据**（2026-09-11 实测）：会话文件为 `{ not json` 时，
`--metadata` 输出 `No session metadata found.` 且 exit 0（误导用户以为没有会话），
而 `--compact` 同一文件会以 exit 1 报 `Invalid memory file`。

**任务**：

1. `--metadata` 在文件存在但无法解析时打印明确的错误（文本模式）或
   `{ error, path }`（`--json`），exit 1，并提示用 `--reset-memory` 或
   `--session-delete <id>` 恢复。
2. 文件确实不存在时保持现状（`No session metadata found.`，exit 0）。

**验收**：

- cli 新增 >= 2 个用例：损坏文件时文本与 `--json` 都 exit 1 且带路径与恢复提示；
  缺失文件仍是 exit 0
- `pnpm test` 全绿

---

## 阶段 3：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新受影响的 README 与 `docs/architecture.md`
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v14-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3
