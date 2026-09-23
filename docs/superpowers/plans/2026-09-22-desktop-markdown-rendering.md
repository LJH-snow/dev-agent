# Desktop Assistant Markdown Rendering

- **Status:** complete
- **Date:** 2026-09-22
- **Owner:** Signal Loom / Dev Agent
- **Primary surface:** `apps/desktop` local web workbench

## Objective

Render the assistant's common Markdown syntax in the Desktop transcript while
keeping the source bounded, escaped, and available for exact copy operations.

## Scope

- Headings, paragraphs, emphasis, lists, blockquotes, separators, inline code,
  fenced code blocks, and safe HTTP(S) links.
- HTML escaping and fail-closed link handling.
- Streamed, historical, and recovered assistant content.
- Raw Markdown copy behavior and bilingual Desktop UI compatibility.

## Safety boundaries

- The renderer emits only a fixed set of HTML elements.
- All text and attributes are escaped before insertion.
- Links accept only `http:` and `https:` URLs.
- Unsupported Markdown remains visible as text.
- No server, SSE, model, session-memory, or provider behavior changes.

## Verification

- Markdown and Desktop UI focused coverage: **8/8**.
- Full Desktop suite: **182/182**.
- Browser smoke: rendered structure, raw Markdown clipboard readback, script
  non-execution, and zero console errors.
- `git diff --check`: passed.

Phase status: **complete**.
