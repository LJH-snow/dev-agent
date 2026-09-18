# 2026-09-18 overnight goals progress

## Goal 1: Managed runtime user actions

**Status:** DONE

**Scope completed:**

- Added a metadata-only guidance line to the Desktop managed runtime status row.
- Mapped the five runtime states (`installed`, `missing`, `unsupported`,
  `corrupt`, and `unavailable`) to fixed user-facing next actions.
- Kept the existing API schema and metadata-only sanitization unchanged.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/status-api.test.ts`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **89 tests passed, 0 failed.**

**Conflict note:** This slice intentionally avoided `apps/cli`,
`packages/runtime-manager`, `package.json`, and the other window's active files.

## Goal 2: Desktop status state semantics

**Status:** DONE

**Scope completed:**

- Kept the existing `/api/status` schema and metadata-only rules unchanged.
- Added an explicit `aria-busy` lifecycle to the Desktop status refresh button
  so loading and settled states are announced, not just inferred from focus.
- Preserved the existing success note and failure-safe value reset behavior.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/status-api.test.ts`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **90 tests passed, 0 failed.**

## Goal 3: Session list health summary

**Status:** DONE

**Scope completed:**

- Reused the existing metadata-only evidence summary fields; no API schema or
  session history schema changed.
- Added a safe compact summary to the Desktop session picker showing message,
  validation, change-set, and protected guard counts.
- Degraded sessions with missing or malformed summary fields back to the
  existing session id label.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/status-api.test.ts`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **91 tests passed, 0 failed.**

## Final integration gate

**Status:** PASSED

**Commands:**

```sh
pnpm build
pnpm verify:typescript
```

**Result:** All selected TypeScript gates passed. Desktop tests were **95/95**,
runtime-manager tests were **15/15**, and CLI tests were **311/311**. The CLI
package smoke and documentation contracts also passed. No tag, push, npm
publish, GitHub Release, or `~/.npmrc` change was made.

## Goal 6: Approval review boundaries

**Status:** PRESERVE

**Scope completed:**

- Rechecked the current Desktop UI and server behavior for empty diffs,
  multi-file reviews, denial, timeout, disconnect, and rollback hash guards.
- Existing tests already cover real diffs, denial, no-requester denial,
  rollback, postimage-hash mismatch, approval timeout, and client disconnect.
- The UI already distinguishes empty textual diffs and still preserves
  existence/hash checks, so no behavior change was needed.

**Files touched:**

None for this goal.

## Goal 7: Desktop MCP status summary

**Status:** DONE

**Scope completed:**

- Added a safe `mcp` summary to `/api/status` with configured and connected
  counts only.
- Added an MCP row to the Desktop status panel.
- Kept MCP command, args, env, cwd, absolute paths, and raw stderr out of the
  status surface.

**Files touched:**

- `apps/desktop/src/chat-session.ts`
- `apps/desktop/src/status.ts`
- `apps/desktop/public/index.html`
- `apps/desktop/README.md`
- `apps/desktop/tests/status.test.ts`
- `apps/desktop/tests/status-api.test.ts`
- `apps/desktop/tests/server.test.ts`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **95 tests passed, 0 failed.**

## Goal 10: v0.1.7 Desktop candidate checklist

**Status:** DONE

**Scope completed:**

- Created a separate v0.1.7 Desktop candidate checklist.
- Recorded which changes are workspace-only and which already shipped with
  0.1.6.
- Kept the current state explicit as no-tag/no-push/no-publish/no-release.
- Listed the remaining verification gates and human decisions required before
  any release.

**Files touched:**

- `docs/release-candidate-checklist-v0.1.7-desktop.md`

**Verification:** Documentation-only; no release action was taken.

## Goal 8: Workspace visibility

**Status:** DONE

**Scope completed:**

- Added a sanitized `workspace.label` derived from the basename of the active
  working directory.
- Added the label to `/api/status` and to the Desktop status panel.
- Explicitly rejected path-like, traversal-like, and secret-like labels.

**Files touched:**

- `apps/desktop/src/chat-session.ts`
- `apps/desktop/src/status.ts`
- `apps/desktop/public/index.html`
- `apps/desktop/README.md`
- `apps/desktop/tests/status.test.ts`
- `apps/desktop/tests/status-api.test.ts`
- `apps/desktop/tests/server.test.ts`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **95 tests passed, 0 failed.**

## Goal 9: Evidence retention auditability

**Status:** DONE

**Scope completed:**

- Added a fixed safe explanation that applied change-set guards remain for
  validation and are not removed by cleanup.
- Kept existing evidence preview, cleanup, rollback, and retention behaviors
  unchanged.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/server.test.ts`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **95 tests passed, 0 failed.**

## Goal 4: Evidence preview failure semantics

**Status:** DONE

**Scope completed:**

- Preserved the existing request-id, abort-controller, and stale-data guards.
- Added distinct safe messages for `404`, `413`, and `400` evidence-preview
  failures while keeping the generic message for other failures.
- Kept file contents and paths out of the UI and API surface.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/server.test.ts`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **91 tests passed, 0 failed.**

## Goal 5: Validation card state and rerun semantics

**Status:** DONE

**Scope completed:**

- Kept the four validation states (`passed`, `failed`, `skipped`, `blocked`)
  explicit and distinct in the validation card.
- Preserved original evidence when a rerun fails.
- Distinguished rerun `409`, `404`, and `501` outcomes from generic failure.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/validation.test.ts`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **91 tests passed, 0 failed.**

## Follow-up Goal 11: Runtime release documentation

**Status:** DONE

**Scope completed:**

- Added documentation for `--runtime-release <version>` as the explicit way to
  select the GitHub release carrying the runtime manifest and archive.
- Recorded that the default carrying release is `0.1.6`, runtime identity can
  differ, and the cache remains keyed by `--runtime-version`.
- Documented `pnpm runtime:smoke` as an additional local verification path,
  not release authorization.
- Kept all implementation work by the other window untouched.

**RED contract:**

- Added `runtime release selection and smoke command are documented as
  candidate-only` to `tests/documentation-contract.test.mjs`.
- First run: **1 failed / 10 passed** because the required documentation was
  absent.

**Files touched:**

- `apps/cli/README.md`
- `docs/CHANGELOG.md`
- `docs/next-roadmap-plans-v62-plus.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
node --test tests/documentation-contract.test.mjs
pnpm --filter @dev-agent/runtime-manager run test
pnpm --filter @agent_cli/cli run test
pnpm --filter @dev-agent/desktop run test
```

Result after documentation: documentation contract **11/11**, runtime-manager
**15/15**, CLI **312/312**, and Desktop **95/95**. `git diff --check` passed.

## Final audit for the completed window

**Status:** PASSED

```sh
pnpm build
pnpm verify:typescript
```

Result: **all selected TypeScript gates passed.** This included CLI package
smoke, preview contracts, release/publish workflow contracts, CI workflow
contracts, and documentation contracts. The visible focused counts remained
Desktop **95/95**, runtime-manager **15/15**, and CLI **312/312**. No tag,
push, npm publish, GitHub Release, or `~/.npmrc` change was made.

The worktree intentionally retains the other window's uncommitted CLI/runtime
changes plus this window's documentation and Desktop work. A local commit was
not created, because committing now would bundle another window's in-progress
implementation without a coordinated handoff.

**Conflict note:** During the final audit, the other window also updated
`README.md` and `docs/release-cli-npm.md` with the same runtime-release
candidate wording. Those files were not edited by this window. The documentation
contract was rerun afterward and passed **11/11**.

## Follow-up Goal 12: Runtime smoke evidence

**Status:** DONE with environment note

**Scope completed:**

- Ran the local isolated runtime-install smoke against the known `v0.1.6`
  release assets.
- Did not modify release state, the user runtime cache, CLI/runtime-manager
  implementation, credentials, tags, remotes, or releases.

**Verification:**

```sh
pnpm runtime:smoke
```

First result: failed at the real runtime archive download with the stable
`DOWNLOAD_FAILED` metadata. Reachability checks confirmed the fixed release URL
was reachable via the configured proxy; the current environment has
`HTTP_PROXY` and `HTTPS_PROXY` set.

Second, different approach:

```sh
NODE_USE_ENV_PROXY=1 pnpm runtime:smoke -- --skip-build
```

Result: **Runtime install smoke passed.** This confirms the candidate install
path works with Node's environment proxy support enabled. The default smoke
without proxy support should not be interpreted as a code regression in this
proxy-configured environment.

## Follow-up Goal 13: Strengthen candidate release gates

**Status:** DONE

**Scope completed:**

- Revalidated the Rust implementation boundary behind the managed runtime.
- Added the Rust and real-integration results to the v0.1.7 candidate
  checklist.
- Did not change implementation, release state, tags, remotes, or releases.

**Verification:**

```sh
pnpm verify:rust
pnpm verify:integration
```

Result: Rust format/clippy passed and unit/doc tests were **54/54**. Real Rust
integration passed **11/11**, including sandbox policy, readonly and network
boundaries, timeout/resource/output limits, cancellation, and concurrency.

## Follow-up Goal 14: Read-only release preflight evidence

**Status:** DONE

**Scope completed:**

- Ran the metadata-only npm release preflight without publishing.
- Added the result to the v0.1.7 candidate checklist.
- Kept release authorization explicitly separated from technical readiness.

**Verification:**

```sh
pnpm release:preflight
```

Result: passed. Candidate `0.1.7` metadata matched `docs/release-state.json`,
npm auth was present, registry `0.1.6` matched the recorded published version,
and the package artifact allowlist contained five expected files. The tool's
`nextAction: publish_candidate` remains a technical next action, not release
authorization.

## Follow-up Goal 15: Index current candidate evidence

**Status:** DONE

**Scope completed:**

- Added the 2026-09-18 overnight plan, progress record, and v0.1.7 Desktop
  candidate checklist to the root README and documentation index.
- Added Roadmap item 81 for managed runtime and Desktop project-surface
  hardening, keeping release authorization gated.
- Did not change implementation or release state.

**RED contract:**

- Added `current overnight and v0.1.7 candidate evidence is indexed` to
  `tests/documentation-contract.test.mjs`.
- First run: **1 failed / 11 passed** because the documentation was not indexed.

**Files touched:**

- `README.md`
- `docs/README.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

Result: documentation contract **12/12** and whitespace check passed.

## Follow-up Goal 16: Document proxy-aware runtime smoke

**Status:** DONE

**Scope completed:**

- Added the proxy-aware runtime smoke command to CLI README.
- Added the same environment condition and explicit skip-build variant to the
  v0.1.7 candidate checklist.
- Recorded that the default smoke failure was proxy-related and the proxy-aware
  smoke passed; this is not treated as implementation release authorization.
- Did not change runtime download behavior or the smoke script.

**RED contract:**

- Added `runtime smoke documents the proxy-aware verification command` to
  `tests/documentation-contract.test.mjs`.
- First run: **1 failed / 12 passed** because the required proxy guidance was
  absent.

**Files touched:**

- `apps/cli/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

Result: documentation contract **13/13** and whitespace check passed.

## Follow-up Goal 17: Consolidated final worktree gate

**Status:** DONE

**Scope completed:**

- Ran the complete fixed verification runner on the final documentation and
  implementation state instead of relying only on separately passed phase
  gates.
- Recorded the consolidated result in the v0.1.7 candidate checklist.
- Did not change implementation, release state, tags, remotes, or releases.

**Verification:**

```sh
pnpm verify
```

Result: **all selected gates passed.** The same run included the TypeScript
build/typecheck/test package gates, CLI package smoke, preview/release/publish/
CI workflow contracts, documentation contract **13/13**, Rust format/clippy and
unit/doc tests **54/54**, and real Rust integration **11/11**. Desktop remained
**95/95**, runtime-manager **15/15**, and CLI **312/312**. This evidence remains
workspace-only and does not authorize a release.

## Follow-up Goal 18: CLI runtime release contract

**Status:** DONE

**Scope completed:**

- Added CLI-level regression coverage for `--runtime-release`.
- Locked explicit and blank release parsing, the `0.1.6` default, and the
  separation between carrying release and runtime identity.
- Verified that `runtime status` accepts the release flag without leaking
  release/manifest metadata or local paths.
- Did not modify CLI/runtime implementation or execute a real install in this
  test; the full install path remains covered by runtime-manager tests and the
  proxy-aware runtime smoke.

**Files touched:**

- `apps/cli/tests/runtime-command.test.ts`

**Verification:**

```sh
pnpm --filter @agent_cli/cli run test
```

Result: **314 tests passed, 0 failed.**

## Post-goal-18 final audit

**Status:** PASSED

**Scope completed:**

- Rechecked the plan and progress through goals 1-10 and follow-ups 11-18.
- Reconfirmed that another window's CLI/runtime implementation remains staged
  and that no staged implementation files were unstaged, reverted, or edited.
- Updated the candidate checklist so its consolidated gate evidence records the
  final CLI count instead of mixing a pre-goal-18 verify count with a later
  focused count.
- Continued to withhold all release authorization actions.

**Verification:**

```sh
pnpm verify
```

Result: **all selected gates passed.** The same final worktree run covered
TypeScript build/typecheck/test gates, CLI package smoke, release/publish/CI
workflow and documentation contracts, Rust format/clippy plus unit/doc tests
**54/54**, and real Rust integration **11/11**. Focused counts in the same run
were Desktop **95/95**, runtime-manager **15/15**, CLI **314/314**, and
documentation contract **13/13**. No tag, push, npm publish, GitHub Release, or
`~/.npmrc` change was made.

## Follow-up Goal 19: Desktop executor-mode display audit

**Status:** PRESERVE

**Scope completed:**

- Bounded v65 audit only: no new panel, shortcut, notification, export surface,
  visual redesign, executor behavior change, or public schema change.
- Locked the allowlisted `/api/status` fallback for a legacy fake session with
  no executor metadata: it reports `executor: { mode: "unknown" }` without
  paths or raw diagnostics.
- Locked that the status panel HTML actually renders `payload.executor.mode`
  into the Executor value/state elements and requires executor metadata in the
  response shape.
- Existing implementation already provided the required metadata-only surface,
  so no production code was needed.

**Files touched:**

- `apps/desktop/tests/status-api.test.ts`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

Result: Desktop **97 tests passed, 0 failed**, documentation contract
**13/13**, and whitespace check passed.

**Follow-up final gate:**

```sh
pnpm verify
```

Result: **all selected gates passed** on the post-goal-19 worktree. The run
confirmed Desktop **97/97**, runtime-manager **15/15**, CLI **314/314**,
documentation contract **13/13**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**. No tag, push, npm publish, GitHub Release, or `~/.npmrc`
change was made.

## Post-goal-19 release preflight refresh

**Status:** PASSED

**Scope completed:**

- Rechecked the current `@agent_cli/cli@0.1.7` candidate after the executor-mode
  display audit without publishing.
- Reconfirmed that the registry remains at `0.1.6`, npm authentication is
  available, and the candidate tarball allowlist still contains five files.
- Continued to treat `nextAction: publish_candidate` as a technical next step,
  not release authorization.

**Verification:**

```sh
pnpm release:preflight
```

Result: **preflight passed.** Candidate `0.1.7`, published registry `0.1.6`,
authenticated npm identity, and five expected package files. No tag, push, npm
publish, GitHub Release, or `~/.npmrc` change was made.

## Post-goal-19 runtime smoke refresh

**Status:** PASSED

**Scope completed:**

- Revalidated the staged runtime-release implementation through the isolated
  package-install smoke against the known `v0.1.6` release assets.
- Did not publish, create tags, touch the user runtime cache, or modify staged
  CLI/runtime files.

**Verification:**

```sh
NODE_USE_ENV_PROXY=1 pnpm runtime:smoke -- --skip-build
```

Result: **Runtime install smoke passed.** The isolated lifecycle still covered
status, install, path, doctor, and remove with the current candidate package.

## Follow-up Goal 20: v0.1.7 maintainer review handoff

**Status:** DONE

**Scope completed:**

- Added a documentation-only review handoff to the v0.1.7 candidate checklist.
- Separated the observed staged runtime-release slice from the unstaged
  Desktop hardening slice and the coordination-sensitive CLI/docs/evidence
  updates.
- Documented the shared staging index risk and required maintainer decisions
  before bundling commits or releasing.
- Added a RED documentation contract first; it failed once while the handoff
  was absent, then passed after the checklist update.

**Files touched:**

- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

Result: documentation contract **14/14** and whitespace check passed.

## Follow-up Goal 21: Doctor managed-state merge semantics

**Status:** DONE

**Scope completed:**

- Completed a bounded v65 audit of the staged doctor managed-state merge without
  editing CLI, runtime-manager, or another window's active implementation files.
- Confirmed the real CLI path permits an explicit `--rust-executor` selection
  together with managed runtime flags/status, so the doctor payload can combine
  the selected binary's `runtimeVersion/protocolVersion` with the managed cache's
  `state/target`.
- Observed through an injectable `runDoctor` audit that a mismatched selected
  probe still reports `runtimeVersion: "0.1.0"` alongside `state: "installed"`
  from managed cache, while the `rust runtime` check fails and the summary
  includes one fail. This is metadata-only, but the semantics needed explicit
  candidate documentation.
- Preserved the doctor implementation and schema. Added a contract-backed
  candidate checklist clarification instead.

**Files touched:**

- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

First documentation-contract run: **1 failed / 14 passed** because the doctor
merge semantics were absent from the candidate checklist.

Result after documentation: documentation contract **15/15** and whitespace
check passed.

**Conflict note:** No staged implementation file was edited, unstaged, reverted,
or committed. This goal did not create a tag, push, npm publish, GitHub Release,
or `~/.npmrc` change.

## Post-goal-21 final audit

**Status:** PASSED

**Verification:**

```sh
pnpm verify
```

Result: **all selected gates passed** on the post-goal-21 worktree. This
included the TypeScript build/typecheck/test gates, package contracts,
documentation contract **15/15**, Rust format/clippy plus unit/doc tests
**54/54**, and real Rust integration **11/11**. Focused counts were Desktop
**97/97**, runtime-manager **15/15**, and CLI **314/314**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
worktree intentionally remains uncommitted because the staged runtime-release
slice and this window's unstaged slices require coordinated maintainer review.

## Post-goal-21 release preflight refresh

**Status:** PASSED

```sh
pnpm release:preflight
```

Result: **preflight passed.** Candidate `0.1.7`, published registry `0.1.6`,
authenticated npm identity, and five expected package files. This remains
readiness evidence only; `nextAction: publish_candidate` does not authorize
publishing.

## Follow-up Goal 23: Desktop server failure boundary

**Status:** DONE

**Scope completed:**

- Added a Desktop server regression for an injected `getStatus` failure that
  contains a path and secret-like value.
- Confirmed the previous top-level HTTP handler leaked that raw error message
  through `/api/status`.
- Changed the uncaught server handler to return the stable generic body
  `{ error: "request failed" }` with status `500`.
- Kept endpoint-specific 400/404/409/413/501 behavior unchanged and did not
  alter the Desktop status schema or metadata allowlist.

**RED contract:**

- Added `GET /api/status turns an internal status failure into a stable 500`
  to `apps/desktop/tests/status-api.test.ts`.
- First run: **1 failed / 97 passed** because the raw message was returned.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/status-api.test.ts`
- `apps/desktop/README.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
git diff --check
```

Result: Desktop **98 tests passed, 0 failed**. No tag, push, npm publish,
GitHub Release, or `~/.npmrc` change was made. No staged runtime-release file
was edited or unstaged.

```sh
node --test tests/documentation-contract.test.mjs
```

Result: documentation contract **16/16**. The v0.1.7 candidate checklist now
also records the stable server failure boundary.

## Post-goal-23 final audit

**Status:** PASSED

**Verification:**

```sh
pnpm verify
```

Result: **all selected gates passed** on the post-goal-23 worktree. Focused
counts were Desktop **98/98**, runtime-manager **15/15**, CLI **314/314**,
documentation contract **16/16**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**. No tag, push, npm publish, GitHub Release, or
`~/.npmrc` change was made.

## Post-goal-23 handoff snapshot

**Status:** PASSED

The remaining 2026-09-18 Desktop hardening, documentation-contract, and
evidence slice has been committed locally as `8bb59b3
fix: harden desktop status and error boundaries`. It is ahead of `origin/main`
by one commit and has not been pushed.

The staged runtime-release slice was separately committed and pushed by the
other window as `69c8a9f fix: install managed runtime from the official
release`. The two slices were not bundled. No tag, push, npm publish, GitHub
Release, or `~/.npmrc` change was made in this window.

## Final handoff snapshot

**Status:** PASSED

Current branch is `main`, ahead of `origin/main` by the existing local commit
`02e1b92 docs: add overnight project goals plan`. No new commit was created.

The staged runtime-release slice contains **12 files changed, 296 insertions,
11 deletions**:

- CLI runtime-release implementation, doctor/index/runtime-command updates
- runtime-manager manifest-release support and tests
- CLI doctor tests and package/docs updates
- isolated runtime install smoke script

The unstaged hardening/evidence/docs slice contains **14 files changed, 712
insertions, 11 deletions**:

- Desktop managed-runtime, status/session/MCP/workspace, evidence, validation,
  and approval-boundary hardening plus tests
- CLI runtime-release regression tests
- 2026-09-18 plan and documentation-contract/index updates

Untracked project evidence remains:

- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`

`.obsidian/` is local editor state and is not project work. The shared staging
index still contains files owned by another window; maintainers must review the
two slices separately or coordinate a combined review before committing. No tag,
push, npm publish, GitHub Release, or `~/.npmrc` change was made.

## Follow-up Goal 22: Project-state release attribution

**Status:** DONE

**Scope completed:**

- Rechecked `--project-state` release history against `docs/CHANGELOG.md`.
- Confirmed the feature was first published in `@agent_cli/cli@0.1.3`; the
  roadmap reference to `0.1.5` was stale.
- Corrected the roadmap attribution without touching implementation, release
  state, staged files, or another window's active implementation.

**RED contract:**

- Added `roadmap attributes the first project-state release to 0.1.3` to the
  documentation contract.
- First run: **1 failed / 15 passed** because the roadmap still attributed the
  first release to `0.1.5`.

**Files touched:**

- `docs/next-roadmap-plans-v62-plus.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
```

Result: documentation contract **16/16** and whitespace check passed. No tag,
push, npm publish, GitHub Release, or `~/.npmrc` change was made.

## Post-goal-22 final audit

**Status:** PASSED

**Verification:**

```sh
pnpm verify
```

Result: **all selected gates passed** on the post-goal-22 worktree. Focused
counts were Desktop **97/97**, runtime-manager **15/15**, CLI **314/314**,
documentation contract **16/16**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**. No tag, push, npm publish, GitHub Release, or
`~/.npmrc` change was made. The worktree remains intentionally uncommitted for
maintainer review of the staged and unstaged slices.

## Post-goal-22 release preflight refresh

**Status:** PASSED

```sh
pnpm release:preflight
```

Result: **preflight passed.** Candidate `0.1.7`, published registry `0.1.6`,
authenticated npm identity, and five expected package files. This remains
readiness evidence only; `nextAction: publish_candidate` does not authorize
publishing.

## Follow-up Goal 24: Candidate handoff provenance refresh

**Status:** DONE

**Scope completed:**

- Replaced the stale statement that the runtime-release and Desktop hardening
  slices remained uncommitted.
- Recorded that the runtime-release slice was committed and pushed as
  `69c8a9f` by its owning window.
- Recorded that the Desktop hardening/evidence/docs slice was committed locally
  as `9c6592c`.
- Kept the candidate release decision gated and unchanged.

**RED contract:**

- Updated `v0.1.7 candidate defines a maintainer review handoff` to require the
  resolved provenance for both slices.
- First run: **1 failed / 16 passed** because the candidate checklist still
  described the focused work as uncommitted.

**Files touched:**

- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
node --test tests/documentation-contract.test.mjs
git diff --check
pnpm verify
```

Result: documentation contract **16/16** and whitespace check passed. The
complete final audit passed with Desktop **98/98**, runtime-manager **15/15**,
CLI **314/314**, documentation contract **16/16**, Rust unit/doc tests
**54/54**, and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
follow-up documentation refresh can be committed locally as a separate commit.

## Follow-up Goal 25: Desktop status stale-response safety

**Status:** DONE

**Scope completed:**

- Added a request ID, AbortController, signal, stale request/session guard, and
  current-request-only cleanup to Desktop status loading.
- Preserved the `/api/status` schema, metadata allowlist, and managed-runtime
  sanitization while preventing a stale response from rendering.
- Documented the stale-safe behavior in the Desktop README and v0.1.7
  candidate checklist.

**RED contract:**

- Added `GET / guards desktop status responses against stale sessions` to the
  Desktop UI contract.
- First run failed once before the implementation because the status request
  lacked the request ID, AbortController, signal, and stale/session guards.
- Added `v0.1.7 documents desktop status stale-response safety` to the
  documentation contract.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/status-api.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
pnpm verify
git diff --check
```

Result: Desktop focused tests **99/99** and `pnpm verify` completed with
`all selected gates passed`. Focused counts were runtime-manager **15/15**,
CLI **314/314**, documentation contract **17/17**, Rust unit/doc tests
**54/54**, and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 25 slice can be committed locally as a separate commit.

## Follow-up Goal 26: Desktop session-history stale-response safety

**Status:** DONE

**Scope completed:**

- Added a request ID, AbortController, signal, stale request/session guard, and
  current-request-only cleanup to Desktop session history loading.
- Preserved the `/api/sessions/<id>/messages` schema and existing transcript,
  validation, empty-state, and failure behavior.
- Documented the stale-safe history behavior in the Desktop README and v0.1.7
  candidate checklist.

**RED contract:**

- Added `GET / guards desktop session history responses against stale sessions`
  to the Desktop UI contract.
- First run: **1 failed / 99 passed** because history loading lacked the
  request ID, AbortController, signal, and stale/session guards.
- Extended the Desktop stale-response documentation contract to require both
  status and history safety.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/status-api.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **100/100**, documentation contract **17/17**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 26 slice can be committed locally as a separate commit.

## Follow-up Goal 27: Desktop validation-rerun stale safety

**Status:** DONE

**Scope completed:**

- Added a request ID, AbortController, signal, stale request/session guard, and
  current-request-only cleanup to Desktop validation rerun requests.
- Preserved the `/api/changesets/validate` schema, DTO rendering, and the
  existing `409`/`404`/`501` state copy.
- Prevented stale rerun responses from updating status, marking evidence stale,
  or appending a validation card.
- Documented the stale-safe rerun behavior in the Desktop README and v0.1.7
  candidate checklist.

**RED contract:**

- Added `GET / guards desktop validation rerun responses against stale
  sessions` to the Desktop UI contract.
- Added `v0.1.7 documents desktop validation rerun stale safety` to the
  documentation contract.
- First Desktop run: **1 failed / 100 passed** because rerun loading lacked the
  request ID, AbortController, signal, and stale/session guards.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/validation.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **101/101**, documentation contract **18/18**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 27 slice can be committed locally as a separate commit.

## Follow-up goals 25-27 final handoff snapshot

**Status:** PASSED

The branch is `main`, clean, and ahead of `origin/main` by the following local
commits:

- `32ad8d5 fix: guard desktop status stale responses`
- `bc10de0 fix: guard desktop session history stale responses`
- `dcd4066 fix: guard desktop validation rerun stale responses`

Goals 25, 26, and 27 are `DONE`. The latest full audit completed with Desktop
**101/101**, runtime-manager **15/15**, CLI **314/314**, documentation contract
**18/18**, Rust unit/doc tests **54/54**, real Rust integration **11/11**, and
`all selected gates passed`.

Release remains gated: no Git tag, no push, no npm publish, no GitHub Release,
and no `~/.npmrc` change. The next human decision is whether to push the
accumulated local commits and authorize the `v0.1.7` release review window.

## Follow-up Goal 40: Desktop public symlink containment

**Status:** DONE

**Scope completed:**

- `/public/` now resolves both the requested file path and the public directory
  to real paths before reading a file.
- A symlink inside `public/` that resolves outside the real public directory
  returns a clean `404`; it cannot expose the parent `package.json`.
- A broken symlink also returns a clean `404` without raw diagnostics.
- Normal static assets and the existing `1 MiB` static response limit remain
  unchanged.
- Documented the symlink containment behavior in the Desktop README and the
  v0.1.7 candidate checklist.

**RED contract:**

- Added `public/escape.tmp.json` -> `../package.json` as a temporary test-only
  symlink and proved the current server returned `200` before the fix.
- Added a broken-link contract and the documentation containment contract.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server-edge-cases.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

RED was Desktop focused tests **118/118, 1 failed** and documentation contract
**30/30, 1 failed**. After implementation, Desktop focused tests were
**119/119**, documentation contracts **31/31**, and `pnpm verify` completed
with `all selected gates passed`. The full gate counts were runtime-manager
**15/15**, CLI **314/314**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**.

## Follow-up Goal 38: guard Desktop rename lifecycle

**Status:** DONE

**Scope completed:**

- Checked both the source and target session before Desktop rename work.
- Locked the source through request processing and held source/target locks
  through the asynchronous memory-file rename.
- Returned a stable `409` when renaming into an active target, leaving the
  source memory file in place.
- Returned a stable `409` to the loser of a concurrent same-source rename,
  preventing duplicate success.
- Rejected a new unknown chat target before creating its registry session
  while that target is locked by an active rename.
- Documented the target and concurrent rename fail-closed behavior in the
  Desktop README and v0.1.7 candidate checklist.

**RED contract:**

- Added `rename refuses a target with an active Desktop run` and
  `concurrent renames of the same source fail closed` to the Desktop server
  contract.
- Added `v0.1.7 documents Desktop rename target and concurrency fail-closed
  behavior` to the documentation contract.
- RED proof: without target locking, the active-target rename returned `200`;
  concurrent same-source renames returned `200` and `500`. Desktop focused
  tests recorded **114 passed / 2 failed**, and documentation contracts
  recorded **28 passed / 1 failed**.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/multi-session.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **116/116**, documentation contract **29/29**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 38 slice can be committed locally as a separate commit.

## Follow-up Goal 39: bound Desktop export responses

**Status:** DONE

**Scope completed:**

- Added a fixed `1 MiB` response limit to Desktop Markdown session export.
- Returned a stable JSON `413` for oversized exports without echoing the
  transcript, path, contents, or raw error.
- Preserved Markdown transcript, evidence filters, and evidence-summary
  behavior for smaller sessions.
- Documented the export-response limit in the Desktop README and v0.1.7
  candidate checklist.

**RED contract:**

- Added `export response rejects output larger than 1 MiB` to the Desktop
  server contract.
- Added `v0.1.7 documents the Desktop export response limit` to the
  documentation contract.
- RED proof: without a limit, an oversized Markdown export returned `200`.
  Desktop focused tests recorded **116 passed / 1 failed**, and documentation
  contracts recorded **29 passed / 1 failed**.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server-edge-cases.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **117/117**, documentation contract **30/30**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 39 slice can be committed locally as a separate commit.

## Follow-up Goal 30: rollback joins active session lifecycle

**Status:** DONE

**Scope completed:**

- Tracked a running rollback in the Desktop server's existing `inFlight`
  session lifecycle.
- A concurrent rollback now returns `409`, does not invoke rollback again, and
  the endpoint accepts a new rollback after the first one is released.
- While rollback is active, `DELETE /api/sessions/<id>` and
  `POST /api/sessions/<id>/rename` return `409` without mutating evidence or
  the memory file.
- Unified the active-session error message across chat, validation, cleanup,
  and rollback.
- Documented the rollback lifecycle boundary in the Desktop README and the
  v0.1.7 candidate checklist.

**RED contract:**

- Added focused contracts for concurrent rollback and for DELETE/rename while
  rollback is active.
- Replaced the temporary external `curl` child-process helper with a Node
  `http.request` helper. The fake rollback now blocks until the test explicitly
  releases it, removing scheduling sensitivity that appeared when Desktop and
  CLI tests ran in parallel.
- RED proof removed only the rollback `inFlight.add` call; the focused run then
  recorded **19 passed / 2 failed**, with both new contracts returning `200`
  instead of `409`. The implementation was restored afterward.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **106/106**, documentation contract **21/21**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 30 slice can be committed locally as a separate commit.

## Follow-up Goal 31: bound Desktop JSON request bodies

**Status:** DONE

**Scope completed:**

- Added a fixed `1 MiB` limit to the shared Desktop POST JSON body reader.
- Oversized bodies return a stable `413` without echoing the body, path, or raw
  error.
- Kept malformed/empty/unknown-session status behavior and JSON DTOs unchanged.
- Documented the request-body limit in the Desktop README and v0.1.7 candidate
  checklist.

**RED contract:**

- Added a Desktop server contract asserting that an oversized `POST /api/chat`
  body returns `413` and never starts the session run.
- Added a documentation contract for the same boundary in the Desktop README and
  candidate checklist.
- RED proof temporarily set the limit to `Number.MAX_SAFE_INTEGER`; the focused
  server contract returned `400` instead of `413`, and the documentation
  contract recorded **21 passed / 1 failed**. The `1 MiB` limit and docs were
  restored afterward.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **107/107**, documentation contract **22/22**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 31 slice can be committed locally as a separate commit.

## Follow-up Goal 32: bound the Desktop session registry

**Status:** DONE

Opened a bounded follow-up after the Goal 31 audit found that `sessionFor()`
created and retained an in-memory session for every unknown chat id with no
fixed count limit. The target is a fixed total limit of `256`, with an
oversized-registry chat returning a stable `429` before a new run starts. RED
contracts will be added before implementation.

RED confirmed for the new server contract: after filling the registry with the
default session plus 255 injected sessions, the 256th new unknown chat id
returned `200` instead of `429`; Desktop focused tests recorded
**107 passed / 1 failed**. The documentation contract also failed with
**22 passed / 1 failed**. The first test draft failed TypeScript compilation
because its emitted event parameter was over-typed; using the existing loose
test event type corrected that before the behavioral RED run.

**Scope completed:**

- Added a fixed `256` total-entry limit to the Desktop in-memory session
  registry.
- Chat requests for a new unknown id return a stable `429` after the limit and
  do not create or run a session.
- Existing sessions, including the default one, continue to work at the limit.
- Preserved DELETE/rename registry behavior, lifecycle guards, and chat/session
  DTOs.
- Documented the session registry limit in the Desktop README and v0.1.7
  candidate checklist.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **108/108**, documentation contract **23/23**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 32 slice can be committed locally as a separate commit.

## Follow-up Goal 33: bound Desktop always-allow memory

**Status:** DONE

Opened a bounded follow-up after the Goal 32 audit found that per-session
always-allow key sets could still grow without a fixed entry or key-byte
limit. The target is a fixed `256` entry limit per session and a fixed
`512 UTF-8 byte` key limit. Oversized or post-limit allow-always decisions
will permit only the current call; existing remembered keys remain automatic.

RED confirmed for both new server contracts. Without a limit, the entry-limit
contract saw **257** approval requests instead of **258**, and the oversized-key
contract saw **1** instead of **2**; Desktop focused tests recorded
**108 passed / 2 failed**. The documentation contract recorded
**23 passed / 1 failed**. The first test draft failed TypeScript compilation
because the fake run was placed at server-options level instead of under
`session`; correcting the injection produced the behavioral RED run.

**Scope completed:**

- Added a fixed `256` entry limit to each Desktop session's always-allow
  registry.
- Added a fixed `512 UTF-8 byte` limit to each remembered approval key.
- Oversized and post-limit allow-always decisions permit only the current call
  and are not remembered.
- Existing remembered keys continue to auto-approve later calls.
- Preserved approval DTOs, UI, rollback, validation, and session lifecycle
  behavior.
- Documented the always-allow memory limit in the Desktop README and v0.1.7
  candidate checklist.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **110/110**, documentation contract **24/24**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 33 slice can be committed locally as a separate commit.

## Follow-up Goal 34: bound Desktop static responses

**Status:** DONE

**Scope completed:**

- Added a fixed `1 MiB` byte limit to Desktop `/public/` static responses.
- Returned a stable JSON `413` for oversized files without echoing the path,
  contents, or raw error.
- Preserved existing missing-file and path-traversal `404` behavior.
- Documented the static-response limit in the Desktop README and v0.1.7
  candidate checklist.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server-edge-cases.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **111/111**, documentation contract **25/25**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**. The first full verify hit one MCP
concurrency timing failure; the focused MCP suite then passed **63/63** with
no implementation change, and the second full verify passed.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 34 slice can be committed locally as a separate commit.

Opened a bounded follow-up after the Goal 33 audit found that `/public/`
responses read an entire file into memory without a fixed byte limit. The
target is a fixed `1 MiB` static response limit with a stable `413`, while
preserving existing missing/path-traversal `404` behavior. RED contracts will
be added before implementation.

RED confirmed for the new server contract: without a limit, the oversized
static response returned `200`, so the test failed while parsing the HTML file
body; Desktop focused tests recorded **110 passed / 1 failed**. The
documentation contract recorded **24 passed / 1 failed**.

## Follow-up Goal 35: bound Desktop session IDs

**Status:** DONE

**Scope completed:**

- Added a fixed `96` normalized-character limit to Desktop request session
  IDs.
- Returned a stable `400` for an oversized POST chat session ID without
  starting a run or creating a registry entry.
- Preserved the default session ID and existing normalize, rename, and
  lifecycle behavior for IDs within the limit.
- Documented the session-ID length limit in the Desktop README and v0.1.7
  candidate checklist.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server-edge-cases.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **112/112**, documentation contract **26/26**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 35 slice can be committed locally as a separate commit.

## Follow-up Goal 36: bound Desktop session listings

**Status:** DONE

**Scope completed:**

- Added a fixed `256`-summary limit to Desktop `/api/sessions`.
- Retained active/default sessions first, then added disk summaries in stable
  filename order until the limit.
- Preserved normal listing, history, audit, export, rename, and DELETE behavior
  for smaller session directories.
- Documented the session-listing limit in the Desktop README and v0.1.7
  candidate checklist.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server-edge-cases.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **113/113**, documentation contract **27/27**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 36 slice can be committed locally as a separate commit.

## Follow-up Goal 37: bound Desktop history responses

**Status:** DONE

**Scope completed:**

- Added a fixed `1 MiB` response limit to Desktop session history.
- Returned a stable JSON `413` for oversized transcripts without echoing the
  transcript, path, contents, or raw error.
- Preserved message, validation, change-set, and evidence-summary behavior for
  smaller histories.
- Documented the history-response limit in the Desktop README and v0.1.7
  candidate checklist.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server-edge-cases.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals-progress.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **114/114**, documentation contract **28/28**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 37 slice can be committed locally as a separate commit.

## Follow-up Goal 28: Desktop undo-rollback stale safety

**Status:** DONE

**Scope completed:**

- Added a request ID, AbortController, signal, stale request/session guard, and
  current-request-only cleanup to Desktop undo rollback requests.
- Preserved the `/api/changesets/rollback` schema, change-set DTO rendering,
  and existing `409`/`404`/`501` state copy.
- Prevented stale rollback responses from updating undo status or marking the
  current evidence preview stale.
- Documented the stale-safe undo behavior in the Desktop README and v0.1.7
  candidate checklist.

**RED contract:**

- Added `GET / guards desktop undo rollback responses against stale sessions`
  to the Desktop UI contract.
- Added `v0.1.7 documents desktop undo rollback stale safety` to the
  documentation contract.
- First Desktop run: **1 failed / 101 passed** because undo loading lacked the
  request ID, AbortController, signal, and stale/session guards.

**Files touched:**

- `apps/desktop/public/index.html`
- `apps/desktop/tests/validation.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **102/102**, documentation contract **19/19**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 28 slice can be committed locally as a separate commit.

## Follow-up Goal 29: active Desktop session lifecycle fail-closed safety

**Status:** DONE

**Scope completed:**

- Added `inFlight` guards to `DELETE /api/sessions/<id>` and
  `POST /api/sessions/<id>/rename`.
- Active DELETE and rename requests now return a stable `409` before the
  memory file is deleted, the path is switched, or the session registry is
  changed.
- Preserved idle-session delete behavior, target-conflict handling, and
  idempotent rename behavior.
- Documented the fail-closed lifecycle behavior in the Desktop README and
  v0.1.7 candidate checklist.

**RED contract:**

- Added `DELETE an active Desktop session returns 409 without ending the chat`
  and `rename an active Desktop session returns 409 without ending the chat`
  to the Desktop server contract.
- RED proof removed the two `inFlight` guards; the focused run then recorded
  **2 failed / 102 passed**, with both active operations returning `404`
  instead of `409`. The guards were restored afterward.

**Files touched:**

- `apps/desktop/src/server.ts`
- `apps/desktop/tests/server.test.ts`
- `apps/desktop/README.md`
- `docs/release-candidate-checklist-v0.1.7-desktop.md`
- `docs/superpowers/plans/2026-09-18-overnight-ten-project-goals.md`
- `tests/documentation-contract.test.mjs`

**Verification:**

```sh
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
pnpm verify
git diff --check
```

Result: Desktop focused tests **104/104**, documentation contract **20/20**,
and `pnpm verify` completed with `all selected gates passed`. Focused counts
were runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

No tag, push, npm publish, GitHub Release, or `~/.npmrc` change was made. The
Goal 29 slice can be committed locally as a separate commit.

## Follow-up goals 28-29 final handoff snapshot

**Status:** PASSED

The branch is `main`, clean, and ahead of `origin/main` by nine local commits.
The newest commits are:

- `cacb7c5 fix: fail closed active desktop session lifecycle`
- `b0ca143 fix: guard desktop undo rollback stale responses`

Goals 28 and 29 are `DONE`. The latest full audit completed with Desktop
**104/104**, runtime-manager **15/15**, CLI **314/314**, documentation contract
**20/20**, Rust unit/doc tests **54/54**, real Rust integration **11/11**, and
`all selected gates passed`.

Release remains gated: no Git tag, no push, no npm publish, no GitHub Release,
and no `~/.npmrc` change. The next human decision is whether to push the
accumulated local commits and authorize the `v0.1.7` release review window.
