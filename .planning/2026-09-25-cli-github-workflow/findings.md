# Findings

- The CLI already owns a bounded `Executor`; the workflow can reuse it while
  passing argv arrays, a cwd, an abort signal, timeouts, and output limits.
- Mutating operations must stay explicit: branch creation, commit, push, and PR
  creation ask for confirmation. Branch status is read-only.
- Commits run `git diff --check` and refuse secret-looking paths before asking
  for confirmation. `--all` is the only path that stages the complete worktree.
- Push and PR require a clean worktree. PR creation also requires `gh auth status`
  and an upstream branch. Authentication output is never surfaced.
- The current repository contains unrelated uncommitted Desktop/settings work;
  staging must remain file-scoped.
