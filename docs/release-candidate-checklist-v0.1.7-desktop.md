# `@agent_cli/cli@0.1.7` Desktop candidate checklist

**Date:** 2026-09-18

**Status:** workspace-only candidate; technical gates recorded; no Git tag; no
push; no npm publish; no GitHub Release.

This checklist summarizes the Desktop-facing work prepared during the
2026-09-18 overnight window. It is not release authorization.

## Candidate scope

- Desktop managed runtime status remains metadata-only and is unchanged from
  the already-published 0.1.6 work.
- Desktop managed runtime states now have fixed user-facing actions.
- Desktop status refresh exposes an `aria-busy` lifecycle.
- Desktop session summaries expose safe message/validation/change-set/protected
  guard counts without paths or raw evidence.
- Evidence preview failures distinguish `404`, `413`, and `400` without
  exposing internals.
- Validation cards distinguish rerun `409`, `404`, and `501` outcomes.
- Approval review behavior is preserved: real diffs, empty diffs, denial, hash
  guard, timeout, and disconnect behavior are already covered by tests.
- `/api/status` may include a safe workspace label and safe MCP configured/
  connected counts.
- `/api/status` renders the allowlisted executor mode in the Desktop status
  panel and falls back to `unknown` when a legacy session has no executor
  metadata.
- Uncaught Desktop server failures return a stable `500` `request failed`
  response instead of exposing raw diagnostics, paths, or secrets.
- Evidence preview explains that applied change-set guards stay for validation.
- Managed runtime installation can pass `--runtime-release` to select the GitHub
  release carrying the manifest and archive; the cache identity remains
  `--runtime-version`, and the current default release is `0.1.6`.
- CLI doctor distinguishes the selected runtime probe identity
  (`runtimeVersion`/`protocolVersion`) from the managed cache state
  (`state`/`target`). A selected binary's contract mismatch remains visible in
  the `rust runtime` check and increments the summary fail count even when the
  managed cache state is `installed`.
- `pnpm runtime:smoke` is an additional local package-install and isolated
  runtime lifecycle verification path. In proxy-configured environments, run
  `NODE_USE_ENV_PROXY=1 pnpm runtime:smoke -- --skip-build` after the workspace
  build.

## Released versus workspace-only

- `@agent_cli/cli@0.1.6` is the published npm version and npm `latest`.
- `@agent_cli/cli@0.1.7` remains a workspace-only candidate.
- The v0.1.6 GitHub Release already contains the four platform runtime
  archives, checksums, fixed manifest, and CLI tarball.
- Desktop changes prepared in this window are not published and should not be
  inferred from the registry package.

## Technical readiness boundary

The checklist records evidence for every technical gate listed below, but the
candidate is not release-ready until a maintainer reviews the current candidate
commits and explicitly authorizes the release window. Technical readiness does
not imply or authorize tagging, pushing, npm publishing, or creating a GitHub
Release.

## Candidate review handoff

The **runtime-release slice has been committed and pushed** by its owning
window as `69c8a9f`. It contains the CLI `--runtime-release` flag, the doctor
managed-state merge, runtime-manager manifest-release support and tests, the
runtime install smoke script, and matching CLI/npm documentation.

A separate **Desktop hardening slice has been committed locally** as
`9c6592c`: the metadata-only status/session/MCP/workspace additions, evidence
and validation UX guards, their focused tests, the CLI runtime-release
regression test, the 2026-09-18 plan/progress evidence, and the documentation
contract/index updates.

No shared staging index remains for these slices. Maintainers review these
commits separately and coordinate before combining them. Until that maintainer
decision is made, keep the candidate workspace-only: no additional push, tag,
npm publish, or GitHub Release. The release preflight and isolated runtime
smoke remain technical readiness evidence, not release authorization.

The documentation contract now covers this review boundary and passes
**16/16**, including the corrected `--project-state` first-release attribution
and the refreshed provenance.

## Consolidated gate

```sh
pnpm verify
```

Result: **all selected gates passed** in the same final worktree state. This
fixed order covered the TypeScript build/typecheck/test package gates, package
and documentation contracts, Rust format/clippy and unit/doc tests, and real
Rust integration. It did not authorize a release.

The post-runtime-release-contract final audit reran the same command after the
two focused CLI regression contracts were added. It passed in the same
worktree with CLI tests at **314/314** and documentation contracts at
**13/13**.

The post-v65 executor-display audit reran `pnpm verify` after adding the two
Desktop regression contracts. It passed on the same worktree with Desktop
**97/97**, CLI **314/314**, documentation contracts **13/13**, Rust unit/doc
tests **54/54**, and real Rust integration **11/11**.

The post-goal-21 doctor-semantics audit reran `pnpm verify` after clarifying the
managed-state merge documentation. It passed on the same worktree with Desktop
**97/97**, runtime-manager **15/15**, CLI **314/314**, documentation contracts
**15/15**, Rust unit/doc tests **54/54**, and real Rust integration **11/11**.

The post-goal-22 release-history audit reran `pnpm verify` after correcting the
`--project-state` attribution to `0.1.3`. It passed on the same worktree with
Desktop **97/97**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **16/16**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

The post-goal-23 server-failure audit reran `pnpm verify` after adding the
stable `500` `request failed` boundary. It passed on the same worktree with
Desktop **98/98**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **16/16**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

After that consolidated gate and final handoff snapshot, a read-only release
preflight refresh passed again with candidate `0.1.7`, published registry
`0.1.6`, authenticated npm identity, and five expected package files.

## Verification completed

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **97 tests passed, 0 failed.** The final two added regression contracts
cover the legacy-session `unknown` executor fallback and the status panel's
rendering of the allowlisted executor mode.

```sh
pnpm build
pnpm verify:typescript
```

Result: **all selected TypeScript gates passed.** Desktop tests passed **97/97**
after the executor-mode display audit, runtime-manager tests passed **15/15**,
and CLI tests passed **314/314** as part of the final
post-runtime-release-contract gate. The documentation contract also passed
**13/13** after runtime-release, proxy-aware smoke, and candidate-index
documentation were added.

```sh
pnpm verify:rust
```

Result: **all selected Rust gates passed.** Rust unit and doc tests completed
**54/54** across the runtime library and executor binary.

```sh
pnpm verify:integration
```

Result: **11 tests passed, 0 failed.** The real Rust integration suite verified
Starlark policy enforcement, readonly-path denial, network boundary behavior,
profile timeout/resource/output limits, aborted requests, cancellation, and
concurrency.

```sh
pnpm release:preflight
```

Result: **preflight passed.** Candidate `0.1.7` metadata matched the checked-in
release state, the authenticated npm identity could read the registry,
`0.1.6` matched the published registry version, and the candidate tarball
allowlist contained the expected five files. This is readiness evidence only;
`nextAction: publish_candidate` does not authorize publishing.

After the post-goal-19 `pnpm verify`, a read-only preflight refresh also passed
with the same candidate/registry/auth/artifact metadata.

After the post-goal-22 release-history audit, a read-only preflight refresh
again passed with candidate `0.1.7`, published registry `0.1.6`, authenticated
npm identity, and five expected package files.

A post-goal-19 runtime smoke refresh also passed with the proxy-aware command,
reconfirming the isolated CLI package and runtime-release install lifecycle
against the known `v0.1.6` release assets.

```sh
pnpm runtime:smoke
```

First result: failed with stable `DOWNLOAD_FAILED` metadata while Node fetch
bypassed the configured proxy. Retrying with a different strategy passed:

```sh
NODE_USE_ENV_PROXY=1 pnpm runtime:smoke -- --skip-build
```

Result: **Runtime install smoke passed.** This verifies the local package
installation and isolated runtime lifecycle against the known release. It does
not authorize publishing.


## Remaining gates before any release decision

- `pnpm build`
- `pnpm verify:typescript`
- `pnpm --filter @dev-agent/desktop run test`
- `pnpm --filter @dev-agent/runtime-manager run test`
- `pnpm --filter @agent_cli/cli run test`
- `node --test tests/documentation-contract.test.mjs`
- `NODE_USE_ENV_PROXY=1 pnpm runtime:smoke -- --skip-build`
- `pnpm verify:rust`
- `pnpm verify:integration`
- `pnpm release:preflight`
- `git diff --check`
- Maintainer review and explicit release authorization

## Explicit non-goals

- Do not create a Git tag.
- Do not push.
- Do not publish to npm.
- Do not create a GitHub Release.
- Do not modify `~/.npmrc`.
- Do not infer release readiness from the registry or UI alone.

## Human decisions required

1. Decide whether the 0.1.7 candidate should include the committed CLI/runtime
   release work or defer it to a later candidate.
2. Confirm the final SemVer/tag and whether the desktop surface should be part
   of the npm CLI package or a separate desktop distribution.
3. Approve the release window and rollback owner before any tag or publish.
