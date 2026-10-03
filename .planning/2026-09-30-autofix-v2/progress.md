# Desktop Autofix v2

## Approved scope

- Add RED tests before implementing a bounded repair loop.
- Allow one through three reviewed attempts, including the initial preview.
- Reuse Review → Apply → trusted Revalidate, with no model call during apply.
- Fail closed on cancellation, timeout, stale validation, lost review authority,
  managed-worktree identity changes, and filesystem apply conflicts.
- Preserve Execution Center work in progress; no repository reset, stash, clean,
  commit, push, or UI replacement.

## Implementation

- `apps/desktop/src/autofix.ts`: fixed attempt budget, validation identity binding,
  repair-loop transitions, and abort-aware bounded deadlines.
- `apps/desktop/src/server.ts`: lock before asynchronous target lookup; bind
  pending Autofix reviews to their session-owned loop; verify managed worktrees
  before planning/apply; permit retry only after matching failed revalidation.
- Apply consumes the stored review, retains existing filesystem guards and trusted
  validation, and never re-prompts the model. Each retry is user-triggered and
  requires another review/apply, not automatic mutation.
- Late events after cancellation/deadline cannot register a new review or update
  its authority. Missing, blocked, passed, or foreign validation stops the loop.
- Restart/rename does not revive Autofix review authority; ordinary plan review
  cancellation and rename behavior remains intact.
- Integrate concurrent history persistence before SSE end rather than holding the
  completed session lock or writing run history after the client sees EOF.
- Keep execution history across Desktop server shutdown; only explicit session
  deletion clears persisted history, and it waits for the bounded store write.
- `apps/desktop/tests/autofix-loop.test.ts`: 17 tests covering budgets, stage
  ordering, target/apply concurrency, stale evidence, cancellation, deadlines,
  discarded/conflicting reviews, restart, worktree identity, and preservation of
  tracked and untracked fixture WIP.
- `apps/desktop/README.md`: endpoint budget and lifecycle/deadline contracts.

## Verification

- Initial missing API tests were observed RED before implementation.
- Cancellation status regression was observed RED (`failed` instead of `aborted`).
- Cleaned-worktree regression was observed RED (apply returned 200 instead of 409).
- Build, typecheck, test compilation, and `git diff --check` pass.
- The first full suite invocation used the repository root incorrectly: five
  server-edge fixture tests required the Desktop package working directory.
- The corrected full invocation passed 389/390 tests; the sole remaining error
  was the existing usage fixture's `.dev-agent` directory cleanup (`ENOTEMPTY`).
  A focused rerun reproduced that cleanup failure during concurrent Execution
  History lifecycle changes; no assertions were weakened or tests skipped.
- Final full-suite verification ran serially from `apps/desktop` with a temporary
  HOME and session directory: **390/391 passed**, with all **17/17 Autofix v2**
  tests passing. Ordinary plan workflow and Execution History tests also passed.
- Root cause was confirmed with a RED regression: server shutdown reused the
  session-deletion helper, which asynchronously cleared persistent Execution
  History while usage tests removed their temporary HOME. Runtime-only shutdown
  cleanup no longer deletes history; explicit session deletion does.
- Focused post-fix validation passed **18/18** across Execution History and
  ChatSession end-to-end suites, including the usage fixture and shutdown/history
  persistence regressions.
- Post-fix full-suite verification passed **392/392** from `apps/desktop`, using
  a temporary HOME/session directory and serial test execution. Output:
  `/private/tmp/dev-agent-autofix-v2-final2.log`.

## Safety boundaries

- This slice does not persist executable Autofix authorization. A new server
  cannot apply an old in-memory review, and a new repair chain requires a new
  user-triggered preview.
- Deadlines abort the supplied signal and stop review/event acceptance; they do
  not claim to forcibly terminate arbitrary non-cooperating injected workers.
- Other-window changes to Execution Center UI, run-state, history store/tests,
  and shared server history hooks remain preserved.
