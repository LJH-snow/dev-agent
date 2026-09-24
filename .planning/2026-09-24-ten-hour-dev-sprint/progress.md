# Progress — dev-agent 10-hour sprint

## 2026-09-24 — baseline and plan

- Created the persistent ten-hour sprint plan under
  `.planning/2026-09-24-ten-hour-dev-sprint/`.
- Re-read the existing Desktop workflow plan, Gemini architecture alignment,
  current source, tests, and repository status.
- Confirmed the branch is based on GitHub commit `9a1e08f`; `.playwright-cli/`,
  `output/`, and the duplicate local planning directory are untracked local
  artifacts and remain excluded from delivery.
- Confirmed the current release-gate evidence from the previous completed
  slice, while treating it as a baseline rather than proof of this sprint's
  new requirements.
- Selected the first implementation slice: protect Desktop mutations with a
  server-scoped capability token, then harden terminal lifecycle/canonical cwd
  behavior.


## 2026-09-24 — terminal UX and capability boundary tranche

- Added bounded CLI mouse-wheel scrolling (`scrollBy` moves three wrapped rows; PageUp/PageDown remain page-sized) with a regression test. CLI suite is now **630/630**.
- Added session-local Desktop terminal command recall (64 entries, 4096 chars, deduplicated, draft restoration) without browser storage.
- Added Desktop manual-output-scroll preservation and explicit Follow latest control. Desktop suite is now **223/223** for the current UI changes.
- The production `startDesktopEntry()` path now opts into a server-scoped capability token. The token is injected only into served HTML and a central browser fetch seam sends it for same-origin mutation requests.
- Terminal/workspace mutation routes reject missing or incorrect tokens with a stable 403; direct `createDesktopServer()` hosts remain opt-in by default for compatibility, and a deterministic-token regression covers missing/wrong/valid requests and placeholder replacement.
- Current focused evidence: capability-token test and task-workspace tests pass. Full Desktop/release verification is still pending.


## 2026-09-24 13:22 — verification and delivery preparation

- Corrected the task-workspace test helper to send the new capability header for
  the session-rename mutation; the full Desktop suite now passes **224/224**.
- Desktop build and typecheck pass. The repository TypeScript release gate also
  passed, including the serialized workspace suites, CLI package-install smoke,
  preview contracts, documentation contracts, and native Desktop contracts.
- CLI remains **630/630**. `git diff --check` passes.
- The remaining work in this turn is a final staged-diff review followed by a
  commit and push. Browser/PTY manual acceptance and terminal canonical-cwd /
  lifecycle hardening remain explicitly deferred to later sprint slices.
- `.playwright-cli/`, `output/`, and the duplicate local planning directory are
  intentionally excluded from the commit.


## 2026-09-24 — terminal hardening verification

- 完成 terminal canonical cwd：校验并解析真实目录，拒绝 missing/file/final-symlink cwd，
  POSIX shell 启动时再用 `pwd -P` 进行 cwd guard。
- 完成 terminal lifecycle cleanup：session deletion 先停止进程，停止时执行 process-group
  `SIGTERM`/`SIGKILL` escalation，server close 继续清理全部 terminal；运行 terminal 时
  session rename 返回稳定的 409。
- 完成 command/input metadata redaction：command/system metadata 脱敏 credential-shaped
  值，stdin 只记录 bounded byte count；stdout/stderr 行为和输出上限保持兼容。
- 最新 focused Desktop suite 为 **227/227**；Desktop build/typecheck 和 `git diff --check`
  通过。浏览器/PTY 手工验收和后续 read-only capability panel、Git metadata、
  authorization trace slices 仍明确延后。
- 已只 stage 预期源码、测试和 canonical 计划/文档，排除本地 QA 产物；commit
  `95c1d91 feat: harden desktop terminal lifecycle` 已推送到
  `origin/codex/desktop-cli-workbench`。

## 2026-09-24 — read-only project capability panel

- 完成 Hour 5–7：`inspectRepository()` 只返回 bounded branch、dirty、changed-file count、remote host/provider；remote path、credential、文件内容和路径不会进入 HTTP response。
- GitHub/CI 只在 `DEV_AGENT_DESKTOP_GITHUB=1` 时探测；`gh auth status` 和 `gh run list --limit 1` 是 metadata-only read path，GitHub/CI mutation 永远为 `false`。
- Desktop 新增 GitHub、CI、Repository、Remote cards，monitoring 增加 normalized project/capability metadata，并区分 disabled、unauthenticated、unsupported、unavailable 和 no-runs。
- Custom host snapshots 在 HTTP 边界重新 normalize，禁止 `mutationAllowed: true`、path/secret-like labels、异常 branch/host 和超界计数；queued/in-progress CI run 保留 unknown conclusion。
- Desktop 全量测试为 **230/230**；build、typecheck、`git diff --check` 均通过。


## 2026-09-24 — capability panel delivery

- 已将只读项目能力面板、Git/GitHub bounded metadata、CI 状态与 custom-host normalization 提交为 `a52680f feat: expose read-only project capabilities`。
- 已推送到 `origin/codex/desktop-cli-workbench`；push 前验证 Desktop **230/230**、build、typecheck、`git diff --check`。
- 未跟踪的 `.playwright-cli/`、`output/` 与重复计划目录继续排除；浏览器/真实 PTY 验收、authorization trace 仍是后续工作。


## 2026-09-24 — metadata-only observability

- `AgentRunTrace` now records only allowlisted tool capability class
  (`read-only`/`mutating`/`dangerous`/`unknown`) and authorization outcome
  (`allow`/`deny`/`not-requested`/`unknown`) from trusted runtime metadata;
  prompt, tool input/output, paths, credentials, and raw errors remain excluded.
- Bounded terminal/preview lifecycle events (`started`, `loaded`, `completed`,
  `failed`, `stopped`, `cleared`) are exposed through the existing session trace;
  terminal callbacks and the preview lifecycle route are fail-closed and
  metadata-only. Trace retention is capped, and observability failures cannot
  change AgentLoop or terminal execution behavior.
- Removed an overlapping, unconsumed Desktop capability-trace registry and
  duplicate lifecycle endpoint so the shared `AgentRunTrace` is the single
  trace source. Host-owned repository/GitHub/CI probes remain read-only explicit
  boundaries rather than executable remote capabilities.
- Final verification: agent-core **212/212**, Desktop **232/232**, agent-core and
  Desktop build, Desktop typecheck, and `git diff --check` all pass. Browser/real
  PTY acceptance remains open; `.playwright-cli/`, `output/`, and the duplicate
  planning directory stay untracked and excluded.


## 2026-09-24 — metadata-only observability delivery

- 已将 metadata-only capability observability、自动化回归与 canonical 文档提交为
  `7d2331a feat: add metadata-only capability observability`。
- 已推送到 `origin/codex/desktop-cli-workbench`；远程分支已包含该提交。
- 本次提交只包含预期源码、测试和文档；`.planning/2026-09-24-ten-hour-development/`、
  `.playwright-cli/` 与 `output/` 仍为未跟踪 QA/重复计划目录，未纳入 GitHub。
- 浏览器/真实 PTY 手工验收仍是后续未完成项，不将自动化证据误报为手工验收。


## 2026-09-24 — isolated browser acceptance

- Against a temporary Git fixture repository (not the real project worktree),
  the built Desktop served the repository/GitHub/CI capability cards, ran an
  actual task-terminal command, loaded and cleared a loopback preview, and
  rendered the metadata-only Runtime trace. The trace showed exactly one
  `Terminal: started`, one `Terminal: completed`, `Preview: started`, and
  `Preview: loaded`; it exposed no prompt, tool payload, URL, path, or secret.
- Browser evidence uncovered duplicate terminal lifecycle events because both
  the authoritative server terminal manager and the browser controller reported
  the same state. The browser controller now reports preview lifecycle only;
  server terminal callbacks remain authoritative. Stale iframe load/error events
  are ignored when no preview is active.
- Targeted regression/build evidence after the fix: Desktop **39/39** trace,
  server, and terminal tests; Desktop build and `git diff --check` pass.
  The prior full Desktop suite remains **232/232**.
- The isolated browser server, fixture HTTP server, and browser session were
  stopped after acceptance. QA artifacts remain untracked and excluded.
