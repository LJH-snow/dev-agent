# day-plan v9 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v9.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 4（文档、全量回归与提交）进行中
- 已完成阶段：阶段 0、阶段 1、阶段 2、阶段 3
- 最近一次运行：运行 4（2026-09-11 20:0x-20:1x）
- 工作区：阶段 3 的改动待提交

## 日志

### 运行 4 — 2026-09-11 20:0x-20:1x

- 阶段/工作项：阶段 3（用量成本估算）完成
- 做了什么：
  - `packages/model/src/pricing.ts`：新增 `ModelPrice` / `PriceTable` /
    `estimateCost(usage, model, prices)`；按「最长模型名前缀」匹配，
    未知模型或价格非法时返回 `undefined`（不猜价格、不显示）
  - CLI：`CliConfig` 增加 `pricing` 段；`[usage]` 行在配置了价格时追加
    `cost=$0.00000795`，`--json` 结果增加同级 `cost` 字段（未配置时为 `null`）
  - 桌面端：`ChatSession` 从同一个 `~/.dev-agent/config.json` 读取 `pricing`，
    在 `usage` 事件里附带 `cost`；前端按会话累计并显示 `N tokens · $0.0000018`
  - 未配置价格时 CLI 与桌面端的输出都和以前完全一致
- 验证命令与结果：
  - `pnpm build`：通过
  - `pnpm typecheck`：通过
  - `packages/model`：46 passed（新增 4 个：已知模型、未知模型、
    最长前缀匹配、非法价格条目被忽略）
  - `apps/cli`（`tests/usage-output.test.mjs`）：2 passed（新增 1 个 cost 断言）
  - `apps/desktop`（`tests/chat-session-e2e.test.mjs`）：6 passed
    （usage 用例增加 `"cost":0.0000018` 断言）
  - `pnpm test`：全绿（TypeScript 359 个测试，0 失败）
- 提交：见阶段 3 的 feat 提交
- 下一步：阶段 4 — 文档更新 + 完整回归矩阵（check/build/typecheck/test/
  executor 集成/Rust fmt+clippy+test）后提交推送

### 运行 3 — 2026-09-11 20:0x-20:1x

- 阶段/工作项：阶段 2（审批键归一化）完成
- 做了什么：
  - `packages/agent-core/src/approval.ts` 新增 `normalizeApprovalKey(request)`：
    取命令名 + 第一个非 `-` 开头的 token 作为「总是允许」的键；
    `sh -c "…"` 会先解包脚本本身，普通工具仍走 `commandText`
  - `apps/cli/src/index.ts`：会话 allowlist 从 `commandText` 改为 `normalizeApprovalKey`，
    所以 `npm test` 与 `npm test -- --watch`、`git status` 与 `git status --short`
    只询问一次
  - `apps/desktop`：`ApprovalPrompt.command` 更名为 `key`，
    `chat-session.ts` 与 `server.ts` 的会话记忆同步切换
  - 测试：agent-core 新增 2 个 `normalizeApprovalKey` 用例；
    CLI / desktop 的 always-allow 用例第二次调用改成带额外 flag 的命令，
    断言不会再次弹窗
- 验证命令与结果：
  - `pnpm build`：通过（保留完整输出核对）
  - `pnpm typecheck`：通过
  - `packages/agent-core`：53 passed
  - `apps/cli`（`tests/approval.test.mjs`）：6 passed
  - `apps/desktop`（`tests/approval-interactive.test.mjs`）：4 passed
  - `pnpm test`：全绿（TypeScript 354 个测试，0 失败）
- 提交：见阶段 2 的 feat 提交
- 下一步：阶段 3 — 用量成本估算（价格表 + CLI `[usage]` 成本 + 桌面端显示）

### 运行 2 — 2026-09-11 20:0x-20:3x

- 阶段/工作项：阶段 1（多 hunk patch）完成
- 做了什么：
  - `FilesystemTool` 新增 `patch` action：接受 `hunks: [{ oldText, newText }]`，
    在内存副本上按顺序应用，每个 hunk 必须唯一命中且彼此不重叠，
    最后只写一次文件——任何 hunk 失败或歧义，文件保持原样
  - 错误信息带 hunk 序号与原因（未找到 / 匹配多处 / 与前一个 hunk 重叠）
  - 审批策略把 `patch` 与 `write`/`edit`/`mkdir` 同等对待（工作目录外拒绝）
  - 文档：`packages/tools/README.md` 说明 patch 语义
- 验证命令与结果：
  - `packages/tools`：57 passed（新增 5 个：多 hunk 成功、后续 hunk 失败文件不变、
    重叠拒绝、空/非法 hunks 校验、单 hunk 等价于 edit）
  - `packages/agent-core`：51 passed（新增"工作目录外的 patch 被拒、目录内放行"）
  - `pnpm test`：全绿（TypeScript 352 个测试）
- 提交：见阶段 1 的 feat 提交
- 下一步：阶段 2 — 审批键归一化（`npm test` 与 `npm test -- --watch` 视为同一条）

### 运行 1 — 2026-09-11 19:3x-20:0x

- 阶段/工作项：阶段 0（code-search 读回持久化索引）完成
- 做了什么：
  - `--index` 写出的索引增加 `signatures`（每个文件的 mtimeMs + size），
    格式仍是 `version: 1`，`JsonFileCodeIndex.load()` 依旧可读
  - `CodeSearchTool` 在进程内缓存未命中时先尝试加载 `<root>/.dev-agent/index.json`：
    用其中的 symbols/sources/signatures 构造缓存，再走既有增量比对；
    清理时以 "signatures ∪ sources" 为已知集合，持久化索引里已消失的文件也会被移除
  - 索引损坏/版本不符/字段缺失时静默回退全量扫描（搜索结果不受影响）
  - `getCacheStats()` 增加 `loadedFromDisk` 计数
  - 文档：tools / cli README 同步
- 验证命令与结果：
  - `packages/tools`：52 passed（新增 4 个：首次即从磁盘索引加载、签名变化只重读该文件、
    已删除文件被移除、损坏索引回退全量扫描）
  - `apps/cli`：`--index --json` 增加签名断言后 3 个用例仍通过
  - `pnpm test`：全绿
- 提交：见阶段 0 的 feat 提交
- 下一步：阶段 1 — 多 hunk patch（`filesystem patch`，整批原子生效）

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | -    |
