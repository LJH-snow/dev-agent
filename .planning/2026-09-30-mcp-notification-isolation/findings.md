# Findings

- `handleData` 的外层 catch 会把 `handleLine` 中未捕获的 notification handler 异常当作协议错误，调用 `failProtocol` 并关闭子进程。
- progress callback 已有独立 try/catch；普通 `onNotification` handler 当前没有同样的隔离。
- fake MCP server 的 `notify` tool 会先返回 tool result、再发送 `notifications/tools/list_changed`，适合验证 transport 是否仍可用。
