# Findings

- The Desktop composer lives in `apps/desktop/public/index.html`; the form already owns the textarea, mode selector, input-resize event, and submit behavior.
- `applyLanguage()` is the existing seam for refreshing translated dynamic UI, and `window.devAgentDesktop` exposes composer mode and other UI preferences.
- `settings-ui.js` already owns bounded local preference storage, but task templates can stay in a dedicated local storage namespace so settings import/reset cannot accidentally execute or mutate them.
- The app uses static HTML plus browser modules; a dedicated `task-templates.js` module can keep normalization/store/UI behavior testable without adding a backend route.
- Existing tests are Node contract tests that read served HTML/static modules or import compiled Desktop sources; focused template-store tests can import the browser module directly because the package is ESM.
