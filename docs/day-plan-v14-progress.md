# day-plan v14 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v14.md`；结束前追加日志。

## 当前状态

- 当前阶段：无，`docs/day-plan-v14.md` 的四个阶段已全部完成
- 已完成阶段：阶段 0、阶段 1、阶段 2、阶段 3
- 最近一次运行：运行 4（2026-09-12 01:0x-01:2x）
- 工作区：阶段 3 的文档改动提交后即 clean

## 日志

### 运行 4 — 2026-09-12 01:0x-01:2x

- 阶段/工作项：阶段 3（文档、全量回归与提交）完成
- 做了什么：
  - 根 `README.md`：Current Status 增加 search 字面模式、git 命令执行选项、
    `--metadata` 损坏文件提示三条，测试数更新为 401 TS + 46 Rust；
    Roadmap 追加 47-49
  - `docs/architecture.md`：tools 的 `--` 分隔、approval 的 git 执行模式、
    CLI 的 metadata 读回校验
  - `docs/CHANGELOG.md`：新增「Day plan v14」条目（395 -> 401），三条修复
    都带实测复现证据
- 验证命令与结果（完整矩阵）：
  - `node scripts/check.mjs`：Structure check passed（13 目录 / 34 文件）
  - `pnpm build`：通过
  - `pnpm typecheck`：通过
  - `pnpm test`：401 passed / 0 failed
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed / 0 failed
  - `cargo fmt --check`：通过
  - `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）/ 0 failed
- 提交：见阶段 3 的 docs 提交
- 下一步：v14 计划已收尾；继续实测复现优先，下一轮优先看 MCP 往返/重连、
  上下文摘要与工具审批在大输出场景下的边界

### 运行 3 — 2026-09-12 00:4x-01:0x

- 阶段/工作项：阶段 2（损坏会话文件的 `--metadata` 提示）完成
- 复现：会话文件为 `{ not json` 时 `--metadata` 输出
  `No session metadata found.` 且 exit 0；同一文件 `--compact` 会 exit 1 报
  `Invalid memory file`
- 做了什么：
  - 抽出 `memoryFilePath(sessionId)` 供 `createMemory` 与 metadata 共用
  - 新增 `isInvalidMemoryFile(filePath, memory)`：文件不存在返回 false；存在时
    尝试 `entries()`，能读回说明是「合法但没有 metadata」，读不回来才是损坏
  - `--metadata` 分支：损坏时文本模式在 stderr 打印 `Invalid memory file: <路径>.
    Use --reset-memory or --session-delete <id> to recover.` 并 exit 1；
    `--json` 输出 `{ error: "invalid memory file", path }`；文件缺失仍是原行为
  - 新增 3 个用例：损坏文件（文本）、损坏文件（`--json`）、合法但无 metadata 的
    文件仍 exit 0
  - 实测复测：损坏 -> exit 1 + 恢复提示；缺失 -> exit 0
    `No session metadata found.`；`--json` -> `{ error, path }`
- 验证命令与结果：
  - `pnpm --filter @dev-agent/cli build`：通过
  - `apps/cli`（`tests/cli-e2e.test.mjs`）：9 passed（6 + 3）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 401 个测试，0 失败）
- 提交：见阶段 2 的 fix 提交
- 下一步：阶段 3 — 根 README / architecture / CHANGELOG 更新 + 完整回归矩阵

### 运行 2 — 2026-09-12 00:2x-00:4x

- 阶段/工作项：阶段 1（审批策略拦住 `git` 的命令执行选项）完成
- 复现：`GitTool` + 空白目录下 `git -c alias.probe=!echo injected-command-ran probe`
  实际返回 exit 0、stdout 含 `injected-command-ran`，而 `denyDangerousPolicy`
  对 git 工具没有任何拦截
- 做了什么：
  - 危险模式表新增 "git command execution"：命令行里以 `-c` 开头（含
    `-calias...` 形式）或出现 `--config-env` / `--exec-path` /
    `--upload-pack` / `--receive-pack` 时标记为危险；token 边界避免把
    `feature-c` 这类参数误判
  - 测试：内置模式表断言扩充（`-c` 别名、`--exec-path`、`--receive-pack`
    均 DENY；`status` / `log --oneline` / `push origin feature-c` 仍 ALLOW），
    并新增 1 个白名单豁免用例
  - 实测复测：三条危险形态 DENY 且 reason 为 `git command execution`；
    普通 git 命令保持 ALLOW
- 验证命令与结果：
  - `pnpm --filter @dev-agent/agent-core build`：通过
  - `packages/agent-core`：59 passed（58 + 1）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 398 个测试，0 失败）
- 提交：见阶段 1 的 fix 提交
- 下一步：阶段 2 — `--metadata` 对损坏会话文件给出明确错误与恢复提示

### 运行 1 — 2026-09-12 00:0x-00:2x

- 阶段/工作项：阶段 0（`search` 不再把 query 当作 ripgrep 选项）完成
- 复现：`SearchTool` + `LocalExecutor` 下，query `--files` 被当成 `rg --files`
  （列文件名）、`--version` 打印 ripgrep 版本、`--pre=echo` 被当成预处理器选项
- 做了什么：
  - `SearchTool` 在 query 前插入 `--` 选项终止符：query 永远按字面模式解释，
    path 也不会被当成选项；`filesOnly`（`-l`）与其它参数不变
  - 新增 2 个测试：`--files` 按字面匹配到包含该文本的文件（而不是列文件名）、
    `-f` 不会吞掉 path；`tools-edge-cases` 的两处 rg 参数断言同步加入 `--`
  - 实测复测：query `--files` 现在返回
    `./a.txt:1:mentions --files literally`
- 验证命令与结果：
  - `pnpm --filter @dev-agent/tools build`：通过
  - `packages/tools`：68 passed（66 + 2）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 397 个测试，0 失败）
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 危险模式表新增 "git command execution"
  （`-c` / `--config-env` / `--exec-path` / `--upload-pack` / `--receive-pack`）

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | - |
