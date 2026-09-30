# Findings

- 现有 runAutoFixLoop 已负责选择最近一次 failed/blocked validation、调用 repair、trusted rerun 和最多三轮预算；本次应在 repair 产出后增加显式 review handoff，而不是复制 AgentLoop 或验证执行器。
- 用户要求保护另一窗口的未提交改动；所有实现与验证必须限制在本计划新增/明确列出的文件内。
# Findings

## Autofix review handoff

- AgentLoop.run(..., { mode: "plan" }) 只生成 preview/change-set，不直接写入工作区；onPlanReview 通过 ui.consumePlanReview() 取出 bounded PlanReview。
- 精确应用必须调用 loop.applyPlannedChangeSet(context, { prompt, review, signal })，这样会保留 change-set 的 preimage guard 并复用 trusted validation。
- Ink 已有 ink.store.setPlan({ prompt, review, status }) 与现成 PlanReviewPanel；本任务只在 apps/cli/src/index.ts 调用它，不修改 apps/cli/src/ink/*。
- readline 路径已经完成 plan/review/确认/apply 结构；Ink 路径仍在 runAutoFixCommand 中直接执行普通 runInkPrompt，需要改成同样的两阶段流程。
- QuestionBox.ask 已支持 AbortSignal，所以 Autofix review 等待可以响应 Ctrl-C。
- readline 与 Ink 在确认前都只运行 plan mode；拒绝时返回 rejected 并跳过 validation，确认后才调用精确 change-set apply。
- Ink 入口也保护已有普通 pendingPlan，避免 Autofix 清掉另一条等待中的 plan。
- 通过 git diff --check 的 scoped 检查；任务代码只改动 apps/cli/src/index.ts、apps/cli/src/auto-fix-command.ts 及两个 Autofix 测试文件。

## Follow-up discoveries

- PendingPlan 目前只服务普通 :plan；Autofix 需要单独的 pending state，因为 apply 必须绑定生成 review 的 AgentContext。
- 两条 interactive loop 都各自持有 current、pendingPlan、命令分发和 schedule helper；共享的命令解析可以放在 auto-fix-command.ts，应用逻辑仍需分别适配 readline/Ink UI。
- AgentLoop.applyPlannedChangeSet 本身负责精确 apply 与既有 validation callback；恢复应用不应再次调用模型。

## Next phase hypothesis

- 当前 pendingAutoFixReview 只存在于 interactive loop 闭包，session resume 或 CLI 重启会丢失；下一阶段需要把它降级为可校验的 session metadata，而不是序列化 AgentContext。
- 可恢复 apply 应优先从 resumed AgentContext 的 memory/change-set evidence 恢复原 session/workspace 绑定，再调用原 review 的 apply 路径；不应把 review 当作新的模型任务。

## Persistence mapping

- FileMemory already owns file-backed session envelopes and exposes getMetadata(); session registry recreates FileMemory from a stored session id and file path.
- Existing plan-command.ts validates session id and resolved working directory before applying a plan, and its digest/review matching pattern is a reusable security boundary.
- Interactive session switching currently replaces current and clears in-memory pendingPlan; the new Autofix metadata needs an equivalent restore/clear hook without serializing the live AgentContext.
- Existing change-set evidence APIs (memory.changeSets(), validation records, and filesystem restore helpers) are the likely source of truth for whether a persisted review is still applicable.

## API constraints discovered

- AgentMemory exposes optional structured methods for validations, applied change-set records, checkpoints, pruning, and metadata; there is no generic arbitrary metadata setter in the public interface.
- Change-set evidence records already carry changeSetId, sessionId, workingDirectory, bounded file evidence, hashes, counts, timestamps, and applied/rolled-back state.
- The existing plan document path enforces relative workspace paths, hashes the workspace identity, binds sessionId/workspaceId, and compares the review before apply; the next phase should follow these constraints rather than invent a looser envelope.

## Memory schema details

- FileMemory's persisted envelope currently contains version, session metadata, entries, summary, validations, changeSets, and checkpoints; no pending review field exists.
- FileMemoryOptions currently accepts only filePath, sessionId, and evidence retention, so persistence can be added either as a narrowly scoped AgentMemory capability or as a CLI-owned sidecar store keyed by the existing session file.
- The existing plan-command binding map is process-local; it cannot by itself restore a review after CLI restart, so durable Autofix recovery must keep enough bounded review data in the session-owned store and revalidate it on load.

## Test seams

- packages/agent-core/tests/memory.test.ts already covers FileMemory reopen, metadata, validation, change-set evidence, retention, and invalid envelopes; the persistence schema test belongs there.
- apps/cli/tests/session-registry.test.ts and session-resume.test.ts cover discovery and resume behavior; CLI integration can exercise the real restart/resume path without touching Ink implementation files.
- Existing tests use temporary files and real FileMemory instances, so the new persistence contract can be tested without mocking the storage layer.

## Session path implications

- CLI memoryFilePath honors DEV_AGENT_MEMORY_FILE before the normal session directory; a CLI sidecar path derived only from sessionDirectory would break the existing test and deployment override.
- FileMemory is therefore the safer persistence owner: the same reopened memory instance already follows the configured path, session id, envelope validation, and atomic write chain.
- Session resume creates the next context through the same memory factory, so a pending review capability on AgentMemory can be restored without duplicating path resolution in readline or Ink.
- CLI integration can isolate session files with DEV_AGENT_SESSION_DIR; interactive commands use :sessions/:resume and the session registry, while --session selects the active memory id at startup.

## Planned change-set boundary

- FilesystemTool stores prepared mutations in a private in-process map; apply only accepts the changeSetId and therefore requires that runtime map entry.
- Applied change-set evidence is intentionally non-executable and omits before-image/mutation payloads; restoring it cannot recreate a pending plan for safe apply.
- Safe contract: persist enough review metadata for same-process session resume and review/discard after restart, but return a bounded unavailable error when restart loses the runtime planned change-set. Never reconstruct executable mutation input from diffs or model transcript.

## Memory implementation details

- FileMemory.clear removes the whole session file; InMemoryMemory.clear resets all structured records, so pending review state must clear in both implementations.
- FileMemory.persist preserves optional envelope fields when the corresponding argument is omitted; a nullable final pending-review argument can add/clear the record without changing existing call sites.
- The memory package already validates legacy envelopes by allowing unknown optional fields, but a new pending review field should have an explicit bounded validator to fail closed on malformed or unsafe paths.

## Implementation seam

- FileMemory's record methods all route through one serialized enqueue/persist path; adding pending review read/write/clear methods there preserves atomicity and does not require changing existing evidence call sites.
- InMemoryMemory is used by unit tests and lightweight contexts, so it must implement the same optional capability and clear it with the rest of session state.

## Debugging note: review path normalization

- Reproduction: the two in-workspace absolute-path tests fail in createPendingAutoFixReviewRecord; the outside-workspace rejection test passes.
- Root cause: toWorkspaceRelativePath computes the correct relative path, then unconditionally rejects isAbsolute(path), so safe absolute paths inside the workspace are treated like escapes.
- Working reference: plan-command.ts accepts absolute paths when they resolve under the workspace and rejects only paths whose relative result escapes; the store should match that behavior.
- Second root-cause detail: Node path.win32.isAbsolute("/tmp/...") returns true even on POSIX, so using it as an unconditional input rejection incorrectly blocks valid POSIX absolute paths. Windows drive/UNC forms need a platform-neutral explicit check, while workspace containment comes from the computed relative path.
