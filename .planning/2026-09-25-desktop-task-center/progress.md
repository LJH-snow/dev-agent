# Progress
- 2026-09-25: inspected current worktree and session lifecycle; selection currently uses a select, rename endpoint physically moves history, runtime summaries exist, composer drafts are isolated per session. Metadata must not reuse physical rename.
- 2026-09-25: added `TaskPresentationStore` sidecars under `.desktop-tasks`, strict PATCH validation, atomic writes, serialized updates, delete cleanup and identity-rename migration; history/worktree/runtime files remain untouched.
- 2026-09-25: added `public/task-center.js` grouping/title/status model and replaced the visible session selector with accessible task rows for pinned/recent/archived groups, search/status filtering, keyboard activation, pin/archive/restore actions, display-title rename and bilingual copy.
- 2026-09-25: focused task-center tests passed 61/61; full desktop suite passed 317/317; typecheck/build/diff-check passed.
- 2026-09-25: Playwright fallback verified desktop and 390px layouts, title/pin/archive/restore/reload/search/Chinese interactions; no page exceptions. One known fixture 409 remains from the existing task-workspace refresh against a session without an isolated worktree.
