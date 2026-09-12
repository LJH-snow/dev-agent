# day-plan v19 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v19.md`；结束前追加日志。

## 当前状态

- 当前阶段：已完成（阶段 0 + 阶段 1）
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 2（2026-09-12 07:5x-08:2x）
- 工作区：全部已提交并推送

## 日志

### 运行 1 — 2026-09-12 07:2x-07:5x

- 阶段/工作项：阶段 0（修正 read 的行语义）完成
- 做了什么：
  - `packages/tools/src/filesystem.ts` 新增 `splitLines()`：空串 -> 0 行；
    结尾的一个换行视为终止符而不是新行（`"a\n"` -> 1 行、`"\n"` -> 1 行、
    `"a\n\n"` -> 2 行）；`lines.join("\n")` 仍能还原原文
  - `readFileRange` 的越界分支不再回显请求的 offset，而是把空区间钉在文件上：
    3 行文件 `offset: 99` -> `startLine: 4` / `endLine: 3` / `totalLines: 3`
    （原来是倒挂的 99 / 98）
  - `packages/tools/tests/filesystem-edit.test.ts` 新增 5 个用例
- 验证命令与结果：
  - 修复前后对照（实测）：
    - `"one\ntwo\nthree\n"` 的 `totalLines`：4 -> **3**
    - `offset: 99`：`startLine/endLine` 99/98 -> **4/3**，`totalLines` 2 -> **3**
    - 不受影响的路径：`offset: 2, limit: 1` 仍返回 `content: "two"`、
      `truncated: true`；空文件 0 行；只含 `"\n"` 的文件 1 行
  - `packages/tools`：75 passed（70 + 新增 5）
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**418 passed / 0 failed**
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 文档、完整回归矩阵、提交推送

### 运行 2 — 2026-09-12 07:5x-08:2x

- 阶段/工作项：阶段 1（文档 + 全量回归）完成
- 做了什么：
  - `packages/tools/README.md`：写明 read 的行语义（结尾换行是终止符、
    空文件 0 行）与越界 offset 的空区间表示
  - 根 `README.md`：Current Status 增加该行为；Roadmap 增加第 49 项
  - `docs/CHANGELOG.md`：新增 v19 条目（含修复前后对照）
- 验证命令与结果：
  - `node scripts/check.mjs`：Structure check passed
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**418 passed / 0 failed**
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed
  - `cargo fmt --check` / `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）
- 提交：见 v19 的 fix / docs 提交
- 下一步：v19 计划已收尾

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| 07:5x | 阶段 1 | `cargo test` 在与 `pnpm test` 并发（高负载）时出现一次 `42 passed; 1 failed`，失败用例未打印 | 随后单独连跑 5 轮 `cargo test` 全部 43+3 通过，判定为负载下的时序抖动而非回归；未改动 Rust 代码。若再现需记录具体用例名 |
