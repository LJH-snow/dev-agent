# day-plan v16 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v16.md`；结束前追加日志。

## 当前状态

- 当前阶段：无，`docs/day-plan-v16.md` 的三个阶段已全部完成
- 已完成阶段：阶段 0、阶段 1、阶段 2
- 最近一次运行：运行 3（2026-09-12 03:1x-03:3x）
- 工作区：阶段 2 的文档改动提交后即 clean

## 日志

### 运行 3 — 2026-09-12 03:1x-03:3x

- 阶段/工作项：阶段 2（文档、全量回归与提交）完成
- 做了什么：
  - 根 `README.md`：Current Status 增加「工具错误写回模型」「code-search
    位置校验」两条，测试数更新为 407 TS + 46 Rust，Roadmap 追加 52-53
  - `docs/architecture.md`：agent-core 的 `runToolSafely` 语义、tools 的位置校验
  - `docs/CHANGELOG.md`：新增「Day plan v16」条目（403 -> 407），两条修复都带
    实测复现证据
- 验证命令与结果（完整矩阵）：
  - `node scripts/check.mjs`：Structure check passed（13 目录 / 34 文件）
  - `pnpm build`：通过
  - `pnpm typecheck`：通过
  - `pnpm test`：407 passed / 0 failed
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed / 0 failed
  - `cargo fmt --check`：通过
  - `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）/ 0 failed
- 提交：见阶段 2 的 docs 提交
- 下一步：v16 计划已收尾。用户追问「GitHub 语言占比为什么 JS 很多」：实测根因是
  73 个 `.mjs` 测试（Linguist 归类为 JavaScript，380,492 字节）大于 48 个 `.ts`
  源码（297,085 字节）；被跟踪的 `.js` 为 0，磁盘上的 `.js` 全在 gitignore 的
  `dist/` 里。**用户决定不处理该问题**：不改测试语言、不加 `.gitattributes`、
  不把语言统计相关改动提交到仓库；测试继续按现有约定写 `.mjs`

### 运行 2 — 2026-09-12 02:5x-03:1x

- 阶段/工作项：阶段 1（`code-search` 校验行号/列号）完成
- 复现：对只有 1 行的文件请求 `mode: "references", line: 99`，工具抛出
  TypeScript 内部错误 `Debug Failure. Bad line number. Line: 98 …`
- 做了什么：
  - references / definition 在调用 language service 前用扫描到的源码校验：
    行号超过文件行数、列号超过该行长度时给出可读错误
    （`code-search line 99 is beyond the end of …`）
  - 行号/列号改为必须 >= 1（`parseLineOrColumn`）：`line: 0` 以前会触发
    `Debug Failure`，现在报 `line must be a positive integer`
  - 新增 2 个用例：行号越界 + line 0、列号越界；既有 references/definition 用例不变
  - 实测复测：三种越界输入都返回可读错误
- 验证命令与结果：
  - `pnpm --filter @dev-agent/tools build`：通过
  - `packages/tools`：70 passed（68 + 2）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 407 个测试，0 失败）
- 提交：见阶段 1 的 fix 提交
- 下一步：阶段 2 — 根 README / architecture / CHANGELOG 更新 + 完整回归矩阵

### 运行 1 — 2026-09-12 02:2x-02:4x

- 阶段/工作项：阶段 0（工具错误写回给模型）完成
- 复现：工具抛错时 `runTool` 的异常冒泡到 run 的 catch，模型只被调用 1 次，
  结果 `status: "error"`, `lastError: "bad path"`；超时与审批拒绝却会把错误
  写回给模型
- 做了什么：
  - `AgentLoop` 新增 `runToolSafely()`：捕获工具异常（abort 仍向上抛），
    把 `{"error": <message>}` 作为该工具的 result 写入 memory 并继续下一轮；
    未知工具名与「无 tools 配置」前的 `Tool not found` 走同一路径
  - 用例更新/新增：缺失工具后模型能恢复（status done、模型调用 2 次）、
    工具抛错后同样恢复、持续失败时仍以 maxTurns 收口（status error）
  - 实测复测：抛错工具后模型收到 `{"error":"bad path"}`，第二次调用返回最终答案，
    `status: done`
- 验证命令与结果：
  - `pnpm build` / `pnpm typecheck`：通过
  - `packages/agent-core`：62 passed（60 + 2；缺失工具用例按新语义重写）
  - `pnpm test`：全绿（TypeScript 405 个测试，0 失败）
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — `code-search` references/definition 的行号/列号校验

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | - |
