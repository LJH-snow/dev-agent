# MCP 通知处理隔离

## 目标

MCP 客户端的单个 `onNotification` consumer 抛错时，不应杀掉共享的 stdio JSON-RPC transport；通知回调失败应被隔离，后续请求仍可正常完成。

## 范围

- 只修改 `packages/mcp/src/stdio-client.ts` 与对应 MCP client test。
- 不触碰其他窗口正在修改的 Desktop capability 文件、CLI 文件或临时产物。
- 不改变 MCP 协议、审批、工具结果和 notification payload。

## 阶段

- [complete] 先补 notification handler 抛错的 RED 测试。
- [complete] 实现逐 handler 隔离的最小修复。
- [complete] 运行 MCP focused/full tests、typecheck/build 与 diff check。
- [complete] 精确提交本切片并推送，确认其他窗口改动未被暂存。
