# Findings — Worker-Scoped MCP

- `registerMcpTools` currently creates sessions once per CLI process and gives
  them the main working directory.
- `createCollaborativeExecution` already has the correct point to insert a
  task-local tool lease: after reviewed scopes and role bindings intersect, and
  after the task workspace is created.
- The lease must be application-owned because Agent Core should not know about
  MCP processes, configuration, or secrets.

- MCP prefixes must come from the registered main sessions so worker leases
  preserve deterministic configured-server naming, including duplicate names.
- A worker lease is only created for MCP names that survive the reviewed task
  scope; tasks with no MCP grant do not start a child MCP process.
- Worker session config uses the task worktree for `rootDirectory`,
  `DEV_AGENT_WORKING_DIRECTORY`, and session identity, while preserving the
  configured server environment.
