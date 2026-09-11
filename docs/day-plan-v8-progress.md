# day-plan v8 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v8.md`；结束前追加日志。

## 当前状态

- 当前阶段：无（v8 全部完成）
- 已完成阶段：阶段 0、阶段 1、阶段 2、阶段 3、阶段 4
- 最近一次运行：运行 4（2026-09-11 17:45-18:05）
- 工作区：阶段 4 的改动已提交并推送

## 日志

### 运行 4 — 2026-09-11 17:45-18:05

- 阶段/工作项：阶段 4（文档、全量回归与提交）完成；v8 收口
- 做了什么：
  - 根 `README.md`：Current Status 增加编辑工具、`--index`、审批记忆三条，
    测试数量更新为 342 TypeScript + 46 Rust；Roadmap 增加 27-29 项
  - `docs/architecture.md`：说明 edit/read 语义、`--index` 的扫描与落盘规则、
    配置化审批与"总是允许"的作用范围
  - `docs/CHANGELOG.md`：新增 v8 条目
- 验证命令与结果（完整回归矩阵）：
  - `node scripts/check.mjs`：通过
  - `pnpm build`、`pnpm typecheck`：通过
  - `pnpm test`：342 passed / 0 failed
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed
  - `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：43（lib）+ 3（bin）passed
- 提交：见阶段 4 的 docs 提交
- 下一步：无（v8 阶段与收尾均完成）

## v8 总结（2026-09-11 18:05）

| 阶段 | 产出 |
|------|------|
| 0 | `filesystem edit`：唯一片段替换（未命中/歧义都报错且不改文件，空 newText 删除）；`read` 支持 offset/limit 与 truncated 标记 |
| 1 | 审批策略把 `edit` 与 `write` 同等对待（工作目录外拒绝） |
| 2 | `--index <path>`：扫描目录并把 `{ version, files, symbols }` 写到 `<root>/.dev-agent/index.json`，与 `JsonFileCodeIndex` 格式兼容 |
| 3 | 审批记忆：CLI `a` / 桌面端 "Always allow"，仅本会话内存生效 |
| 4 | 文档、全量回归、提交推送 |

测试数量：TypeScript 329 → 342（+13），Rust 46（未变），真实二进制集成 10。

### v8 已知边界

- `edit` 只做单次唯一替换，不支持一次多处的批量 patch；文件很大时仍受工具输出上限约束。
- `--index` 写出的索引还没有被 `code-search` 读回来用，跨进程复用仍待接线。
- 审批记忆以"完全相同的命令行"为键，参数稍变就会重新询问。

### 运行 3 — 2026-09-11 17:15-17:45

- 阶段/工作项：阶段 3（审批决定记忆）完成
- 做了什么：
  - CLI `ask` 模式新增 `a` 选项：回答 `a` 时放行并把这**一条命令**记入进程内的
    会话白名单，之后同一命令不再询问（不写磁盘）
  - 桌面端审批提示条新增 `Always allow` 按钮，`POST /api/approval` 接受
    `decision: "allow-always"`；服务端按会话保存已允许的命令，之后的相同命令直接放行
  - `ApprovalPrompt` 增加 `command` 字段（用 agent-core 的 `commandText` 生成），
    用来做"同一条命令"的判定键
  - 文档：CLI/桌面端 README 说明 `a` / Always allow 的语义与作用范围
- 验证命令与结果：
  - `apps/cli`：新增用例通过（stub 连续两次发出同一条 `chmod 777`，回答 `a` 后
    只弹一次提示、两次都执行）
  - `apps/desktop`：新增用例通过（`allow-always` 后第二次相同命令不再发
    `approval-request`，直接执行）
  - `pnpm test`：全绿
- 提交：见阶段 3 的 feat 提交
- 下一步：阶段 4 — 文档、全量回归与提交

### 运行 2 — 2026-09-11 16:45-17:15

- 阶段/工作项：阶段 2（`--index` 命令）完成
- 做了什么：
  - 新增 `apps/cli/src/index-command.ts`：按与 `code-search` 相同的忽略规则遍历目录，
    用 `scanFile` 扫描 TS/JS/Python/Rust，把 `{ version, files, symbols }` 写到
    `<root>/.dev-agent/index.json`（格式与 `JsonFileCodeIndex.load()` 兼容）
  - CLI 新增 `--index <path>`：人类可读摘要（文件数、符号数、语言分布、索引路径）
    或 `--json` 输出；路径不存在时退出码 1
  - `apps/cli` 依赖新增 `@dev-agent/code-intelligence`；`.gitignore` 忽略 `.dev-agent/`
    （索引产物不应进仓库）
  - 文档：`apps/cli/README.md` 增加 `--index`
- 验证命令与结果：
  - 本机实跑：`node apps/cli/dist/index.js --index packages/code-intelligence --json`
    → 12 files / 204 symbols（typescript 6、javascript 6）
  - `apps/cli`：新增 3 个用例通过（写入索引且跳过 node_modules、人类可读摘要、
    路径不存在报错退出 1）
  - `pnpm test`：全绿
- 提交：见阶段 2 的 feat 提交
- 下一步：阶段 3 — 审批决定记忆（本会话内"总是允许"）

### 运行 1 — 2026-09-11 16:05-16:45

- 阶段/工作项：阶段 0（编辑工具与按行读取）与阶段 1（审批覆盖 edit）完成
- 做了什么：
  - `FilesystemTool` 新增 `edit` action：`oldText` 必须非空且**唯一匹配**才替换；
    0 处报"not found"、多处报"matches N locations"并把文件原样保留；
    `newText` 允许空字符串（删除片段）
  - `read` 支持 `offset`（1 起）/`limit`（默认 2000 行），返回
    `{ content, startLine, endLine, totalLines, truncated }`；offset 超过文件末尾返回空内容
  - 工具 schema/描述同步；`denyDangerousPolicy` 的"工作目录外写入"检查把 `edit`
    与 `write`/`mkdir` 同等对待
  - 文档：`packages/tools/README.md` 说明编辑语义与读取分页
- 验证命令与结果：
  - `packages/tools`：48 passed（新增 7 个：唯一替换、未命中、歧义拒绝且文件不变、
    空 newText 删除、参数校验、行范围读取 + truncated、offset 越界）
  - `packages/agent-core`：50 passed（新增"工作目录外的 edit 被拒、目录内放行"）
  - `pnpm test`：全绿
- 提交：见阶段 0/1 的 feat 提交
- 下一步：阶段 2 — `--index` 命令（把 `JsonFileCodeIndex` 落到 `.dev-agent/index.json`）

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
