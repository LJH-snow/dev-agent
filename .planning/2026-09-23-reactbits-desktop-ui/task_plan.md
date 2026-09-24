# ReactBits-inspired desktop UI improvement

## Goal
Improve the Signal Loom desktop workbench with a restrained ReactBits interaction while preserving its existing local web/native-shell architecture and all chat/runtime behavior.

## Findings
- The desktop frontend is plain HTML, CSS, and browser JavaScript served locally; the native macOS shell embeds that page. It is not a React application.
- ReactBits MCP setup is built around the shadcn MCP server and an `@react-bits` registry. Installing a React component directly would introduce a framework/runtime mismatch.
- The ReactBits SpotlightCard concept (pointer-following gradient illumination) can be safely adapted as a small progressive-enhancement layer for the desktop inspector's existing status, timeline, trace, and evidence cards.
- The repository has extensive pre-existing uncommitted work. Keep edits narrowly scoped and do not revert or reformat unrelated files.

## Phases
1. **Inspect and select** — confirm the existing inspector/card DOM, ReactBits MCP/component guidance, and current tests. **Complete.**
2. **Implement SpotlightCard adaptation** — add a small browser-side pointer spotlight for existing inspector cards; preserve the UI when JS is unavailable, and disable the effect for reduced-motion preferences and non-fine pointers. **Complete.**
3. **Verify** — add focused behavior coverage, run desktop tests and whitespace checks, and do browser-based desktop visual/interaction checks. **Complete.**

## Acceptance criteria
- Uses the ReactBits SpotlightCard interaction as a design/source reference, adapted to the app's current HTML/CSS/JS stack rather than installing React.
- Spotlight only appears under a fine pointer, remains subtle in both themes, and does not alter layout or interaction.
- `prefers-reduced-motion` disables the visual tracking effect.
- Existing desktop tests pass, and focused tests cover dynamic inspector cards and pointer leave/coordinate behavior.
- No user data, runtime contracts, or unrelated working-tree changes are touched.
