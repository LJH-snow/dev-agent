# Progress

## 2026-09-25

- Inspected both reference screenshots and the current live Desktop UI.
- Confirmed the current settings return button is top-right; the requested target is a Codex-like upper-left/sidebar return action.
- Audited existing settings code and identified truthful seams for additional local preferences before editing.

- Moved the return action into the settings sidebar so it occupies the upper-left position like the reference.
- Added truthful local preferences for session rail visibility, response auto-follow, workspace density, and preference import/export/reset.
- Added bridge seams for those preferences plus runtime/capability/MCP refresh actions.
- Added keyboard shortcuts for settings, new session, session rail, and Runtime Inspector; added the matching shortcut reference card.
- Added the Workspace settings section and expanded Runtime/Integrations/About actions.

## Verification

- Live browser at `http://127.0.0.1:4327/` confirmed the return button renders at the upper-left of the settings sidebar.
- Confirmed Workspace controls update live session-rail, density, response-follow, and terminal-parent state and persist across reloads.
- Confirmed Ctrl/Cmd+, opens settings, Ctrl/Cmd+B toggles the rail, and Escape returns focus to the settings trigger.
- Confirmed bilingual rendering, preference export/download, invalid import rejection, and valid import reload.
- Confirmed desktop and mobile settings layouts have no horizontal overflow in the tested viewports.
- `node --check`, focused settings tests, `typecheck`, build, and Desktop full suite passed; current full suite result was 255/255.
