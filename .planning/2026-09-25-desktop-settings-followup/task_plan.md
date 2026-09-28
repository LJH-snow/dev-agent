# Desktop Settings Follow-up

## Goal
Make the Desktop settings workspace feel like the Codex desktop reference while keeping controls truthful to dev-agent: move the return action to the upper-left/sidebar, complete meaningful local preferences, and expose safe runtime/integration settings without fake provider or secret-editing APIs.

## Phases
- [ ] Audit current settings surface and reference screenshots
- [ ] Move return-to-app control to the Codex-like upper-left position
- [ ] Add functional general/appearance/workspace preferences wired to the existing workbench
- [ ] Expand safe runtime, permissions, integrations, and keyboard settings with real state/actions
- [ ] Add focused tests and browser visual/interaction verification
- [ ] Commit and push only this follow-up slice after preserving parallel work

## Constraints
- Preserve unrelated uncommitted Task Validation, MCP, CLI, planning, and output changes.
- Do not invent provider/API-key/account/remote mutation controls.
- Settings must persist only safe local preferences and remain bilingual.
- All actions must be bounded, metadata-only where appropriate, and fail closed.
