# Findings

- `startCollaborativeExecution` plans tasks before calling
  `createCollaborativeExecution`; normalize the exact graph with
  `createCollaborationTaskGraph` there, then collect scopes before constructing
  the execution handle.
- `CollaborativeExecutionOptions.toolAllowlistForTask` is currently
  synchronous. Keeping it synchronous avoids changing Agent Core: the CLI can
  collect all grants first and provide an immutable task-ID-to-scope snapshot.
- `createCollaborativeExecution` validates every supplied scope before its
  execution promise creates workspaces. Its snapshot `ToolCollection` is used
  for both model schema generation and runtime lookup.
- CLI has two `runTeamExecution` paths (line-oriented and Ink); both must pass
  the same authorization callback. `:team retry` also flows through them.
- `InkUiController.askApproval` is the shared Ink prompt mechanism. It needs an
  AbortSignal-aware settlement path so Ctrl-C cannot leave an authorization
  waiter active. The readline path already closes on SIGINT; its ask wrapper
  must also settle when the scheduler signal aborts.
- The line-oriented and Ink `runTeamExecution` implementations both need the
  same authorization callback, and `:team retry` must ask again. Empty input
  cancels; `none` is the explicit empty-scope grant.
- Authorization requests should show the normalized task instructions and
  exact candidate tool names/descriptions. The user response is bound directly
  to the task currently displayed; it is not inferred from planner fields.
- `collaboration.toolAllowlist` is an optional caller-owned ceiling. Validate
  configured names against the actual registry before planning; never silently
  drop an invalid ceiling entry while building UI choices.
- Current worktree has extensive pre-existing changes. Do not reset or clean.
- Agent Core already has a direct adversarial regression: the model attempts an
  unadvertised tool, the schema remains restricted on every turn, and that
  tool's execute callback remains untouched. Keep this focused test and rerun it
  rather than adding a duplicate.
- The CLI e2e suite covers an explicit scope-review decline but not SIGINT while
  the prompt is waiting. The readline SIGINT handler aborts the scheduled task
  and closes the reader; add a process-level test that waits for the scope
  prompt, sends SIGINT, then checks there were no worker requests or additional
  Git worktrees.
- Include the deprecated `reviewTaskToolScopes: false` value in the interactive
  authorization e2e config so the mandatory prompt is demonstrated through the
  actual CLI path.
- CLI docs explain mandatory review but do not yet state that the deprecated
  `collaboration.reviewTaskToolScopes` setting is accepted and ignored.
