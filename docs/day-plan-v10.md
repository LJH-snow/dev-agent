# dev-agent 开发计划 v10

> 目标：把 v9 打开的三条管线收口——索引从「只读回」变成「增量刷新并可回写」；
> token 用量从进程内累计变成会话级持久化；桌面端补齐 v7 只做了 API 的会话重命名 UI。

当前基线（v9 完成时已验证）：

- TypeScript 359 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：`--index` 增量刷新与 code-search 回写（~1.5 小时）

**问题**：v9 让 `code-search` 能读回 `<root>/.dev-agent/index.json`，但它只更新
进程内缓存；`--index` 自己每次也都是全量重扫，改动一个文件要重读整个项目。

**任务**：

1. `indexDirectory` 读取已有的 `<path>/.dev-agent/index.json`（版本与字段兼容时）：
   用 `signatures` 判断未变文件直接复用已存的 symbols / sources，不重读；
   变化或新增文件重扫；已删除文件从结果里移除。首次运行等价于全量。
2. 报告增加 `reused` 计数（文本与 `--json`），现有字段保持兼容。
3. `CodeSearchTool`：从磁盘索引启动、且增量比对改变了索引时，把刷新后的
   `{ version, files, symbols, signatures }` 写回原文件；只在文件原本存在时回写，
   写入失败静默忽略，搜索行为不受影响，也不会凭空创建索引文件。

**验收**：

- tools 新增 >= 3 个用例：回写后磁盘索引包含新符号、无变化时不重写、
  写失败不影响搜索结果
- CLI 新增 >= 1 个用例：二次 `--index --json` 的 `reused` 等于未变化文件数
- `pnpm test` 全绿

---

## 阶段 1：会话用量持久化（~2 小时）

**问题**：`AgentContext.usage` 只活在进程内，CLI 退出或桌面端刷新页面后累计
token 就丢了；v4 的用量统计只覆盖单次进程。

**任务**：

1. `AgentMemory` 增加可选 `recordUsage(usage)`；`InMemoryMemory` 在内存里累计，
   `FileMemory` 把累计写进会话文件的 `metadata.usage`。
2. `AgentLoop` 在 provider 报告 usage 时 `await memory.recordUsage(...)`，
   保证 `--once` 退出前已经落盘。
3. `SessionMetadata` 增加可选 `usage`；CLI `--metadata` 打印累计 token，
   `--session-list --json` 每个会话带上 usage。
4. 桌面端 `GET /api/sessions` 的每个 summary 带上 `usage`；切换或刷新会话后
   头部恢复累计 token 数。成本按当前价格表与会话累计用量重新估算，
   文档里写明这是估算值。

**验收**：

- agent-core 新增 >= 3 个用例：InMemory 累计、FileMemory 跨实例读回、
  loop 在一次 run 后把 usage 落盘
- CLI 新增 >= 1 个用例：`--metadata` 输出累计 token
- desktop 新增 >= 1 个用例：`/api/sessions` 返回 usage
- `pnpm test` 全绿

---

## 阶段 2：桌面端会话重命名 UI（~1 小时）

**问题**：v7 做了 `POST /api/sessions/<id>/rename` 和 CLI `--session-rename`，
但聊天界面里没有入口。

**任务**：

1. 会话选择器旁增加 Rename 按钮：`prompt()` 输入新 id，POST 到 rename 接口。
2. 成功后更新下拉选项与当前选中项、状态栏提示；空输入或取消不发请求；
   409 / 404 在状态栏显示错误。
3. 测试：服务端返回的 HTML 包含 Rename 控件与调用；现有 rename API 用例保持全绿。

**验收**：

- desktop 新增 >= 1 个 HTML 冒烟断言；rename API 的 3 个既有用例全绿
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

- 每轮开始读本文件与 `docs/day-plan-v10-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1 > 阶段 2 > 阶段 3
