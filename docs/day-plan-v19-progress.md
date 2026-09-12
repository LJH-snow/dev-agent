# day-plan v19 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v19.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（文档 + 全量回归）进行中
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 07:2x-07:5x）
- 工作区：阶段 0 的改动待提交

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

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
