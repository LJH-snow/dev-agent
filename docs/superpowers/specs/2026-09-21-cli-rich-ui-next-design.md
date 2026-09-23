# CLI Rich UI Next Design

**Date:** September 21, 2026

## Goal

Extend the Ink CLI with five terminal-native capabilities:

1. streaming Markdown rendering for assistant answers;
2. bounded file diff previews for reviewed writes;
3. an animated command palette;
4. a runtime-switchable theme system;
5. session history browsing and text search.

The existing ANSI, JSON, `--once`, pipe, and MCP-server paths remain
line-oriented and must not import or render Ink-only UI.

## Design

### Streaming Markdown

Add a small, dependency-free Markdown projection for the terminal. It will
handle headings, paragraphs, unordered/ordered lists, block quotes, fenced
code blocks, horizontal rules, and inline code/emphasis/link text. The parser
must tolerate incomplete streamed fences and incomplete inline markers, render
untrusted text through the existing terminal sanitizer, and cap displayed
lines so a long answer cannot make the active viewport unbounded.

The Ink transcript will use this renderer for assistant entries while leaving
user and provider-reasoning entries on their existing paths.

### File diff preview

Carry the reviewed change-set diff from the runtime approval event into the
existing `ToolCard.diff` field. The approval card will render a compact
summary and a capped, line-colored unified diff. Added and removed lines are
visually distinct, context lines remain dim, and the existing `y / n` and
`Esc` actions do not change. When the card resolves, the preview remains
static and the approval animation stops.

### Command palette animation

Replace the static command box with a focused Ink component. It will show the
first suggestion as the Tab target, list at most six suggestions, and animate
only a small header glyph while suggestions are visible. The animation is
local to the component and stops when the palette is hidden.

### Theme system

Add semantic Ink color tokens with three built-in themes: `signal` (default),
`mono`, and `ember`. `InkCliApp` will read the selected theme from the shared
prompt controller, and `:theme [name]` will list or switch themes without
restarting the session. Components consume semantic tokens through an Ink
theme context; no color literals are added to the new UI components.

### Session history and search

Keep the existing bounded `AgentMemory` source of truth. Add `:search <query>`
with a case-insensitive search over persisted conversation entries, bounded to
the existing history limits and sanitized before display. In Ink, history and
search results render in a dedicated panel rather than being dumped as an
unformatted notice. Existing `:history [count]` behavior remains compatible.

## Boundaries and safety

- No browser, DOM, WebGL, or Markdown package dependency is required.
- Markdown, diff, history, and search output is sanitized and bounded before
  reaching Ink.
- Provider reasoning remains a separate transcript role and is not converted
  into assistant Markdown.
- Runtime events remain the source of truth for streaming answers and review
  diffs.
- Theme changes are presentation-only and do not alter model or session state.

## Verification

Each subsystem gets unit tests before implementation and Ink integration tests
after wiring:

- Markdown block and inline parsing, including an unfinished streamed fence.
- Diff line classification, truncation, and approval-card rendering.
- Command palette frame cycling and hidden-state timer cleanup.
- Theme lookup, controller switching, and representative themed output.
- History parsing, bounded search, redaction, and Ink panel rendering.

Implementation verification on September 21, 2026:

- CLI suite: 491 tests passed.
- Focused Ink/runtime suite: 92 tests passed.
- Agent-core approval/runtime suite: 53 tests passed.
- `git diff --check`: clean.
