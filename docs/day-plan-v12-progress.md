# day-plan v12 进度账本

> 每轮开始前读本文件与 `docs/day-plan-v12.md`；结束前追加日志。

## 当前状态

- 当前阶段：无，`docs/day-plan-v12.md` 的四个阶段已全部完成
- 已完成阶段：阶段 0、阶段 1、阶段 2、阶段 3
- 最近一次运行：运行 4（2026-09-11 22:1x-22:3x）
- 工作区：阶段 3 的文档改动提交后即 clean

## 日志

### 运行 4 — 2026-09-11 22:1x-22:3x

- 阶段/工作项：阶段 3（文档、全量回归与提交）完成
- 做了什么：
  - 根 `README.md`：Current Status 更新多语言 code-search 作用域、Rust 扫描器
    覆盖、缓存写入计价、`--doctor` 配置校验，测试数更新为 389 TS + 46 Rust；
    Roadmap 追加 40-43
  - `docs/architecture.md`：code-intelligence 的 Rust 扫描能力、tools 的
    四语言作用域与引用/定义边界、model 的缓存写入价、CLI 的配置校验
  - `docs/CHANGELOG.md`：新增「Day plan v12」条目（379 -> 389），含复现证据
- 验证命令与结果（完整矩阵）：
  - `node scripts/check.mjs`：Structure check passed（13 目录 / 34 文件）
  - `pnpm build`：通过
  - `pnpm typecheck`：通过
  - `pnpm test`：389 passed / 0 failed
  - `pnpm --filter @dev-agent/executor test:integration`：10 passed / 0 failed
  - `cargo fmt --check`：通过
  - `cargo clippy --all-targets -- -D warnings`：通过
  - `cargo test`：46 passed（43 lib + 3 bin）/ 0 failed
- 提交：见阶段 3 的 docs 提交
- 下一步：v12 计划已收尾；下一轮用「实测复现优先」的方式继续找下一个真实缺口
  （优先探查扫描器、索引、审批与沙箱边界的端到端一致性）

### 运行 3 — 2026-09-11 22:0x-22:1x

- 阶段/工作项：阶段 2（`--doctor` 校验共享配置）完成
- 做了什么：
  - `runDoctor` 新增 `config` 检查（可通过 `configPath` 注入，默认
    `~/.dev-agent/config.json`）：文件缺失 -> ok「defaults are used」；
    JSON 合法且为对象 -> ok 并列出识别到的 section（defaultProvider /
    defaultModel / maxTurns / maxContextChars / summarizeContext /
    summaryMaxChars / approvalMode / approval / mcpServers / pricing）；
    JSON 非法、非对象或读取失败 -> warn，detail 带原因
  - 检查顺序放在 provider 与 sessions 之间；`--doctor --json` 与文本报告自动
    带上该项
  - 文档：`apps/cli/README.md` 的 `--doctor` 说明补充配置校验语义
- 验证命令与结果：
  - `pnpm --filter @dev-agent/cli build`：通过
  - `apps/cli`（`tests/doctor.test.mjs`）：7 passed（新增 3 个：缺失配置、
    合法配置列出 section、非法 JSON 报警告；既有用例按新检查项更新）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 389 个测试，0 失败）
- 提交：见阶段 2 的 feat 提交
- 下一步：阶段 3 — 根 README / architecture / CHANGELOG 更新 + 完整回归矩阵

### 运行 2 — 2026-09-11 21:5x-22:0x

- 阶段/工作项：阶段 1（Anthropic 缓存写入 token 单独计价）完成
- 做了什么：
  - `ChatUsage` 增加可选 `cacheCreationPromptTokens`（包含在 `promptTokens` 内）；
    Anthropic 的 `cache_creation_input_tokens` 解析到该字段，流式仍只在带
    `input_tokens` 的事件上取值，避免 output-only delta 重复计数
  - `addUsage` 同步累计缓存写入 token，会话总量与重新计价的成本保持一致
  - `ModelPrice` 增加可选 `cacheCreationInputPerMillion`；`estimateCost` 现在
    把 prompt 拆成「普通输入 / 缓存读取 / 缓存写入」三段分别计价，缺少对应
    价格时回退输入价；两类缓存 token 相加后按 `promptTokens` 截断，不会出现负价
  - 文档：model / cli README 同步新字段与回退语义
- 验证命令与结果：
  - `pnpm build`：通过
  - `packages/model`：54 passed（新增 2 个：缓存写入按创建价、缺省回退输入价；
    既有 Anthropic 解析用例断言补充 cacheCreationPromptTokens）
  - `packages/agent-core`：57 passed（addUsage 断言覆盖缓存写入累计）
  - `pnpm typecheck`：通过
  - `pnpm test`：全绿（TypeScript 386 个测试，0 失败）
- 提交：见阶段 1 的 feat 提交
- 下一步：阶段 2 — `--doctor` 校验 `~/.dev-agent/config.json`（缺失/合法/非法）

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
