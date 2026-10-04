# Progress — GitHub Release v0.2.1

## 2026-10-05 — release and asset verification

- Current branch `codex/desktop-cli-workbench` pointed at the already-pushed
  0.2.1 release commit; no existing remote `v0.2.1` tag was found.
- Created and pushed annotated tag `v0.2.1` to `origin`.
- Release workflow `37215824488` completed successfully. Build jobs passed for:
  `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, and
  `aarch64-unknown-linux-gnu`; CLI package and manifest jobs also passed.
- GitHub Release is formal, non-draft, and non-prerelease:
  <https://github.com/LJH-snow/dev-agent/releases/tag/v0.2.1>.
  It contains the CLI tarball, four runtime archives, four `.sha256` sidecars,
  and `dev-agent-runtime-manifest.json`.
- Published manifest reports `releaseTag=v0.2.1`, `releaseVersion=0.2.1`, four
  supported targets, and runtime identity `0.2.0` remains a separate contract.
- Independent downloads verified all four archive SHA-256 sidecars.
- Registry clean-install smoke verified package version `0.2.1`, non-empty
  `--tools`, JSON `--doctor --check-update`, and managed runtime lifecycle with
  `--runtime-version 0.2.0 --runtime-release 0.2.1`: install, doctor state
  `installed`/source `runtime`, and remove.
- The first runtime download attempt returned only a bounded `DOWNLOAD_FAILED`
  classification; the next attempt succeeded. No raw network error or path was
  persisted.
- Updated current README, CLI README, changelog, release guide, roadmap status,
  and documentation-contract expectations. Historical release entries remain
  unchanged.

## Final verification

- Documentation contract: 60/60 pass.
- Release focused tests (`release-workflow`, `release-version`, and
  `npm-release-preflight`): 22/22 pass.
- `git diff --check`: pass.
- Only the current release documentation, documentation-contract test, and this
  ledger are in scope for the follow-up commit. Hook state, `.zcode/`, and
  unrelated worktree changes remain unstaged.
