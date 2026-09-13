# dev-agent 开发计划 v31

目标：MCP 工具失败时，**服务端给出的具体原因被丢弃**，只剩一句通用错误。

`McpStdioClient.callTool()` 里：

```ts
if (toolResult.isError) {
  throw new McpRequestError(-32603, `MCP tool "${name}" reported an error`);
}
```

`isError: true` 的返回里通常带着服务端写好的 `content[].text`（"permission denied:
…"、"file not found: …"），但这段信息被直接扔掉。实测：桩服务返回
`permission denied: cannot read /etc/shadow (EACCES)`，客户端抛出的是
`MCP tool "fail" reported an error`。

后果：MCP 工具的错误会作为工具结果写回模型（`runTool` 捕获后返回给模型），
但模型只看到"某工具失败了"，无法据此换路径、改参数或换工具——这与内置工具的
错误质量（带路径、带原因）完全不一致。

当前基线（v30 完成时已验证）：

- TypeScript 461 个测试 + Rust 46 个测试全部通过；真实二进制集成 10 个
- `pnpm check/build/typecheck/test`、`cargo fmt/clippy/test` 全绿

---

## 阶段 0：把服务端的失败原因带回给调用方（~1 小时）

任务：

1. `callTool()` 抛错时带上服务端内容：
   - 汇总 `result.content` 里所有 `type: "text"` 的文本，按顺序以换行拼接；
   - 消息形如 `MCP tool "<name>" failed: <服务端文本>`；
   - 服务端没给文本时回退到今天的 `MCP tool "<name>" reported an error`；
   - 单条文本过长时截断（例如 2000 字符），避免把整包输出塞进错误里。
2. `code` 保持 `-32603`（服务端执行失败），不改变既有错误分类。
3. 成功路径与 `options`/`structuredContent` 的处理完全不变。

验收：

- mcp 新增 >= 4 个用例：
  - 服务端给文本：错误里包含该文本（`permission denied: …`）
  - 服务端给多段文本：按顺序拼接
  - 服务端没给文本：回退成通用文案
  - 超长文本被截断（不会把错误撑爆）
- 既有 `callTool surfaces server error code via McpRequestError` 等用例保持通过
- `pnpm test` 全绿

---

## 阶段 1：文档、全量回归与提交（~45 分钟）

1. 更新 `packages/mcp/README.md`（工具失败的错误形态）
2. 更新根 `README.md` 的 Current Status / Roadmap 与 `docs/CHANGELOG.md`
3. 完整回归：`node scripts/check.mjs`、`pnpm build`、`pnpm typecheck`、`pnpm test`、
   `pnpm --filter @dev-agent/executor test:integration`、`cargo fmt --check`、
   `cargo clippy --all-targets -- -D warnings`、`cargo test`
4. 提交并推送

---

## 执行协议

- 每轮开始读本文件与 `docs/day-plan-v31-progress.md`，`git status` 确认工作区；
- 取下一个未完成阶段，端到端做完，更新账本，提交推送；
- 未开启新参数时行为不变；不引入新的运行时依赖；
- 单轮约 45 分钟，接近就先落盘进度；用户不在场不要提问。

## 优先级

阶段 0 > 阶段 1
