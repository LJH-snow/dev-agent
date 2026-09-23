# Desktop Live-Scroll Recovery Affordance

- **Status:** complete
- **Date:** 2026-09-22
- **Owner:** Signal Loom / Dev Agent
- **Primary surface:** `apps/desktop` local web workbench
- **Related phase:** Eight-hour Rich TUI evaluation closure

## Audit conclusion

The Desktop surface already covers language and theme preferences, multiline
composer sizing, session creation/rename/delete/export, SSE streaming,
approval/review flows, run recovery after reload, status refresh, MCP
capability summaries, evidence previews, validation reruns, and bounded
metadata-only responses. The current tests verify these contracts, including
`desktop message streaming preserves a reader's manual scroll position`.

The remaining user-visible gap is discoverability after that manual scroll:
the browser correctly preserves a reader's position, but the conversation
surface does not expose a “new output” state or a keyboard-accessible way to
return to the newest message. A reader can be left above the active response
with no indication that more output arrived below.

## Objective

Add a small live-scroll recovery affordance without changing the server, SSE
protocol, session memory, or message ordering:

- preserve manual scroll position while new messages stream;
- show a localized, accessible “new output” control only when output arrives
  below the reader's position;
- return to the newest message when the control is activated;
- clear the pending state when the reader reaches the bottom manually;
- reset the state when switching sessions or loading history.

## Scope

### In scope

- A hidden-by-default live-output indicator/button in the Desktop conversation
  surface.
- Client-side bottom detection and pending-output count/state.
- English and Chinese translations, focus semantics, and status announcements.
- Focused static/browser-contract tests for the control and client wiring.
- Preservation of the existing manual-scroll behavior.

### Out of scope

- Server or SSE protocol changes.
- Message virtualization or transcript search.
- Persisting scroll position across sessions or reloads.
- Automatically forcing the reader to the bottom.
- Redesigning the conversation message cards.

## Implementation plan

### Task 1: Define the client scroll contract

- Read the current `isMessagesAtBottom`, `scrollMessagesToBottom`,
  `appendMessage`, `loadSessionView`, and session-switch paths.
- Define one pending-output state owned by the page:
  - `pendingLiveOutput` is false at the bottom;
  - appending content while away from the bottom sets it true;
  - reaching the bottom or activating the control clears it.
- Keep the existing threshold-based bottom detection as the source of truth.

### Task 2: Add the accessible UI affordance

Modify:

- `apps/desktop/public/index.html`
- `apps/desktop/public/styles.css`
- the inline Desktop client script in `index.html`

Add a localized button or live region near `#messages` with:

- `hidden` while no output is pending;
- `aria-live="polite"` and an explicit label;
- a bounded text such as “New output below” / “下面有新输出”;
- a click handler that scrolls to the bottom and restores focus to the
  composer only when that does not steal focus from an active control.

The button must not change message ordering or append duplicate content.

### Task 3: Wire streaming, history, and session transitions

- Update the append paths used by assistant tokens, reasoning, tool progress,
  approvals, validation cards, errors, and completed turns.
- Count pending message additions conservatively; one visible indicator is
  sufficient even when many tokens arrive.
- Clear/reset the indicator in `loadHistory`, `loadSessionView`, session
  creation/switching, retry reset, and explicit jump-to-latest.
- Preserve the current behavior that streaming does not yank a manually
  scrolled reader to the bottom.

### Task 4: Add focused coverage

Add or extend tests for:

- HTML contains the localized live-output control and accessible state.
- New streamed output preserves a reader's manual scroll position and exposes
  the pending indicator contract.
- Clicking/jumping to latest clears the pending state.
- Scrolling to the bottom clears the pending state.
- Session switching/history loading clears stale pending output.
- Existing SSE, retry, approval, run recovery, and message-order contracts
  remain unchanged.

Use a real browser check if the existing Desktop test harness supports it;
otherwise keep the first slice at the current deterministic HTML/client
contract boundary and record the limitation.

### Task 5: Verification and documentation

Run:

```bash
pnpm --filter @dev-agent/desktop test
pnpm verify:typescript
git diff --check
```

Record exact counts and any browser-harness limitation in `progress.md`.
Do not start transcript search or virtualization until this slice has a
passing manual-scroll and jump-to-latest contract.

## Acceptance criteria

- A reader scrolled above the newest message sees a clear, localized
  new-output affordance when more output arrives.
- Activating the affordance reaches the newest message and clears the pending
  state.
- Manually scrolling to the bottom also clears the pending state.
- Streaming never forcibly moves a manually scrolled reader.
- Session switches and history loads cannot inherit a stale indicator.
- Existing approval, validation, retry, run-recovery, and SSE ordering tests
  remain green.
- No server endpoint, event schema, memory format, or model behavior changes.

## Implementation closure: 2026-09-22

- Added the hidden-by-default `jump-to-latest` control with English and
  Chinese translations and a polite accessible announcement.
- Kept the existing manual-scroll behavior: streaming content does not move a
  reader who is above the newest message.
- Cleared pending output when the reader reaches the bottom, activates the
  control, switches sessions, creates a session, or reloads history. History
  hydration now lands at the newest message without creating a false pending
  state.
- Re-verified the Desktop suite at **152/152** and the Desktop build/test
  TypeScript checks.
- Verified the rendered flow at `http://127.0.0.1:4317`: initial history has
  no stale indicator, simulated output while scrolled up shows the localized
  control, activating it returns to the bottom and hides it, the Chinese
  language toggle updates the page, and browser console errors/warnings are
  **0**.
- No server, SSE, session-memory, or model behavior changed.
