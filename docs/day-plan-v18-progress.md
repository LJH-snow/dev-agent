# day-plan v18 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v18.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（文档 + 全量回归）进行中
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 06:1x-06:4x）
- 工作区：阶段 0 的改动待提交

## 日志

### 运行 1 — 2026-09-12 06:1x-06:4x

- 阶段/工作项：阶段 0（严格参数校验）完成
- 做了什么：
  - `apps/cli/src/index.ts` 新增 `CLI_FLAGS` 规格表（每个 flag 的取值个数：
    无 / 一个 / 两个 / 可选一个）与 `validateCliArgs()`，在 `main()` 最前面执行
  - 三类错误改为退出码 1 + stderr：未知 flag、取值缺失或"取值本身就是 flag"、
    多余的位置参数；取值以 `-` 开头一律视为缺失（目录名可用 `./-dir`）
  - 新增 `apps/cli/tests/cli-args.test.ts`（6 个用例）
- 验证命令与结果：
  - 手工复现（修复前 / 修复后）：
    - `--nope`：从"退出 0 且进交互模式"变为 `Unknown option '--nope'.`（exit 1）
    - `--session --once hi`：修复前在磁盘生成 `once.json`，现在
      `--session requires a value.`（exit 1），会话目录保持为空
    - `--once --json`：修复前把字面量 `--json` 当提示词发给模型，现在 exit 1
    - `hello`：修复前静默进交互模式，现在 `Unexpected argument 'hello'.`
  - 合法输入不变：`--version`、`-v`、`--tools`、`--session demo --tools` 均正常；
    `--compact`（可选值）不再被误判为未知或缺失
  - `packages`/`apps` 全量：**413 passed / 0 failed**（v17 的 407 + 新增 6）
  - `pnpm typecheck`：通过
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 文档、完整回归矩阵、提交推送

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
