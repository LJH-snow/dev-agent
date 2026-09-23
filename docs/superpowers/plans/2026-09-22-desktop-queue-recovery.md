# Desktop Queue Recovery Implementation Plan

> **For agentic workers:** This bounded follow-up was implemented in the current
> workspace with test-first coverage and browser verification.

**Goal:** Restore only waiting Desktop prompts after a page reload without
persisting active runs, transcripts, model reasoning, tool output, or sharing
queue data across browser tabs.

**Architecture:** A small browser module serializes a versioned, TTL-bound
snapshot into `sessionStorage`. The existing per-session in-memory queue
hydrates from that snapshot once, writes only its waiting items after each
queue mutation, and removes active items before a request starts. Session
rename migrates the snapshot and session deletion clears it.

**Tech Stack:** Vanilla browser JavaScript, `sessionStorage`, TypeScript
compiled Desktop tests, and Playwright CLI browser smoke.

**Spec:** The design was agreed in the active task conversation.

## Global Constraints

- Persist waiting prompts only; never persist an active request or transcript.
- Keep storage page-scoped with `sessionStorage`; do not use `localStorage`.
- Cap snapshots at 32 items, 16 KiB per prompt, and 256 KiB serialized bytes.
- Expire snapshots after 24 hours and fail closed on malformed data.
- Do not change the server, SSE schema, session memory format, or provider behavior.

---

### Task 1: Versioned bounded storage module

**Files:**
- Create: `apps/desktop/public/queue-persistence.js`
- Test: `apps/desktop/tests/queue-persistence.test.ts`

**Interfaces:**
- `getQueueStorageKey(sessionId: string): string`
- `writePersistedQueue(storage, sessionId, items, now?): { ok: true; stored: number } | { ok: false; reason: string }`
- `readPersistedQueue(storage, sessionId, now?): { messages: string[]; reason?: string }`
- `movePersistedQueue(storage, fromSessionId, toSessionId, now?): { ok: true; moved: number } | { ok: false; reason: string }`

- [x] Write failing tests for FIFO preservation, active-item exclusion,
  unavailable storage, malformed snapshots, wrong session ids, expiry, size
  limits, and rename migration.
- [x] Implement the smallest versioned JSON snapshot with byte and age
  validation and cleanup on invalid input.
- [x] Run the focused persistence tests and confirm all cases pass.

### Task 2: Integrate with the Desktop queue lifecycle

**Files:**
- Modify: `apps/desktop/public/index.html`
- Test: `apps/desktop/tests/chat-queue-ui.test.ts`

**Interfaces:**
- `getSessionStorage(): Storage | null`
- `persistSessionQueue(sessionId): void`
- `migrateSessionQueue(fromSessionId, toSessionId): void`

- [x] Hydrate a session queue once when its client state is created.
- [x] Persist waiting items after enqueue, removal, clear, requeue, resume,
  terminal completion, recovery completion, and conflict handling.
- [x] Migrate queue storage on successful session rename and clear it after
  successful session deletion.
- [x] Keep active prompts out of storage before `runTurn` starts.
- [x] Add static UI contract assertions for imports and lifecycle wiring.

### Task 3: Verify the user-visible flow

**Files:**
- Modify: `apps/desktop/README.md`
- Create: `docs/superpowers/plans/2026-09-22-desktop-queue-recovery.md`

- [x] Run focused persistence and UI tests.
- [x] Run the complete Desktop test suite.
- [x] Use a real browser to seed a valid snapshot, reload, confirm restored
  prompts render, and confirm the active item is removed while later waiting
  items remain.
- [x] Use a real browser to seed an expired snapshot and confirm it is removed
  without rendering stale prompt text.
- [x] Record the storage boundary and verification counts in project progress
  records.

## Acceptance Criteria

- A page reload restores waiting prompts for the same session and browser tab.
- The first restored prompt may start normally, while later prompts remain
  queued and visible.
- Active requests and completed transcript content never enter the snapshot.
- Malformed, expired, cross-session, oversized, or unavailable snapshots fail
  closed without blocking chat.
- Renaming moves the waiting queue; deleting a session removes its queue.
- No server endpoint, SSE event, memory file, model context, or release surface
  changes.

## Implementation Closure

Completed on 2026-09-22:

- Added versioned `sessionStorage` persistence with 32-item, 16 KiB prompt,
  256 KiB snapshot, and 24-hour age bounds.
- Restored only waiting prompts, removed active prompts before starting a turn,
  and handled storage failures without blocking the UI.
- Migrated queue snapshots on rename and cleared them on deletion.
- Desktop suite passed **165/165**; focused persistence/UI coverage passed
  **5/5**.
- Browser smoke confirmed valid reload recovery and expired-snapshot cleanup.
- No server, SSE, session-memory, provider, or package-release behavior changed.
