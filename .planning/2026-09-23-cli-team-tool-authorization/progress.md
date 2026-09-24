# Progress

## 2026-09-23

- Confirmed the existing global collaboration ceiling and Agent Core task
  allowlist are present in the working tree.
- Confirmed the authorization callback can be placed after normalized planning
  and before `createCollaborativeExecution`, without creating workspaces early.
- Identified both interactive execution paths and the existing approval prompt
  controller that can collect explicit per-task scopes.
- Confirmed `createCollaborationTaskGraph` is available to normalize the exact
  plan before showing it for authorization.
- Ran the dedicated authorization parser tests: 4 passed.
- Made scope review mandatory for every `:team` run and retry; removed the
  configuration opt-in so no config can silently restore automatic grants.
- Connected task-scope prompts to free-form Ink/readline input and kept final
  whole-plan confirmation on the existing yes/no prompt path.
- Reused the exact-name authorization parser from the scope-review validator.
- Updated CLI docs and began adapting end-to-end cases; focused CLI verification
  is still pending.
- Resumed the task and confirmed the Agent Core adversarial tool-scope test is
  already present: attempted hidden-tool invocation, hidden schema, and zero
  hidden executions.
- Confirmed the CLI suite covers explicit review decline but needs a SIGINT
  while-waiting case and an e2e config proving `reviewTaskToolScopes: false`
  cannot suppress review. The compatibility field also needs an explicit docs
  note.
- Session catch-up completed successfully with Python; an initial invocation
  mistakenly used Node to run the Python script and was immediately corrected.
