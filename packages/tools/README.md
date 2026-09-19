# @dev-agent/tools

Tool registry and built-in tools such as filesystem, shell, git, and search.

Implemented in phase 1:

- `FilesystemTool` - read, write, list, stat, and mkdir
- `ShellTool` - run local commands through the executor
- `GitTool` - run git commands through the executor
- `SearchTool` - search code with ripgrep
- `CodeSearchTool` - scan TypeScript/JavaScript files and return ranked,
  kind-filterable symbol matches with `score`, `reasons`, `signature`, and
  container metadata
- `createDefaultTools` - creates the default tool set from one executor

`FilesystemTool` reads, writes, edits, lists, stats, and creates directories.
`read` takes an optional `offset` (1-based) and `limit` (default 2000 lines) and
answers with `{ content, startLine, endLine, totalLines, truncated }`, so large
files can be read in slices. `edit` replaces `oldText` with `newText` only when
that snippet appears exactly once; a missing or ambiguous match is an error the
model can correct instead of a silent mis-edit. The same workspace rules apply
to `edit` as to `write`: the approval policy denies targets outside the working
directory.

`patch` takes several `{ oldText, newText }` hunks and applies them to an
in-memory copy: every hunk must match exactly once and hunks must not overlap,
otherwise nothing is written. The file is saved once at the end, so a failing
patch leaves it byte-for-byte unchanged.

## Reviewed filesystem changes

`filesystem` also supports a read-only `preview` action for turning one or more
mutations into a reviewable change set:

```json
{
  "action": "preview",
  "changes": [
    {
      "action": "edit",
      "path": "src/app.ts",
      "oldText": "const port = 3000;",
      "newText": "const port = 4000;"
    },
    { "action": "mkdir", "path": "tmp/reports" }
  ]
}
```

The result is a `ChangeSetReview` with a stable `changeSetId`, one entry per
path, before/after SHA-256 hashes, existence and file-kind information, a
unified diff, and aggregate addition/deletion counts. Preview never writes to
the workspace. Paths in one preview must be unique; `write`, `edit`, `patch`,
and `mkdir` can be grouped into the same all-or-nothing change set.

`FilesystemTool.prepareChangeSet()` accepts either a single mutation input or a
`preview` input and returns both the review and the `{ action: "apply",
changeSetId }` input to execute after approval. `apply` rechecks every recorded
preimage before writing, creates parent directories as needed, and uses
same-directory temporary files plus rename for atomic file replacement. If a
preimage, write, or directory operation fails, the change set is not left
partially applied.

After a successful apply, `rollback` accepts the same `changeSetId` only while
all postimages still match. It restores the original bytes and modes, removes
new files, and cleans up directories created by the change set. An external edit
causes a guarded conflict instead of overwriting the newer content. The tool
keeps a bounded in-memory store of recent change sets, so callers should apply
or roll back a preview with the same `FilesystemTool` instance. A change set
restored from persisted evidence is different: it contains only postimage
metadata and can be used as a read-only validation guard, but `rollback` rejects
it because no before-image is available.

### Persisted applied evidence

`FilesystemTool.restoreAppliedChangeSet(record, context)` and
`restoreAppliedChangeSets(records, context)` restore only records whose state is
`applied` and whose session id and canonical working directory match the current
context. Before a record is accepted, the tool validates safe relative paths,
duplicate/ancestor-symlink boundaries, file kinds, existence, and every
postimage SHA-256 hash. It never reads a command, shell, diff, or file content
from the record and never creates or repairs files during restore.

The batch API returns one `restored` or `blocked` result per record. A blocked
record is safe to report to the caller and leaves the workspace unchanged. A
restored record can be used for an explicit validation rerun; the rerun checks
the postimage before and after validation and does not auto-rollback. The
persisted contract is intentionally minimal so old memory files without a
`changeSets` field remain readable and so evidence stays outside ordinary model
messages.


## Change-set validation

After `review-writes` successfully applies a change set, the shared validation
planner can derive a small, deterministic set of checks from the changed paths:

- TypeScript source under `packages/<name>` or `apps/<name>` plans
  `pnpm --filter @dev-agent/<name> typecheck` and `test`. Test-only changes
  plan only the package test.
- `runtime/rust` changes plan `cargo fmt --check`, `cargo clippy --all-targets
  -- -D warnings`, and `cargo test` from the Rust runtime directory.
- Documentation/configuration changes in a Git checkout plan
  `git diff --check -- <changed paths>`. Non-Git workspaces do not invoke Git.
- Unknown or unchanged paths return `skipped`; duplicate or escaping paths
  return `blocked` before any command is run.

`deriveValidationPlan(review, context)` emits structured commands with an
executable, argument array, working directory, and timeout. Its `policy` is
limited to `fast`, `default`, or `strict`: fast keeps only the quickest relevant
checks, default is the changed-path baseline, and strict adds fixed bounded
workspace checks for package or workspace changes. It never copies a
model-provided shell string or diff text into a command. `parseValidationPolicy`
and `normalizeValidationPolicySettings` reject unknown policies and validation
config fields such as `executable`, `shell`, `args`, `cwd`, `diff`, or custom
check definitions. Per-check timeout overrides must be positive integers below
the code-defined cap (fast: 60s typecheck / 120s tests / 60s Rust; default:
120s / 180s / 300s; diff checks are capped at 30s). Strict workspace checks use
fixed 300s typecheck and 600s test caps.
`createValidationRunner(executor)` runs the plan sequentially through the same
executor used by the tools, keeps output bounded (64 KiB by default), forwards
the outer abort signal, and marks checks after the first failure as `skipped`.
The result status is `passed`, `failed`, `skipped`, or `blocked`; a failed or
blocked validation describes what happened but never rolls back the already
applied change set. Callers can still use the guarded `rollback` operation when
they explicitly want to undo it.

## Evidence lifecycle

`AgentMemory` keeps validation attempts and minimal applied change-set evidence
separate from the model message context. `FileMemory` and `InMemoryMemory` use
default retention limits of 100 validation records and 100 change-set records.
When the change-set soft limit is reached, records in `applied` state are always
protected because they remain usable as postimage validation guards; only
non-active (`rolled-back`) records can be removed.

`pruneEvidence({ maxValidations, maxChangeSets, removeRolledBack })` is an
explicit, idempotent, metadata-only operation. It returns validation/change-set
removal counts, the number of protected applied guards, and remaining counts.
`markChangeSetRolledBack(changeSetId)` is only called after a guarded filesystem
rollback succeeds; it never stores or reconstructs a before-image.
`evidenceSummary()` exposes counts, effective limits, and the reason applied
guards remain protected. Old `version: 1` memory files without validation or
change-set fields remain readable with empty evidence counts.

For operator/audit consumers, `createEvidenceAuditExport()` builds a separate
versioned projection instead of serializing the internal evidence DTOs. It keeps
only stable identities, statuses, timings, hashes, relative paths, counts, and
retention metadata. It excludes executable commands and arguments, cwd, output,
errors, reasons, diffs, patches, file bytes, before-images, and absolute
working-directory paths; the projection is read-only and does not inspect the
workspace.

Built-in tools accept an optional context object with `sessionId` and
`workingDirectory`. Shell/git/search commands run in that working directory,
and filesystem and code-search paths are resolved relative to it. `code-search`
also accepts `kind` and `limit` inputs to keep agent queries focused. Its
`search` mode and query-based `definition` mode use the shared symbol index;
position-based `references` and `definition` use `file`, `line`, and optional
`column`. Omit `path` to scan the current project working directory. For
source review, `filesystem read` accepts `lineNumbers: true` to prefix the
returned content with exact source line numbers without changing the default
raw-content response.

`filesystem read` counts lines the way an editor does: a trailing newline
terminates the last line instead of starting an empty one, so `"a\nb\n"` is two
lines and an empty file is zero. `totalLines` is what the caller pages with, and
an `offset` past the end answers an empty range pinned just past the last line
(`startLine: totalLines + 1`, `endLine: totalLines`) rather than echoing the
requested offset.

`CodeSearchTool` caches its scan per root directory in the tool instance. A
repeated search re-reads only the files whose size or mtime changed, drops
deleted files from the index, and exposes `getCacheStats()` (`hits`, `misses`,
`rescanned`, `loadedFromDisk`, `persisted`) for diagnostics. When the in-process
cache is empty it first tries `<root>/.dev-agent/index.json` — the file written
by `dev-agent --index` — and re-reads only the files whose stored signature no
longer matches. If that scan changed anything, the refreshed index is written
back to the same file (only when it already exists, and a write failure is
ignored). A missing index falls back to a full scan and is never created by a
search; an index that exists but cannot be parsed is replaced with a fresh one
after that scan, so the next process starts from a valid cache.

The scanned file set matches `dev-agent --index`: `.ts`/`.tsx`/`.mts`/`.cts`,
`.js`/`.jsx`/`.mjs`/`.cjs`, `.py`, and `.rs`, up to depth 8, skipping
`node_modules`, `dist`, `.git`, `.next`, `.cache`, and `.dev-agent`. Symbol
search covers all four languages; `references` and `definition` stay
TypeScript/JavaScript because they use the TypeScript language service.
