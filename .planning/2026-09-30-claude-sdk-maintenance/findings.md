# Findings

- `runClaudeAgentSdk` 当前在 `queryFactory` 之前没有检查 host signal；已取消请求仍会创建 SDK query。
- abort listener 在 `queryFactory` 返回后才注册。如果 factory 同步触发 abort，已创建 query 不会收到 listener，也不会被关闭。
- `Query.close()` 是 SDK 提供的同步、幂等式生命周期入口；本切片只需要确保两种竞态都进入现有 finally/close 语义，不改变审批或工具执行边界。
- 取消清理统一走一次性 `closeQuery`，避免 factory 竞态触发一次 close 后 finally 再重复 close；不会改变正常完成路径。
