# dev-agent 开发计划 v9

> 目标：上一轮加的 `--index` 目前"只写不读"——`code-search` 仍然只用自己的进程内
> 缓存，`JsonFileCodeIndex` 也没有消费者。本计划先把这条管线接完，再做多 hunk patch、
> 审批键归一化与用量成本估算。

当前基线（v8 完成时已验证）：

- TypeScript 342 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：让 `code-search` 读回持久化索引（~1.5 小时）

**任务**：

1. `--index` 写出的索引增加 `signatures` 字段（`{ [path]: { mtimeMs, size } }`），
   格式仍是 `version: 1`，保持与 `JsonFileCodeIndex.load()` 兼容。
2. `CodeSearchTool` 在进程内缓存未命中时，先尝试加载
   `<root>/.dev-agent/index.json`：用其中的 symbols/sources/signatures 构造缓存，
   再走既有的增量比对（只重读签名变化的文件、移除消失的文件）。
3. `getCacheStats()` 增加 `loadedFromDisk` 计数，方便诊断与测试。
4. 索引损坏、版本不符、字段缺失时静默回退到全量扫描（不能因为坏索引让搜索失败）。

**验收**：

- tools 新增 >= 4 个用例：从磁盘索引加载（首次调用即 `loadedFromDisk: 1`）、
  加载后改动文件只重读该文件、索引中已删除的文件被移除、损坏索引回退全量扫描
- CLI 的 `--index --json` 输出包含签名信息（新增 1 个断言）
- `pnpm test` 全绿

---

## 阶段 1：多 hunk patch（~2 小时）

**任务**：

1. `filesystem` 增加 `patch` action：一次提交多个 `{ oldText, newText }`。
2. 原子语义：**任一 hunk 未命中或匹配不唯一，整批不写入**，错误里指出是第几个 hunk
   以及原因；全部通过才一次性写回。
3. hunk 之间允许相互影响（按顺序在内存中应用），但不得重叠。
4. 返回 `{ ok, path, hunks: N }`。

**验收**：

- tools 新增 >= 5 个用例：多 hunk 成功、第二个 hunk 失败时文件不变、重叠 hunk 报错、
  空 hunks 报错、单个 hunk 等价于 `edit`
- `pnpm test` 全绿

---

## 阶段 2：审批键归一化（~45 分钟）

**问题**：现在"总是允许"以完全相同的命令行为键，`npm test` 与 `npm test -- --watch`
会被当成两条。

**任务**：

1. 抽出 `normalizeApprovalKey(request)`：shell 取 `command + 子命令`（去掉 `-` 开头的
   参数与之后的 token），git 取 `git + 子命令`，其余回退为完整命令行。
2. CLI 与桌面端的"总是允许"记忆改用该键；文档写明归一化规则。

**验收**：

- agent-core 新增 >= 4 个用例：`npm test` 与 `npm test -- --watch` 同键、
  `git status` 与 `git status --short` 同键、不同命令不同键、非命令工具回退原样
- CLI/desktop 各 >= 1 个用例：允许一次后参数变化的同类命令不再询问
- `pnpm test` 全绿

---

## 阶段 3：用量成本估算（~1 小时）

**任务**：

1. `packages/model` 增加可配置价格表（模型前缀 → 每百万 token 的输入/输出单价），
   提供 `estimateCost(usage, model, prices)`。
2. CLI `[usage]` 行附带 `cost=$0.0123`（未配置价格时不显示）；桌面端 `usage` 事件
   与头部计数一并展示成本。
3. 价格表来源：`~/.dev-agent/config.json` 的 `pricing` 段；缺省为空（不猜测价格）。

**验收**：

- model 新增 >= 3 个用例：已知模型估算、未知模型返回 undefined、价格表前缀匹配
- CLI 新增 >= 1 个用例：配置价格后输出里出现 cost
- `pnpm test` 全绿

---

## 阶段 4：文档、全量回归与提交（~1 小时）

1. 更新根 `README.md`（Current Status / Roadmap）
2. 更新受影响的 README 与 `docs/architecture.md`
3. 更新 `docs/CHANGELOG.md`
4. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
5. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v9-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3 > 阶段 4
