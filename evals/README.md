# CLI Behavior Evaluations

These evaluations launch the built CLI through a real terminal session and
check behavior at the user-visible boundary. They intentionally do not import
the Ink renderer or the queue implementation.

Run them with:

```bash
pnpm test:evals
```

The suite uses only local HTTP provider stubs and the system `expect` command.
It does not contact a model provider, publish a package, or change the user's
workspace. When `expect` is unavailable, the PTY cases are reported as skipped
so the normal package tests can still run.

Current coverage:

- Ink queue ordering and streamed answer ownership.
- Ink long-session PageUp/Home/End navigation and bounded live output.
- Ink idle Ctrl-C exit status.
- Approval denial and tool-loop continuation.
- ANSI fallback command completion at a narrow terminal width.
- EOF handling for the line-oriented boundary.
- Project skill discovery, explicit activation/deactivation, and Prompt
  isolation across consecutive requests.
