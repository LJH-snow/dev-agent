# dev-agent 开发计划 v22

目标：MCP 的 `resources/read` 允许服务端返回**多段** contents（例如一次目录读取
返回多个文件、或文本 + blob 混合）。客户端把除第一段之外的全部内容静默丢弃：

```ts
const contents = result?.contents ?? [];
const first = contents[0];
return first ?? { uri };   // 其余 contents 直接消失，没有任何提示
```

实测（桩服务返回 3 段 FIRST/SECOND/THIRD）：`readResource()` 只拿到
`FIRST-PART`，另外两段既没返回也没报错；CLI 的 `MCP resource` 工具直接用它，
所以模型永远看不到后面的内容。这是静默数据丢失，和 v12 的 code-search
只索引 TypeScript 是同一类问题。

当前基线（v21 完成时已验证）：

- TypeScript 425 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：暴露全部资源内容（~1 小时）

任务：

1. `McpClient` 接口与 `McpStdioClient` 增加
   `readResourceContents(uri): Promise<readonly McpResourceContents[]>`，
   返回服务端给的全部 contents（保持顺序）。
2. `readResource(uri)` 保留为单段便捷方法：返回第一段（与今天一致），
   但当服务端返回多于一段时，其文档与实现都不得再暗示"这是全部内容"。
3. CLI 的 `MCP resource` 工具改用 `readResourceContents()`，把全部内容交给
   模型；`createMcpResource().read()` 保持单段兼容。
4. 空 contents 仍回退成 `{ uri }`，不报错。

验收：

- mcp 新增 >= 3 个用例：单段、三段（全部返回且顺序不变）、空 contents 回退
- cli 新增 >= 1 个用例：resource 工具的输出包含第二、三段内容
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/mcp/README.md` 与 `apps/cli/README.md`
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v22-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
