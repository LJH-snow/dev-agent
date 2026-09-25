# Findings — dev-agent 10-hour sprint

## Baseline — 2026-09-24

- Current branch: `codex/desktop-cli-workbench`; it tracks
  `origin/codex/desktop-cli-workbench`.
- The latest pushed commit is `9a1e08f` (`feat: complete Anthropic and Desktop
  workbench capabilities`).
- The tracked worktree is clean. `.playwright-cli/` and `output/` are local
  untracked QA artifacts and are intentionally not part of the implementation.
- Existing evidence before this sprint includes CLI **629/629**, Desktop
  **222/222**, Claude Agent SDK **13/13**, documentation **60/60**, native
  Desktop **2/2**, package smoke, build/typecheck, and `git diff --check`.
- The active source has task worktrees, diff grouping/file review/comments,
  loopback terminal APIs, preview URL validation, GitHub capability probing,
  skills/jobs metadata, and read-only monitoring.

## Initial security/lifecycle observations

- `apps/desktop/src/task-terminal.ts` currently uses a direct shell spawn for
  the user-facing terminal. It has bounded command/input/output, process-group
  termination, retention, and session binding, but it is a separate execution
  seam from the AgentLoop's shared approval/executor path.
- The Desktop server currently gates terminal/monitoring routes to loopback
  addresses and loopback origins. That is useful containment, but a local
  non-browser process can still call a loopback mutation route without a
  browser-origin token.
- `task-workspaces.ts` already performs managed-root and worktree checks; the
  sprint must verify canonical-path behavior at the terminal boundary as well,
  especially around symlink replacement and cleanup races.
- GitHub support is intentionally metadata-only today: the optional probe can
  report whether `gh` is available/authenticated, but mutation is permanently
  false. The sprint must preserve that invariant.

## Design direction

Use a server-scoped capability token for mutating browser APIs rather than
trying to infer trust from loopback origin alone. The token should be generated
per server instance, never logged or returned by a general API, and inserted
only into the served UI document. All mutating UI requests should use one
central request helper so the protection cannot drift route by route.

Do not turn this into an executable plugin loader or a remote-control surface.
Those remain deferred until a separate trust/install/rollback design exists.


## 2026-09-24 — capability boundary correction

- The token must be opt-in at the server factory boundary for tests and custom embedding hosts, but the normal `startDesktopEntry()` production path opts in. This keeps the browser security boundary explicit without silently breaking hosts that intentionally use `createDesktopServer()` as a test double.
- The token is not exposed by an API response. It is substituted into the HTML response only; direct `/public/index.html` loads receive the same token when served by an opted-in server.


## 2026-09-24 — verification findings

- The capability guard is centralized at the HTTP boundary: when enabled, every
  `POST`, `PUT`, `PATCH`, or `DELETE` under `/api/` requires the server-scoped
  header, while read-only `GET` metadata remains readable subject to the existing
  loopback/origin rules.
- `startDesktopEntry()` enables the guard in the production launcher.
  `createDesktopServer()` stays opt-in unless a token is supplied, preserving
  embedding/test-host compatibility.
- The served HTML receives the token through a no-store substitution, and the
  browser wrapper adds it only to same-origin API mutations; the token is not
  returned by a capability API or written to browser storage.
- Full evidence after the tranche: Desktop **224/224**, CLI **630/630**, package
  build/typecheck passed, TypeScript release gate passed, and `git diff --check`
  passed.
- The full ten-hour plan still contains deferred terminal cwd/lifecycle,
  read-only project capability-panel, metadata trace, and manual browser/PTY
  acceptance work. Those items are not represented as complete by this push.


## 2026-09-24 — terminal execution hardening

- Terminal working directories are resolved with `lstat`/`realpath` immediately
  before spawn; missing paths, non-directories, and final symlink paths fail closed.
  POSIX shells also verify `pwd -P` before executing the command so a later
  symlink redirect cannot silently change the effective cwd.
- Session deletion stops all terminal processes first, terminal shutdown escalates
  from process-group `SIGTERM` to `SIGKILL`, and session rename is rejected while
  a terminal is running. Server close still cleans up every terminal process.
- Terminal command summaries and system metadata redact credential-shaped values;
  stdin events retain only bounded byte counts rather than raw input. Normal
  stdout/stderr rendering and bounded retention remain compatible with the UI.
- Focused Desktop verification is **227/227**; Desktop build/typecheck and
  `git diff --check` pass. Browser/PTY manual acceptance remains open, as do the
  read-only project capability panel and metadata-only authorization trace slices.
- `.playwright-cli/`, `output/`, and the duplicate local planning directory remain
  untracked and are intentionally excluded from the delivery commit.



## 2026-09-24 — read-only project capability boundary

- Repository metadata is collected through bounded `git` commands and normalized to branch, dirty boolean, changed-file count, and remote host/provider. Remote URL paths, usernames, query strings, credentials, source contents, and working-directory paths never cross the capability response boundary.
- GitHub integration is opt-in only (`DEV_AGENT_DESKTOP_GITHUB=1`). The probe uses `gh auth status` and one bounded `gh run list --limit 1` read; no pull-request, merge, comment, workflow-dispatch, or credential-reading operation was added.
- The Desktop panel and `/api/monitoring` distinguish disabled/opt-in, unauthenticated, CLI unavailable, unsupported repository, no workflows, no runs, and unavailable states while retaining `readOnly: true`, `canApprove: false`, `canMutate: false`, and `mutationAllowed: false`.
- Custom host metadata is fail-closed at the HTTP boundary. It allowlists repository states, branch/host syntax, CI enums, skill/job fields, and bounded counts; it drops path/secret-like labels and forces mutation flags to false. In-progress CI runs may legitimately have an unknown conclusion and remain visible as status metadata.
- Verification after this slice: Desktop **230/230**, Desktop build/typecheck, and `git diff --check` pass. Browser/real-PTY acceptance and authorization/lifecycle trace fields remain later work.

## 2026-09-24 — delivery

- 已完成 staged diff review，并将预期源码、测试与 canonical 计划/文档提交为
  `95c1d91 feat: harden desktop terminal lifecycle`。
- 已验证 `origin/codex/desktop-cli-workbench` 指向 `95c1d91274d11e2026519a5330c7004895488c1a`。
- `.planning/2026-09-24-ten-hour-development/`、`.playwright-cli/` 与 `output/`
  仍为本地未跟踪目录，未被纳入 GitHub 推送。

## 2026-09-24 — capability panel delivery

- 已将只读项目能力面板、Git/GitHub bounded metadata、CI 状态与 custom-host normalization 提交为 `a52680f feat: expose read-only project capabilities`。
- 已推送到 `origin/codex/desktop-cli-workbench`；push 前验证 Desktop **230/230**、build、typecheck、`git diff --check`。
- 浏览器/真实 PTY 验收和 authorization/lifecycle trace fields 仍未完成；未跟踪 QA/重复计划目录继续排除。


## 2026-09-24 — trace boundary findings

- The shared runtime event stream already carries trusted tool-registry metadata,
  so capability class must be derived only from `tool.started` or
  `tool.approval-requested` metadata. Arbitrary event payloads are ignored.
  Plan-mode denials now emit an explicit metadata-only approval resolution so
  the trace records `deny` rather than mistaking a policy block for an
  unrequested tool.
- Terminal lifecycle is observed at the host-owned terminal manager boundary;
  preview lifecycle accepts only typed enum state and never accepts or stores a
  URL. Both paths feed the session's bounded `AgentRunTrace` rather than a
  second desktop registry.
- A concurrent untracked `DesktopCapabilityTraceRegistry` implementation was
  found during review. It duplicated `/trace/lifecycle`, added a second
  `/capability-trace` endpoint, and was not consumed by the UI. It was removed
  instead of allowing two divergent trace schemas.
- Observability callbacks are best-effort: trace recording is wrapped so a
  telemetry failure cannot alter the AgentLoop result or terminal process
  lifecycle.


## 2026-09-24 — browser acceptance finding

- Isolated browser acceptance exercised the actual Desktop server against a
  temporary Git repository. Repository/remote cards stayed metadata-only, the
  task terminal executed inside the fixture, and the loopback preview iframe
  loaded without exposing its URL in the Runtime trace.
- The first trace showed duplicate terminal start/completion events. The source
  of truth was split between the server terminal manager callback and the UI's
  generic lifecycle callback. Removing terminal emissions from the UI and
  retaining the server callback produced exactly one terminal lifecycle pair.
- Preview iframe events can arrive after a preview is cleared or before an
  active preview exists. `load`/`error` handlers now require `previewActive`
  as well as a visible frame, preventing false `failed` lifecycle records.


## 2026-09-24 — CLI PTY smoke finding

- A real pseudo-terminal launch is useful evidence that the shipped CLI path
  reaches the Ink renderer rather than the non-interactive fallback. The smoke
  capture showed the Signal Loom banner, `PageUp/PageDown` guidance, composer,
  and status footer, then exited cleanly on Ctrl-C.
- No startup `ESC[2J`, `ESC[3J`, or `ESC[H` clear-screen sequence appeared in
  the capture. A provider-backed fixture run then streamed a long transcript
  and accepted PageUp/PageDown escape input; the existing automated Ink tests
  remain the stronger assertion of the exact viewport offsets.


## 2026-09-24 — provider-backed CLI PTY finding

- The first PTY smoke used an unreachable provider and only proved launch/exit.
  A local fixture Ollama endpoint was then configured through
  `DEV_AGENT_CONFIG_FILE`, which avoided the real Ollama service and produced a
  deterministic streamed response. This is the correct boundary for manual
  PTY acceptance without credentials.
- The fixture path accepted `hello`, rendered a long transcript, received
  PageUp/PageDown bytes, and preserved the no-clear startup behavior. The next
  unresolved area is session recovery/maintenance, not terminal scrolling.

## 2026-09-24 — session recovery / maintenance finding

- Persisted session files were recoverable after a server reload, but the
  in-memory runtime registries were not lifecycle-coupled to rename/delete.
  A renamed session could leave its pending plan keyed by the old id, while a
  deleted session could leave replay/allowlist metadata available to a later
  same-id recovery.
- The maintenance fix keeps the session id as the lifecycle boundary: delete
  clears run, allowlist, and pending-plan state; rename moves session-scoped
  plan/allowlist state, drops the old replay cursor, and materializes the new
  session. The fix is intentionally metadata-only and does not broaden any
  capability or mutation boundary.
- Regression evidence: the renamed-session pending-plan workflow passes, and
  the full Desktop suite is green at **233/233**.

## 2026-09-24 — active session recovery finding

- A persisted session could be renamed successfully while the server continued
  advertising the original `defaultSessionId`. After a page reload, the Desktop
  picker could therefore select a stale id even though the renamed file was
  present. Delete could leave the same stale active-id behavior.
- The server now keeps a bounded active-session pointer, updates it on rename,
  invalidates it on delete, and derives a safe fallback from the current
  persisted summaries. Requests that omit `sessionId` follow that pointer.

## 2026-09-24 — active-session fallback evidence

- The recovery contract now has both rename and delete evidence: rename keeps
  the new id active, while deleting the active id selects an existing persisted
  session. This prevents the picker from restoring a session that no longer
  exists after reload.


## 2026-09-24 — Changes Center finding

- The existing bounded diff API was sufficient for an IDE-like presentation
  increment. Keeping search local to the file list avoided changing server
  authorization, path bounds, or patch semantics.
- Split rendering remains text-only and reuses parsed line anchors, so review
  comments, stale-session guards, merge, and cleanup boundaries remain intact.
