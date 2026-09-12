# day-plan v29 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v29.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（文档 + 全量回归）进行中
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-12 19:1x-19:4x）
- 工作区：阶段 0 的改动待提交

## 日志

### 运行 1 — 2026-09-12 19:1x-19:4x

- 阶段/工作项：阶段 0（spawn 前校验工作目录）完成
- 做了什么：
  - `packages/executor/src/index.ts`：新增导出 `assertWorkingDirectory(cwd)`，
    区分"不存在"与"不是目录"两种失败，并在无法检查时给出原因；
    校验在**每次调用**时进行（不做缓存），目录被删除后下一次调用立刻报错
  - `LocalExecutor.execute()` 与 `RustExecutor.runSandboxed()` 都在 spawn/发请求
    之前调用它，两条执行路径给出同一套诊断
  - 新增 `packages/executor/tests/working-directory.test.ts`（4 个用例）
- 验证命令与结果：
  - 修复前后对照（工作目录指向不存在的路径，三个工具都会走到 executor）：
    - `shell`：`spawn echo ENOENT` -> **`working directory does not exist: …`**
    - `git`：`spawn git ENOENT` -> 同上
    - `search`：`spawn rg ENOENT` -> 同上
    - 说明：`echo`/`git`/`rg` 都装好了，Node 在 cwd 无效时给出的错误指向命令名
      （`error.path` 也是命令），调用方无法据其判断该修什么
  - cwd 指向文件：`working directory is not a directory: /etc/hosts`
  - 回归保护：cwd 合法但命令确实不存在 -> 仍报 `spawn definitely-not-a-command-xyz ENOENT`
  - `RustExecutor`：同样在触达 runtime 之前就报出目录问题（用例里 runtime 二进制
    根本不存在，仍以目录错误优先）
  - `packages/executor`：48 passed（44 + 新增 4）
  - `pnpm typecheck`：通过
  - `pnpm test`：**457 passed / 0 failed**
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — 文档、完整回归矩阵、提交推送

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
