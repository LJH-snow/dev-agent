# day-plan v14 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v14.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（审批策略拦住 `git` 的命令执行选项）未开始
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 00:0x-00:2x）
- 工作区：阶段 0 的改动待提交

## 日志

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
