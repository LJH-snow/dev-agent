# Findings

- Graph/Context7/Browser tools are not exposed in this session; bounded source inspection and installed Playwright are used.
- Existing composer is shared globally: changing `currentSessionId` neither saves nor restores input text; new-session also retains it.
- Enter key handler submits even during IME composition.
- Jump button is only driven by `pendingLiveOutput`; scrolling completed history upward never makes it visible (observed top=180, height=2671, viewport=723, hidden=true).
- `#messages` is a flex scroll container; resizing the composer or inspector needs sticky-bottom maintenance without overriding manual reading.
- Existing settings initialization is present only in unstaged index.html changes. Preserve it.
- Browser fixture: loopback server with temporary sessions and deterministic fake model, no real API traffic. Existing validation panel GET returns 409 for non-worktree sessions; out of this slice.
- Playwright CLI session unexpectedly closed during QA; use its installed Playwright runtime directly if necessary.

- Narrow-viewport QA found a pre-existing flex/min-height regression: at 390x844, transcript bottom was 3503.9px while composer began at 628px. Overrode narrow viewport minimums and gave the transcript a bounded flex scroll region; after fixing, transcript bottom equals composer top and document height equals viewport.
- Verified labels update only when their meaning changes, avoiding repeated live-region announcements on every streamed token.
- Per-tab drafts are bounded to 32 records / 256 KiB persisted snapshot, 16 KiB per persisted draft, with a 24h restore age limit. Larger drafts and storage failures retain live text but explicitly display window-only status. No new provider calls or runtime permissions.
