# day-plan v29 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v29.md`；结束前追加日志。

## 当前状态

- 当前阶段：已完成（阶段 0 + 阶段 1）
- 已完成阶段：阶段 0、阶段 1
- 最近一次运行：运行 2（2026-09-12 19:4x-20:1x）
- 工作区：全部已提交并推送

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

### 运行 2 — 2026-09-12 19:4x-20:1x

- 阶段/工作项：阶段 1（文档 + 全量回归）完成
- 做了什么：
  - `packages/executor/README.md`：说明两个 executor 都会在启动前校验 cwd、
    两种错误文案、以及为什么需要它（Node 自身只报 `spawn <command> ENOENT`）
  - 根 README：Current Status 增加该行为；Roadmap 增加第 59 项
  - `docs/CHANGELOG.md`：新增 v29 条目（含三个工具修复前后的错误对照）
- 验证命令与结果：
  - `node scripts/check.mjs`：Structure check passed
  - `pnpm build` / `pnpm typecheck`：通过
  - `pnpm test`：**457 passed / 0 failed**
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed
  - `cargo fmt --check` / `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）
- 提交：见 v29 的 fix / docs 提交
- 下一步：v29 计划已收尾

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
