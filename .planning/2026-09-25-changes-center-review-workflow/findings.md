# Findings

- The existing Changes Center is implemented in `apps/desktop/public/task-workspace-ui.js`, with markup in `apps/desktop/public/index.html`, styles in `apps/desktop/public/styles.css`, and contract tests in `apps/desktop/tests/task-workspaces-ui.test.ts`.
- Current comments are `{ path, anchor, group, text }` and use bounded sessionStorage; this slice should extend the record compatibly rather than introduce a server mutation.
- Existing diff anchors and group/file selectors can be reused for comment navigation.

## Implementation notes

- Kept storage version `1` so existing `{path, anchor, group, text}` records migrate to `pending` + selected without being discarded.
- The browser only submits selected normalized comment records to the existing prompt insertion callback; after a successful callback, those records become `inserted` and are deselected to prevent accidental duplicate insertion.
- Comment navigation reuses the existing path-filtered diff endpoint and compares sanitized `data-review-anchor`/group attributes rather than building a selector from user-controlled paths or anchors.
- Full Desktop compilation is currently blocked by an unrelated in-progress Task Validation Center change in `apps/desktop/src/chat-session.ts` (`readonly ChangeSetFileReview[]` followed by `.push`). The Changes Center source check and focused suite pass independently.
