# Desktop Code Block Copy

- **Status:** complete
- **Date:** 2026-09-22
- **Owner:** Signal Loom / Dev Agent
- **Primary surface:** `apps/desktop` local web workbench

## Objective

Make fenced code blocks in assistant Markdown independently copyable without
changing whole-response copy behavior or exposing hidden model reasoning.

## Scope

- Add a copy action to each rendered fenced code block.
- Copy the exact visible code text for the selected block.
- Show copied and failure states with English/Chinese localization.
- Keep the existing assistant-response copy action bound to raw Markdown.
- Cover streamed, historical, and recovered assistant rendering through the
  shared Markdown render path.

## Safety boundaries

- The code action reads only the concrete `code` element inside its own block.
- Clipboard failures are handled through the existing bounded helper and do not
  interrupt stream rendering.
- Code text is copied as text; no HTML or executable content is introduced.
- Re-rendering is idempotent and does not create duplicate controls.
- No server, SSE, provider, session, or persistence contract changes.

## Verification

- Focused Markdown and UI coverage: **5/5**.
- Full Desktop suite: **183/183**.
- Browser smoke: exact code-block clipboard readback, bilingual copied state,
  whole-response copy retention, and zero console/page errors.
- `git diff --check`: passed.

Phase status: **complete**.
