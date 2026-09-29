# Findings

- AgentLoop 已在成功 apply 后自动调用 `ValidationAdapter`，并将 `ValidationResult` 写入 session memory；`:validate <changeSetId>` 使用 `runExplicitValidation` 重新通过 FilesystemTool 的受保护 change-set guard 执行。
- 自动修复需要在 Agent 运行后优先使用该轮新产生的 validation；若没有新 validation，再对原 change set 调用 trusted rerun。若修复改动了原始 change set 的 postimage，原 guard 会安全地返回 blocked，不能强行覆盖用户改动。
- CLI 有 readline 非 TTY 和 Ink TTY 两条交互路径，需共享解析/摘要/上限逻辑，但各自使用已有 `runPrompt`/`runInkPrompt` 和取消状态。

## 2026-09-29 baseline

- The existing isolated plan predates the current Ink 7 command-palette/editor work; implementation must be checked against the current source rather than its historical test counts.
- The current repository exposes a single shared AgentLoop and existing validation/change-set boundaries. The autofix feature should remain an orchestration layer at the CLI edge and must not add a second tool executor or bypass approval/sandbox rules.

## Source discovery

- The selected feature is already present in the current source tree: `apps/cli/src/auto-fix-command.ts` contains bounded parsing, redacted evidence summarization, prompt construction, target selection, and a maximum-attempt loop.
- `apps/cli/src/index.ts` already wires the loop through both line-oriented and Ink command paths, reuses `runExplicitValidation`, records validation evidence, and maps Ctrl-C/abort state to cancellation.
- The remaining work is therefore evidence-led: verify the existing implementation against the current source/tests, close any concrete regression or documentation gap, and update the stale isolated plan only after tests prove the status.
- The current progress callback interpolates `ValidationResult.summary` directly, while prompt construction uses the redacted summary helper. This is a concrete boundary to verify: auto-fix status notices must not expose raw validation paths, secrets, or terminal control bytes.
- The exported loop accepts `maxAttempts` directly even though the CLI parser limits the command to 1–3. The core helper should enforce the same upper bound so tests/other callers cannot bypass the safety budget.

## Final verification

- Focused auto-fix tests pass 11/11; the complete CLI suite passes 767/767.
- runAutoFixLoop now rejects attempt budgets outside 1–3 even when called directly.
- Progress notices use the bounded/redacted validation summary, so raw validation paths, credentials, and terminal controls do not enter user-visible repair status.
- Cancellation exits before repair, exhaustion reports a terminal status after the requested retries, and a blocked trusted rerun does not trigger another repair attempt.
