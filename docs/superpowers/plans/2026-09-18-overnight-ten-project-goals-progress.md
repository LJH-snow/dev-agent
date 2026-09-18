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
