# Changes Center 1.0

**Date:** 2026-09-24
**Objective:** Make the existing Desktop task-workspace diff review visibly useful as an IDE-like Changes Center without weakening the existing worktree, approval, or metadata boundaries.

## Scope

- [x] Add a visible Changes Center summary with file/change counts and review-comment count.
- [x] Add bounded file search and status badges for the existing diff file list.
- [x] Add safe Unified/Split diff view switching for selected task files.
- [x] Preserve text-only rendering, path bounds, stale-session guards, and existing merge/cleanup confirmation behavior.
- [x] Add focused unit/contract coverage and isolated browser acceptance.
- [x] Run Desktop tests/build/typecheck, release gate if the touched surface is broad, review the diff, commit, and push.

## Explicit non-goals

- No remote GitHub mutation, PR creation, push, merge, or workflow dispatch.
- No arbitrary file write or staging endpoint from the browser.
- No syntax-highlighting dependency or unbounded diff parser.
- No raw command, credential, source path outside the bounded task diff, or secret in telemetry.

## Acceptance evidence

- The selected isolated task displays a summary such as `3 files · +8 −2`.
- Searching the file list only shows bounded matching paths and never uses `innerHTML`.
- Unified and split views render the same bounded patch without leaking payloads.
- Existing review comments, merge, cleanup, and stale-session behavior remain green.
- Browser evidence uses a temporary Git repository, not the real project worktree.


## 2026-09-24 — implementation closure

- Added bounded summary metrics, local file search, status badges, and a
  Unified/Split view toggle over the existing bounded diff payload.
- Preserved `textContent`-only rendering, existing line anchors for review
  comments, stale-session request guards, and merge/cleanup confirmation gates.
- Added helper and contract coverage. Desktop suite is green at **236/236**.
- Isolated browser acceptance used a temporary Git repository and confirmed the
  summary (`2 个文件 · +2 · −1`), split view, status badges, and `README.md`
  file filtering. No real project worktree or remote mutation was used.
