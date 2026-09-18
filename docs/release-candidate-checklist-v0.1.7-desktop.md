# `@agent_cli/cli@0.1.7` Desktop candidate checklist

**Date:** 2026-09-18

**Status:** `0.1.7` has been published to npm and released from tag `v0.1.7`.
The pre-publication technical gates and workspace-only boundary below are kept
as historical evidence.

This checklist summarizes the Desktop-facing work prepared during the
2026-09-18 overnight window. It is not release authorization.

## Candidate scope

- Desktop managed runtime status remains metadata-only and is unchanged from
  the already-published 0.1.6 work.
- Desktop managed runtime states now have fixed user-facing actions.
- Desktop status refresh exposes an `aria-busy` lifecycle.
- Desktop status loading is stale-safe: a new request aborts the previous
  status request, and responses for a stale request or session do not render.
- Desktop session history loading is stale-safe: a new request aborts the
  previous history request, and responses for a stale request or session do not
  render.
- Desktop validation rerun loading is stale-safe: a new request aborts the
  previous rerun request, and responses for a stale request or session do not
  update the UI.
- Desktop undo rollback loading is stale-safe: a new request aborts the
  previous undo request, and responses for a stale request or session do not
  update the UI.
- Deleting or renaming a Desktop session fails closed with `409` while a chat,
  validation, or cleanup request is running in that session; the active request
  and memory file remain intact.
- A Desktop DELETE storage failure releases its lifecycle lock; the response
  remains the stable `500 request failed` boundary and a later request is not
  permanently blocked by a raw filesystem failure.
- Running rollback joins the active session lifecycle: a concurrent rollback,
  deletion, or rename fails closed with `409`; the first rollback remains the
  only mutating operation.
- Desktop POST JSON endpoints reject a request body larger than `1 MiB` with
  `413` without echoing the body, path, or raw error.
- Desktop POST JSON endpoints require a JSON object body; malformed JSON
  returns `400 request body must be valid JSON`, and non-object JSON returns
  `400 request body must be a JSON object`.
- Desktop's in-memory session registry is capped at `256` total sessions; a
  new unknown chat id after that returns `429` and does not start a run.
- Desktop request session IDs are capped at `96` normalized characters; a
  longer chat ID returns `400` without starting a run or creating a registry
  entry.
- Desktop request change set IDs used by validation rerun and rollback are
  capped at `96` trimmed characters; a longer ID returns `400` before calling
  the session.
- Desktop evidence query filters for `changeSetId` and `validationId` are
  capped at `96` trimmed characters; a longer filter returns `400` without
  selecting evidence.
- Desktop approval IDs are capped at `96` characters; a longer ID returns
  `400` before looking up a pending approval.
- Desktop session listing is capped at `256` summaries; active/default sessions
  are retained first, with remaining disk summaries added in stable filename
  order.
- Desktop history responses are capped at `1 MiB`; an oversized transcript
  returns `413` without exposing the transcript, path, or contents.
- Desktop export responses are capped at `1 MiB`; an oversized Markdown
  transcript returns `413` without exposing the transcript, path, or contents.
- Desktop rename rejects an active target and holds both the source and target
  as a lifecycle lock; a concurrent rename returns `409` rather than duplicating
  the source.
- Desktop always-allow memory is capped per session at `256` keys and
  `512 bytes` per key; oversized or post-limit decisions allow only the current
  call.
- Desktop static responses under `/public/` are capped at `1 MiB`; an
  oversized response returns `413` without exposing the path or contents.
Static file serving checks the file size with `stat` before reading, so an
oversized file is rejected without loading its bytes into memory.
- Desktop `/public/` requests resolve the real request path and real public
  directory; a symlink that escapes or is broken returns `404` without target
  contents or path diagnostics.
- Desktop root static asset and `/public/` requests resolve real paths against
  the same real public directory; an escaping or broken index symlink returns
  `404`.
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
- Provider success JSON is read with a streamed bounded reader at `16 MiB`;
  an over-limit non-streaming chat response cancels its stream and rejects
  before provider schemas are parsed.
- Provider error response reads stop at `16 KiB`; an over-limit error response
  becomes stable metadata without copying the full body into memory.
- Provider streaming lines are buffered with a fixed `1 MiB` limit; an
  over-limit line cancels its stream and rejects before the unbounded buffer
  can grow.
- Filesystem reads, write/edit snapshots, edit, and patch use a fixed `16 MiB`
  whole-file read limit; an oversized file rejects before its bytes enter
  memory, and mutation targets remain unchanged.
- code-search scanner signatures skip source files above a fixed `16 MiB`
  scan limit before reading them; smaller files remain indexed.
- Managed runtime installation can pass `--runtime-release` to select the GitHub
  release carrying the manifest and archive; the cache identity remains
  `--runtime-version`, and the current default release is `0.1.6`.
- Runtime install responses use streamed bounded readers: manifests are capped
  at `1 MiB` and archives at `16 MiB`; an over-limit response cancels the
  stream and returns a structured `DOWNLOAD_FAILED` result before staging or
  extraction.
- Runtime archive extraction limits the decompressed tar payload at `32 MiB`,
  rejecting a gzip bomb with a structured `ARCHIVE_INVALID` result before it
  can allocate unbounded memory or write extraction files.
- Runtime install and remove are serialized for the same runtime version; a
  concurrent remove waits until the active installation completes.
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
- Before authorization, `@agent_cli/cli@0.1.7` was a workspace-only candidate.
- It is now published to npm and represented by the `v0.1.7` GitHub Release.
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
commits separately and coordinate before combining them. The later **release
authorization resolved this handoff**: `main` and tag `v0.1.7` were pushed, the
release workflow passed, npm `0.1.7` was published, and the workspace then
advanced to the next candidate.

The documentation contract now covers this review boundary and passes
**45/45**, including the corrected `--project-state` first-release attribution,
the refreshed provenance, and the Desktop status/history/validation/undo stale
safety plus active session lifecycle, rollback, JSON-body-limit,
session-registry-limit, always-allow-limit, static-response-limit,
public-symlink-containment, root-static-containment, session-ID-length-limit,
session-listing-limit, history-response-limit, rename-lifecycle, and
export-response-limit, JSON-object-shape, post-goal-46-preflight,
streamed-runtime-download-limit, runtime-install-download-limit,
provider-success-json-limit, provider-error-read-limit, runtime-lifecycle-lock,
delete-storage-failure-lock, and decompressed-archive-limit contracts.

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

The post-goal-25 stale-response audit reran `pnpm verify` after adding the
Desktop status request/session guard and its documentation contract. It passed
on the same worktree with Desktop **99/99**, runtime-manager **15/15**, CLI
**314/314**, documentation contracts **17/17**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

The post-goal-26 session-history audit reran `pnpm verify` after extending the
same stale-response guard to Desktop session history. It passed with Desktop
**100/100**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **17/17**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

The post-goal-27 validation-rerun audit reran `pnpm verify` after extending the
stale-response guard to Desktop validation reruns. It passed with Desktop
**101/101**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **18/18**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

The post-goal-28 undo-rollback audit reran `pnpm verify` after extending the
stale-response guard to Desktop undo requests. It passed with Desktop
**102/102**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **19/19**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

The post-goal-29 session-lifecycle audit reran `pnpm verify` after making
active Desktop session deletion and rename fail closed with `409`. It passed
with Desktop **104/104**, runtime-manager **15/15**, CLI **314/314**,
documentation contracts **20/20**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**.

The post-goal-30 rollback-lifecycle audit reran `pnpm verify` after making a
running rollback part of the same active session lifecycle. It passed with
Desktop **106/106**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **21/21**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

The post-goal-31 JSON-body-limit audit reran `pnpm verify` after bounding all
Desktop POST JSON request bodies at `1 MiB`. It passed with Desktop
**107/107**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **22/22**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

After that consolidated gate and final handoff snapshot, a read-only release
preflight refresh passed again with candidate `0.1.7`, published registry
`0.1.6`, authenticated npm identity, and five expected package files.

The post-goal-32 session-registry audit reran `pnpm verify` after capping the
Desktop in-memory registry at `256` sessions and rejecting a new unknown id
with `429`. It passed with Desktop **108/108**, runtime-manager **15/15**, CLI
**314/314**, documentation contracts **23/23**, Rust unit/doc tests **54/54**,
and real Rust integration **11/11**.

The post-goal-33 approval-memory audit reran `pnpm verify` after capping
per-session always-allow memory at `256` keys and `512 bytes` per key. It
passed with Desktop **110/110**, runtime-manager **15/15**, CLI **314/314**,
documentation contracts **24/24**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**.

The post-goal-34 static-response audit reran `pnpm verify` after capping
Desktop static responses at `1 MiB`. It passed with Desktop **111/111**,
runtime-manager **15/15**, CLI **314/314**, documentation contracts **25/25**,
Rust unit/doc tests **54/54**, and real Rust integration **11/11**. The first
full gate reported one MCP concurrency timing failure; the focused MCP suite
passed **63/63** with no implementation change, and a second full gate passed.

The post-goal-35 session-ID audit reran `pnpm verify` after rejecting chat
session IDs longer than `96` normalized characters with a stable `400`. It
passed with Desktop **112/112**, runtime-manager **15/15**, CLI **314/314**,
documentation contracts **26/26**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**.

The post-goal-36 session-listing audit reran `pnpm verify` after capping
Desktop session summaries at `256`. It passed with Desktop **113/113**,
runtime-manager **15/15**, CLI **314/314**, documentation contracts **27/27**,
Rust unit/doc tests **54/54**, and real Rust integration **11/11**.

The post-goal-37 history-response audit reran `pnpm verify` after capping
Desktop history responses at `1 MiB`. It passed with Desktop **114/114**,
runtime-manager **15/15**, CLI **314/314**, documentation contracts **28/28**,
Rust unit/doc tests **54/54**, and real Rust integration **11/11**.

The post-goal-38 rename-lifecycle audit reran `pnpm verify` after rejecting an
active rename target and locking the source/target through the async rename. It
passed with Desktop **116/116**, runtime-manager **15/15**, CLI **314/314**,
documentation contracts **29/29**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**.

The post-goal-39 export-response audit reran `pnpm verify` after capping
Desktop Markdown export responses at `1 MiB`. It passed with Desktop
**117/117**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **30/30**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

The post-goal-40 symlink-containment audit reran `pnpm verify` after resolving
both the requested `/public/` path and the public directory to real paths. It
passed with Desktop **119/119**, runtime-manager **15/15**, CLI **314/314**,
documentation contracts **31/31**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**.

The post-goal-41 root-static-containment audit reran `pnpm verify` after
applying the same real-path containment to `GET /`. It passed with Desktop
**120/120**, runtime-manager **15/15**, CLI **314/314**, documentation
contracts **32/32**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

The post-goal-42 change-set-ID audit reran `pnpm verify` after rejecting
validation-rerun and rollback IDs longer than `96` trimmed characters with a
stable `400`. The focused run passed with Desktop **122/122** and
documentation contracts **33/33**; the full gate completed with `all selected
gates passed`, runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests
**54/54**, and real Rust integration **11/11**.

The post-goal-43 evidence-query-filter audit reran `pnpm verify` after
applying the same `96` trimmed-character cap to `changeSetId` and
`validationId` filters. The focused run passed with Desktop **124/124** and
documentation contracts **34/34**; the full gate completed with `all selected
gates passed`, runtime-manager **15/15**, CLI **314/314**, Rust unit/doc tests
**54/54**, and real Rust integration **11/11**.

The post-goal-44 approval-ID audit reran `pnpm verify` after rejecting
approval IDs longer than `96` characters with a stable `400`. The focused run
passed with Desktop **125/125** and documentation contracts **35/35**; the
full gate completed with `all selected gates passed`, runtime-manager
**15/15**, CLI **314/314**, Rust unit/doc tests **54/54**, and real Rust
integration **11/11**.

The post-goal-45 JSON-object audit reran `pnpm verify` after requiring all
POST JSON bodies to be objects. The focused run passed with Desktop
**126/126** and documentation contracts **36/36**; the full gate completed
with `all selected gates passed`, runtime-manager **15/15**, CLI **314/314**,
Rust unit/doc tests **54/54**, and real Rust integration **11/11**.

The post-goal-50 delete-lock audit reran the focused gates after bounding a
DELETE storage failure to release its lifecycle lock. The focused run passed
with Desktop **127/127** and documentation contracts **41/41**. The full gate
is recorded in the consolidated evidence below.

The post-goal-51 gzip-bound audit reran the focused gates after limiting the
decompressed runtime tar payload. The focused run passed with runtime-manager
**19/19** and documentation contracts **42/42**. The full gate is recorded in
the consolidated evidence below.

The post-goal-52 streamed-download audit reran the focused gates after moving
default manifest and archive reads to fixed bounded streams. The focused run
passed with runtime-manager **21/21** and documentation contracts **43/43**.
The full gate completed with `all selected gates passed`, CLI **314/314**,
Desktop **127/127**, Rust unit/doc tests **54/54**, and real Rust integration
**11/11**.

The post-goal-53 provider-response audit reran the focused gates after adding
the streamed `16 MiB` provider success JSON limit. The focused run passed with
model **60/60** and documentation contracts **44/44**. The full gate completed
with `all selected gates passed`.

The post-goal-54 provider-error audit reran the focused gates after adding the
streamed `16 KiB` provider error read limit. The focused run passed with model
**61/61** and documentation contracts **45/45**. The full gate completed with
`all selected gates passed`.

## Verification completed

```sh
pnpm --filter @dev-agent/desktop run test
```

Result: **127 tests passed, 0 failed.** The latest regression contracts cover
the legacy-session `unknown` executor fallback, status-panel executor rendering,
rollback joining the active session lifecycle, the fixed JSON request-body
limit and JSON-object shape, the fixed session registry count limit, bounded
always-allow memory, and
the fixed static-response size, session-ID length, change-set-ID length,
evidence query filters, approval IDs, session-listing size, public symlink
containment, root static containment, history-response size, export-response
size, active rename target, and concurrent rename limits.

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

After the post-goal-45 JSON-object audit, a read-only post-goal-46 preflight
refresh also passed with candidate `0.1.7`, published registry `0.1.6`, an
authenticated npm identity, and five expected package files. It remains
readiness evidence only and does not authorize publishing.

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


## Historical gates before the release decision

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
- Maintainer review and explicit release authorization (completed by the user)

## Publication evidence

- `pnpm release:preflight` passed with candidate `0.1.7`, published registry
  `0.1.6`, authenticated npm identity, and five package files.
- `pnpm release:publish -- --publish` ran after the user's explicit release
  authorization. The initial registry query briefly lagged, then confirmed
  `0.1.7` as npm `latest`.
- Tag `v0.1.7` was created and pushed. Release run
  `35338225586` completed successfully and created the
  [GitHub Release](https://github.com/LJH-snow/dev-agent/releases/tag/v0.1.7).

## Historical explicit non-goals

## Pre-publication boundary

Before release authorization, this slice was workspace-only and the non-goals
explicitly included no npm publish.
- No Git tag, push, npm publish, or GitHub Release was performed during the
  pre-authorization window.
- Do not modify `~/.npmrc`.
- Do not infer release readiness from the registry or UI alone.

## Resolved human decisions

1. The committed CLI/runtime and Desktop hardening work was included in the
   `0.1.7` candidate.
2. SemVer and tag are `0.1.7` / `v0.1.7`; the npm CLI package remains the user
   surface and Desktop is not published separately.
3. The release window was explicitly authorized by the user; npm publish, tag,
   push, and the GitHub Release workflow completed successfully.
