# Findings

- `apps/desktop/public/settings-ui.js` currently builds six sections: General, Appearance, Model & runtime, Permissions, Integrations, and About.
- The settings return button is rendered inside `.settings-topbar` and is styled at the far right by `justify-content: space-between`; the reference places the return action at the upper-left/sidebar above the search field.
- Only prompt mode, theme, language, and Runtime Inspector visibility are interactive today. Runtime, permission, integration, session, and About values are read-only cards.
- The main workbench already has persisted session-rail and inspector collapse state, theme/language/composer preferences, scroll-follow behavior, and a task terminal follow-latest control that can provide truthful settings seams.
- `window.devAgentDesktop` currently exposes language/theme/composer/inspector/runtime-refresh/session-id seams but no workspace preference seam.
- Existing server status/capability routes expose safe metadata; settings must not add provider credentials or remote mutation controls.
- Browser at `http://127.0.0.1:4327/` confirmed the current return button is top-right and the General page is sparse compared with the Codex reference.
