---
name: running-nested-pty-tests
description: Use when a CLI integration suite creates its own pseudo-terminal and the outer test runner hangs, stops, or times out.
---

# Running Nested PTY Tests

Keep the test runner's terminal separate from the CLI's terminal. An interactive CLI may need a child PTY created by Expect, `node-pty`, or a similar harness; that alone does not mean the outer suite needs an interactive controlling TTY.

## Procedure

1. Establish which layer owns each PTY. Check whether the harness creates a PTY for the CLI child, and whether the harness itself reads the outer terminal (for example, `expect_user`, `/dev/tty`, or raw-mode input). Do not infer either dependency from the CLI being interactive.
2. Preserve the failing evidence before changing the run: exact command and environment, complete transcript, wrapper exit or timeout, and—when available—child PID/parent, session or process group, controlling TTY, wait status, and stop signal. Silence, a stopped-process marker, or a wrapper exit without test assertions does not establish the cause.
3. If only the CLI child needs a PTY, rerun the unchanged full suite under a supervised **noninteractive outer runner**, while preserving the harness-created child PTY. Keep the same test scope and environment, capture the real suite exit status and transcript, and confirm child processes are reaped. Do not add an outer PTY merely because the child is interactive, detach the run so its status is lost, skip the test, or just increase the timeout.
4. If the harness directly reads the outer terminal, retain that requirement and isolate or test that interaction explicitly; do not silently remove it. If PTY ownership is still unknown, gather that evidence before choosing a terminal setup.

The run is verified only when the required tests actually execute, the full suite exits successfully, and no child is left running. A timeout or wrapper result without those checks is not a pass.
