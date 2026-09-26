# Findings

- `DesktopRunRegistry` already owns one bounded run state per session and `GET /api/sessions` already embeds a safe `run` summary.
- `DesktopRunState` tracks live assistant/reasoning/tool/approval state, but the public summary intentionally omits live details; the new projection should allowlist only stage/tool/approval metadata.
- The Desktop UI already polls session summaries and has session activation helpers, so the parallel view can refresh independently and focus a selected session without introducing a second stream protocol.
- Mixed `apps/desktop/src/server.ts`, `apps/desktop/public/index.html`, and `apps/desktop/public/styles.css` edits from Task Validation must be isolated when committing.
