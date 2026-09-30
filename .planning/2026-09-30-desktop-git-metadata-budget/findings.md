# Findings

- `inspectRepository` 使用 `git status --porcelain=v1 --untracked-files=all`，`runCommand` 的 `maxBuffer` 是 16 KiB；超限时 `status.ok === false`，当前逻辑直接返回 `invalid/malformed-output`。
- Git branch、remote 和 capability sanitization 已有独立边界；本切片只改变 status 超限时的降级，不改变正常 status、remote parse 或 mutation 语义。
- 大量未跟踪文件不应让只读监控面板失去 repository identity；fallback 可以只保留 `dirty: true`，不暴露路径，也不伪造 `changedFiles`。
