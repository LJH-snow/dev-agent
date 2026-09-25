# Findings

- AgentLoop 已在成功 apply 后自动调用 `ValidationAdapter`，并将 `ValidationResult` 写入 session memory；`:validate <changeSetId>` 使用 `runExplicitValidation` 重新通过 FilesystemTool 的受保护 change-set guard 执行。
- 自动修复需要在 Agent 运行后优先使用该轮新产生的 validation；若没有新 validation，再对原 change set 调用 trusted rerun。若修复改动了原始 change set 的 postimage，原 guard 会安全地返回 blocked，不能强行覆盖用户改动。
- CLI 有 readline 非 TTY 和 Ink TTY 两条交互路径，需共享解析/摘要/上限逻辑，但各自使用已有 `runPrompt`/`runInkPrompt` 和取消状态。
