# dev-agent 开发计划 v12

> 目标：修掉三处「看起来已经做完、实际还有缺口」的地方——`code-search` 与
> `--index` 的作用域不一致（前者只认 TS/JS、深度 6，会把 `--index` 写下的
> Python/Rust 符号从索引里悄悄裁掉）；Anthropic 缓存写入的 token 只按普通输入价
> 计；`--doctor` 不会报告损坏的 `~/.dev-agent/config.json`。

当前基线（v11 完成时已验证）：

- TypeScript 379 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：`code-search` 与 `--index` 的作用域对齐（~1.5 小时）

**证据**（2026-09-11 实测）：一个含 `.py` / `.rs` / `.ts` 的目录，`--index --json`
报告 `files: 3, symbols: 2`；随后 `CodeSearchTool` 冷启动得到
`loadedFromDisk: 1`，但 `python_only` / `rust_only` 查询 0 命中，
`rescanned: 2, persisted: 1` —— Python/Rust 条目先被当成「消失的文件」删掉，
再把裁掉后的索引写回磁盘。

**任务**：

1. `code-search` 的 `supportedExtensions` 增加 `.py`、`.rs`；`defaultMaxDepth`
   6 -> 8；`skippedDirectories` 增加 `.dev-agent`，与 `indexDirectory` 完全一致，
   使同一份索引在两个组件间可以无损往返。
2. references / definition 模式仍只把 TS/JS 源码交给 `TypeScriptReferenceIndex`，
   不把 Python/Rust 送进 TypeScript language service。
3. 更新工具描述与 `packages/tools/README.md`：搜索覆盖 TS/JS/Python/Rust，
   引用与定义仍限 TS/JS。

**验收**：

- tools 新增 >= 3 个用例：持久化索引里的 Python/Rust 符号能被搜索命中；
  没有索引时的全量扫描同样索引 `.py` / `.rs`；搜索之后磁盘索引仍保留
  Python/Rust 条目（不再被裁剪）
- 既有 62 个 tools 用例保持全绿
- `pnpm test` 全绿

---

## 阶段 1：Anthropic 缓存写入 token 单独计价（~1 小时）

**问题**：v11 把 `cache_creation_input_tokens` 计入 `promptTokens`，但按普通输入价
计费；Anthropic 对缓存写入实际收取高于输入价的费用，价格表无法表达。

**任务**：

1. `ChatUsage` 增加可选 `cacheCreationPromptTokens`（包含在 `promptTokens` 内）；
   Anthropic 从 `cache_creation_input_tokens` 解析；`addUsage` 同步累计。
2. `ModelPrice` 增加可选 `cacheCreationInputPerMillion`；`estimateCost` 依次对
   cache read、cache creation、其余输入分别计价，缺少对应价格时回退到输入价；
   两类缓存 token 都按 `promptTokens` 截断，避免负价。
3. 文档：model / cli README 说明新的可选字段。

**验收**：

- model 新增 >= 4 个用例：Anthropic 解析写入 token、`addUsage` 累计、
  配置创建价时按创建价计价、未配置时回退输入价
- 既有缓存读取用例保持全绿
- `pnpm test` 全绿

---

## 阶段 2：`--doctor` 校验共享配置（~1 小时）

**问题**：`~/.dev-agent/config.json` 损坏时所有读取方都静默忽略（CLI、desktop、
`--mcp-server` 都一样），用户以为配置生效，实际在跑默认值。

**任务**：

1. `runDoctor` 增加 `config` 检查：文件不存在 -> `ok`（明确说明使用默认值）；
   JSON 合法且是对象 -> `ok` 并列出识别到的 section（provider/model/pricing/
   approval/mcpServers 等有多少项）；JSON 非法或不是对象 -> `warn`，detail 带上
   解析错误。
2. 检查项可注入路径，便于测试隔离到临时目录。
3. 文档：`apps/cli/README.md` 的 `--doctor` 说明补一句。

**验收**：

- cli 新增 >= 3 个 doctor 用例：配置缺失、合法配置、非法 JSON
- 既有 doctor 用例保持全绿
- `pnpm test` 全绿

---

## 阶段 3：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新受影响的 README 与 `docs/architecture.md`
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v12-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3
