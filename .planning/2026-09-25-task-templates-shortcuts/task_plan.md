# Task Templates and Quick Actions

## Goal
Give the Desktop composer reusable, bilingual task templates and keyboard-driven quick actions while keeping all template content local, bounded, editable, and safe to render.

## Phases
- [x] Inventory the composer, language, settings, and local-storage seams
- [x] Add bounded built-in/custom template store and browser UI module
- [x] Add quick-action buttons, template palette, and keyboard shortcuts
- [x] Add focused tests and browser/static verification
- [ ] Commit and push without staging unrelated parallel work

## Safety and scope
- Templates are client-local; no new server, shell, network, credential, or MCP capability.
- Limit custom template count, name/prompt lengths, and persisted bytes; fail closed on malformed storage.
- Render user-authored names/prompts with text nodes only.
- Preserve unrelated Task Validation Center, CLI, settings, `.playwright-cli/`, and `output/` changes.
