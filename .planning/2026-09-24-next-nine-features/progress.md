# Progress — next nine roadmap features

## 2026-09-24 — baseline and plan

- Revalidated the current worktree, roadmap, and nearest unfinished Desktop workflow plan.
- Confirmed the published roadmap has no canonical numbered next-nine list; selected nine concrete bounded capabilities from the unfinished Desktop workflow direction rather than inventing a new product area.
- Existing task worktree/diff/terminal/loopback preview code is retained; implementation will close gaps with focused contracts.
- No source changes made yet in this phase; next action is RED coverage for review/terminal gaps.

## Baseline verification

- `pnpm --filter @dev-agent/desktop test -- --test-name-pattern='task-terminal|task-workspaces'` rebuilt the package and passed the complete serialized Desktop suite: **217/217**.
- The existing terminal cursor-expiry recovery is already implemented in `task-terminal-ui.js`; feature 3 will add an explicit user-controlled reconnect/rehydrate action rather than duplicate that behavior.

## Phase 1–3 implementation progress

Implemented the nine bounded capabilities in the current Desktop workflow surface:

1. Review comments now use a versioned, per-session `sessionStorage` record with 64-item/32 KiB bounds, control-character sanitization, deterministic formatting, and fail-closed storage handling.
2. Diff file controls expose selected-file metadata and keyboard navigation; diff group tabs support arrow/Home/End navigation with roving tabindex.
3. Terminal selection is remembered per session; an explicit Reconnect action rehydrates the bounded cursor snapshot and reports cursor gaps instead of silently replacing the view.
4. Terminal output now has local Clear view and bounded redacted Export output actions; clearing never stops or mutates the process.
5. Preview has explicit Clear, loading, loaded, and error states; the existing loopback HTTP(S)+explicit-port+iframe sandbox boundary remains unchanged.
6. Terminal completion invokes a workspace refresh callback so Git metadata is not left stale after commands finish.
7. Added an opt-in GitHub capability probe. It never returns credentials, captures no command output, and always reports `mutationAllowed: false`.
8. Added bounded workbench metadata projection for project/user Skills and private CLI background-job records; paths, instructions, prompts, provider/model values, and output are excluded.
9. Added a loopback-only read-only monitoring endpoint and UI status surface; it exposes bounded active-session/approval counts and explicitly has no approval or mutation route.

Focused verification so far:

- Desktop build/typecheck passes after the implementation.
- New capability tests pass **4/4**.
- Desktop focused task/workspace/capability run reached **221/221** before the later typing hardening; it will be rerun after the final UI/source fixes.

## 2026-09-24 — phases 1–3 implementation closure

- Review and terminal slice is implemented in the existing Desktop task
  surfaces: review comments are session-isolated and bounded; diff groups and
  files are keyboard-addressable with explicit selected-file state; terminal
  cursor gaps expose a rehydration message; reconnect, local clear, and bounded
  redacted export controls are explicit.
- Preview/workspace slice is implemented: loopback preview URLs require an
  explicit port, loading/error/loaded states are visible, clear is explicit,
  and task workspace metadata refreshes after terminal completion without
  exposing worktree paths.
- Metadata-only capability slice is implemented: GitHub is explicit opt-in,
  probes only `gh auth status`, never grants mutation, skills/jobs return
  bounded metadata without instructions or paths, and monitoring is a
  loopback, read-only snapshot with `canApprove: false` and `canMutate: false`.
- Focused Desktop regressions cover these boundaries, and the current serial
  Desktop suite passes **222/222**. The full TypeScript gate later confirms
  workspace build/typecheck, package smoke, documentation **60/60**, and native
  Desktop **2/2**.

## 2026-09-24 — browser acceptance and final gates

- Browser acceptance found and fixed an initialization race: the first-load
  `loadSessions()` request could resolve after the initial panel refresh calls,
  leaving terminal history and metadata-only capabilities blank after a page
  reload. Initialization now awaits session loading and the session view before
  refreshing the workspace, terminal, and capabilities panels.
- Added a regression assertion for that startup ordering and added explicit
  dark/light `--assistant-bg` tokens so the newly visible capability panel and
  existing runtime panel retain readable contrast in dark mode.
- Playwright acceptance at `http://127.0.0.1:4319/` passed:
  - capability Refresh reaches the metadata-only final state and shows
    GitHub `Opt-in required`, monitoring `0 active · 0 approvals`, and no
    detected skills/jobs;
  - a safe `printf 'browser-qa\\n'` command reaches `Finished (exit 0)` and
    renders `browser-qa`;
  - Clear view removes only the local display, Reconnect rehydrates the same
    retained output, and Export output downloads a bounded log containing the
    command/output;
  - an external preview URL is rejected, an explicit-port loopback preview at
    `http://127.0.0.1:4320/` reaches `loaded`, and Clear preview returns to the
    hidden/idle state;
  - after reload, terminal history remains selectable and capabilities finish
    loading; normal-page console inspection reports **0 errors / 0 warnings**.
- Visual evidence saved under `output/playwright/`:
  - `desktop-nine-features-final.png`
  - `desktop-nine-features-inspector-final.png`
- Final verification passed:
  - Desktop suite: **222/222**;
  - `pnpm --filter @dev-agent/desktop build` and `typecheck`;
  - `git diff --check`;
  - root `pnpm typecheck` and `pnpm build`;
  - `HOME=/private/tmp/dev-agent-test-home DEV_AGENT_PACKAGE_SMOKE_NPM_CACHE=/Users/Admin/.npm pnpm verify:typescript --report`, including CLI **629/629**, Desktop **222/222**, package smoke, documentation **60/60**, and native Desktop contracts **2/2**.
- No commit, tag, publish, or push was performed.
