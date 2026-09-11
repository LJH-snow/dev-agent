# day-plan v13 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v13.md`；结束前追加日志。

## 当前状态

- 当前阶段：无，`docs/day-plan-v13.md` 的四个阶段已全部完成
- 已完成阶段：阶段 0、阶段 1、阶段 2、阶段 3
- 最近一次运行：运行 4（2026-09-11 23:2x-23:4x）
- 工作区：阶段 3 的文档改动提交后即 clean

## 日志

### 运行 4 — 2026-09-11 23:2x-23:4x

- 阶段/工作项：阶段 3（文档、全量回归与提交）完成
- 做了什么：
  - 根 `README.md`：Current Status 增加危险命令表长短选项覆盖、Python
    `async def`、窄 maxDepth 写回合并三条，测试数更新为 394 TS + 46 Rust；
    Roadmap 追加 44-46
  - `docs/architecture.md`：approval 的模式覆盖、code-intelligence 的 Python
    async 支持、tools 的深度安全写回
  - `docs/CHANGELOG.md`：新增「Day plan v13」条目（389 -> 394），三条修复
    都带实测复现证据
- 验证命令与结果（完整矩阵）：
  - `node scripts/check.mjs`：Structure check passed（13 目录 / 34 文件）
  - `pnpm build`：通过
  - `pnpm typecheck`：通过
  - `pnpm test`：394 passed / 0 failed
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed / 0 failed
  - `cargo fmt --check`：通过
  - `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）/ 0 failed
- 提交：见阶段 3 的 docs 提交
- 下一步：v13 计划已收尾；继续用实测复现的方式找下一个真实缺口（优先看
  执行器/沙箱、MCP 往返、上下文预算与桌面端 SSE 边界）

### 运行 3 — 2026-09-11 23:0x-23:2x

- 阶段/工作项：阶段 2（`code-search` 不再裁剪扫描范围之外的索引条目）完成
- 做了什么：
  - 从磁盘索引加载后先按请求的 `maxDepth` 过滤缓存（`restrictToDepth`），
    深处的文件既不参与本次搜索，也不会被当成「已删除」
  - `persistScan` 增加 `maxDepth` 参数并在写回时与磁盘索引合并：扫描范围之外的
    条目原样保留，范围之内的条目以本次扫描为准
  - 新增 2 个测试：窄 `maxDepth` 搜索后深层文件仍在磁盘索引中且不触发回写；
    深层文件确实被删除时，覆盖该深度的扫描仍会把它移除
  - 实测复测：`maxDepth: 1` 搜索后 `persisted: 0`，索引仍含
    `shallow.ts` 与 `deep/nested/deep.ts`
- 验证命令与结果：
  - `pnpm --filter @dev-agent/tools build`：通过
  - `packages/tools`：66 passed（64 + 2）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 394 个测试，0 失败）
- 提交：见阶段 2 的 fix 提交
- 下一步：阶段 3 — 根 README / architecture / CHANGELOG 更新 + 完整回归矩阵

### 运行 2 — 2026-09-11 22:5x-23:0x

- 阶段/工作项：阶段 1（Python 扫描器支持 `async def`）完成
- 做了什么：
  - `scanPythonSymbols` 的声明正则改为 `^(?:async\s+)?def\s+…`：顶层
    `async def` 记为 `function`，类内 `async def` 记为 `method` 并带
    `containerName`；装饰器行本来就被跳过，所以 `@cached` + `async def` 也覆盖
  - 新增 2 个测试：async 顶层函数（并确认 `await write(...)` 不会被当成声明）、
    装饰器 + 类内 async 方法
- 验证命令与结果：
  - `pnpm --filter @dev-agent/code-intelligence build`：通过
  - `packages/code-intelligence`：30 passed（28 + 2）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 392 个测试，0 失败）
- 提交：见阶段 1 的 fix 提交
- 下一步：阶段 2 — 窄 `maxDepth` 的 `code-search` 不再把深层索引条目写回删除

### 运行 1 — 2026-09-11 22:3x-22:5x

- 阶段/工作项：阶段 0（补齐危险命令表的覆盖）完成
- 做了什么：
  - 「recursive delete」模式改为识别短选项（`-r`/`-rf`/`-fr`）与长选项
    `--recursive`；用 `-(?!-)` 避免把 `--force` 误当短选项，用
    「参数级空白边界」避免把 `file-r.txt` 这类文件名误判
  - 「force push」模式覆盖 `-f`、`--force`、`--force-with-lease`、
    `--force-if-includes` 与 `+refspec`；token 边界保证 `--follow-tags`、
    `feature-fix` 这类参数不误报
  - `approval.allow` 的优先级不变，长选项写法同样可被白名单豁免
- 验证命令与结果：
  - 实测复测：`rm --recursive --force` / `git push -f` / `git push origin +main`
    均 DENY；`rm --force file`、`rm file-r.txt`、`git push --follow-tags`、
    `git push origin main` 仍 ALLOW
  - `packages/agent-core`：58 passed（内置模式表断言扩充 + 新增 1 个长选项
    白名单用例）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 390 个测试，0 失败）
- 提交：见阶段 0 的 fix 提交
- 下一步：阶段 1 — Python 扫描器识别 `async def`

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | - |
