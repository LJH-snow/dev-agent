# day-plan v12 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v12.md`；结束前追加日志。

## 当前状态

- 当前阶段：阶段 1（Anthropic 缓存写入 token 单独计价）未开始
- 已完成阶段：阶段 0
- 最近一次运行：运行 1（2026-09-11 21:2x-21:5x）
- 工作区：阶段 0 的改动待提交

## 日志

### 运行 1 — 2026-09-11 21:2x-21:5x

- 阶段/工作项：阶段 0（`code-search` 与 `--index` 作用域对齐）完成；
  实现过程中发现并修复了 Rust 扫描器不认识 `pub` 项的缺陷（属于本阶段验收
  所需——否则 Python/Rust 索引根本不会包含真实 Rust 符号）
- 做了什么：
  - 先复现：`--index` 报告 `files: 3, symbols: 2`，随后 `code-search` 冷启动
    `loadedFromDisk: 1` 但 python/rust 查询 0 命中，`rescanned: 2`、
    `persisted: 1`——索引被裁成只剩 TS 并写回磁盘
  - `scanRustSymbols` 重写：支持 `pub` / `pub(crate)` / `pub(in path)` 可见性
    与 `async` / `unsafe` / `const` / `default` / `extern "C"` 修饰；支持
    `trait`（`interface`）、`impl` / `trait` 块内的 `fn`（`kind: "method"` +
    `containerName`）；`impl<T> Foo<T>` 与 `impl Trait for Foo` 取实现类型；
    单行 `impl Foo { … }` 不会把后续行误判为容器
  - `code-search`：`supportedExtensions` 增加 `.py` / `.rs`；`defaultMaxDepth`
    6 -> 8；`skippedDirectories` 增加 `.dev-agent`，与 `indexDirectory` 完全一致
  - references / definition 只把 TS/JS 源码交给 `TypeScriptReferenceIndex`，
    Python/Rust 源码不会进入 TypeScript language service
  - 端到端复测：`--index` 3 files / 3 symbols；三个语言各 1 命中；
    `rescanned: 0, persisted: 0`（索引不再被改写）
  - 文档：tools / code-intelligence / cli README 同步
- 验证命令与结果：
  - `pnpm build`：通过
  - `packages/code-intelligence`：28 passed（新增 3 个：public/修饰符声明、
    impl 方法容器、trait 与方法）
  - `packages/tools`：64 passed（新增 2 个：持久化索引中的 Python/Rust 可搜索
    且不被裁剪、无索引时同样索引 Python/Rust）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 384 个测试，0 失败）
- 提交：见阶段 0 的 feat 提交
- 下一步：阶段 1 — `ChatUsage.cacheCreationPromptTokens` 与
  `ModelPrice.cacheCreationInputPerMillion`

## 错误与卡点

| 时间 | 阶段 | 问题 | 处理 |
|------|------|------|------|
| -    | -    | 暂无 | - |
