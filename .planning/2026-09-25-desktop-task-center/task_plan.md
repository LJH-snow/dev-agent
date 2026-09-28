# Desktop Task Center Implementation Plan

## Approved scope
Replace the visible session picker with a bilingual task sidebar: human-readable title, bounded conversation preview, recent time, truthful runtime status, separate draft indicator; pin/unpin; archive/restore; rename display title without changing identity; integrate existing search/status filters. Keep drafts, history, worktree association and background execution intact. Validate desktop/narrow layouts and real interactions. No multi-project expansion, new dependencies, or unrelated staging/commits.

## Architecture
Persist presentation metadata separately under the session directory (`.desktop-tasks/<sessionId>.json`), with strict ID/schema validation, atomic writes and serialized per-record mutations. Enrich existing summaries, leaving the history format untouched. An independent browser module builds accessible task groups and action menus using text nodes. Existing selection remains an internal compatibility adapter; user navigation is through the task list. Metadata updates are allowed while runs execute and never call cancellation. Draft-only sessions remain discoverable.

## Work / evidence
- [x] Tests for metadata durability, validation, independent IDs/history, concurrent updates, archive/restore and deletion.
- [x] Implement store and guarded API, integrate summaries and legacy lifecycle.
- [x] Tests for grouping, title/preview search, statuses, pin/archive precedence, safe content and navigation.
- [x] Implement list, rename dialog, feedback, refresh and existing-session integration.
- [ ] Browser: rename/pin/archive/restore, reload/restart, search/status, draft isolation, background completion while hidden, keyboard, EN/ZH, narrow/desktop.
- [x] Full desktop tests, typecheck, build, diff check and requirement audit.

## Constraints / tool choices
Shared dirty worktree: preserve existing composer/PR review and other ongoing changes; no reset/stash or blanket staging. Graph and Context7 MCP tools are not exposed by this session (resources inspected); scoped source reads are the fallback. Browser plugin not available; regular Playwright fallback. User already approved the prior feature proposal, so execute in this thread without delegation or another design gate.
