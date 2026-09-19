# Signal Loom Native macOS Desktop Shell Design

**Date:** 2026-09-20  
**Status:** Approved for implementation  
**Decision:** Use a small native SwiftUI/AppKit application as the macOS shell and
reuse the existing local TypeScript Desktop server inside it.

## Goal

Make Signal Loom Desktop launchable by double-clicking a macOS application
bundle while preserving the existing `apps/desktop` web workbench, session
behavior, server API, and visual implementation.

The native application is responsible for:

- starting the repository's local Desktop Node server;
- waiting until the server is healthy;
- presenting the existing Desktop page in a native `WKWebView`;
- showing a useful startup failure state when prerequisites are missing;
- stopping the child server when the application exits.

## Decision And Alternatives

### Chosen: SwiftUI/AppKit shell plus existing Node server

The shell will be a Swift Package executable staged as
`dist/Signal Loom Desktop.app`. A `WindowGroup` supplies the regular macOS
window, while a narrow `NSViewRepresentable` wrapper hosts `WKWebView`.
`Foundation.Process` starts `apps/desktop/dist/index.js` with an ephemeral
localhost port. The shell reads the server's readiness line, confirms
`/health`, and then loads the page.

This keeps the current web UI as the source of truth and gives the user a real
Dock/window application without duplicating the large Desktop client in Swift.

### Rejected: Electron or Tauri migration

These would add a second application runtime, packaging configuration, and
dependency surface for a problem already solved by the existing Node server.
They also risk changing the current web behavior before the native shell is
needed.

### Rejected: native rewrite of the Desktop workbench

Rewriting the chat, sessions, approvals, evidence, and streaming timeline in
Swift would duplicate server contracts and create two UI implementations to
maintain. The native layer should remain an integration shell.

### Rejected: browser-only launcher

Opening the existing URL in the default browser does not provide a
double-clickable application window and does not own the local server
lifecycle.

## Scope

### Included

- `apps/macos/SignalLoomDesktop` Swift Package executable;
- SwiftUI window and AppKit application activation;
- `WKWebView` wrapper for the existing local Desktop page;
- Node child-process startup, readiness detection, health polling, failure
  reporting, and cleanup;
- project-local `.app` staging in `dist/`;
- one `script/build_and_run.sh` entrypoint with `run`, `--verify`, `--debug`,
  `--logs`, and `--telemetry` modes;
- Codex Run action configuration;
- unit tests for launch configuration and readiness parsing;
- documentation for prerequisites and double-click usage.

### Not included in this pass

- bundling a Node runtime into the application;
- code signing, notarization, auto-update, or App Store distribution;
- publishing an npm package or making a network release;
- replacing the existing Desktop web UI;
- adding a second model/provider implementation.

The first artifact is a local development application for this checkout. It
requires Node.js and a built `@dev-agent/desktop` package. The build script
performs that preparation so a user can run the application from the project.

## Architecture

```text
Signal Loom Desktop.app
  |
  | SwiftUI WindowGroup
  v
ContentView
  |
  +-- DesktopServerProcess
  |     +-- resolves project root and Node executable
  |     +-- launches apps/desktop/dist/index.js
  |     +-- parses "listening" output
  |     +-- polls http://127.0.0.1:<port>/health
  |     +-- terminates Node on app shutdown
  |
  +-- WebView
        +-- loads the existing apps/desktop/public/index.html
        +-- preserves the current HTTP/SSE/API behavior
```

### Application resources

The staging script writes two small resources into the app bundle:

- `project-root.txt`: absolute path to this checkout;
- `node-path.txt`: the Node executable used during staging.

The runtime prefers environment overrides for development, then these
resources, then known macOS Node installation locations. This makes a
double-click launch independent of the limited `PATH` normally inherited by
GUI applications while retaining a clear failure message when Node is absent.

### Server lifecycle

1. `ContentView` asks the process controller to start once.
2. The controller validates the project root and server build output.
3. It launches Node with:
   - host `127.0.0.1`;
   - port `0`, so concurrent browser development servers do not collide;
   - the repository root as the child process working directory.
4. It parses the actual listening URL from stdout.
5. It polls `/health` with a bounded timeout.
6. On success, the view loads the URL in `WKWebView`.
7. On a launch error, the view shows a retry action and a concise diagnostic.
8. On application termination, the controller cancels health polling, closes
   pipes, and terminates the child process.

The server remains the same Node process used by the browser workflow. No API
or session contract changes are required.

### Window behavior

- Application policy is regular so the app appears in the Dock and can become
  the foreground application.
- Initial window size is 1440 by 900.
- Minimum window size is 960 by 640.
- The web page owns the workbench layout, responsive behavior, theme, and
  keyboard interactions.
- Native chrome stays restrained; no duplicate browser address bar is shown.

## Error Handling

The shell must fail closed and visibly:

- missing project root: explain that the checkout path could not be resolved;
- missing Desktop build: explain that the local Desktop package must be built;
- missing Node: explain that Node.js is required and show the resolved search
  failure without exposing secrets;
- child process exits before readiness: show the captured sanitized error line;
- health timeout: show that the local server did not become ready;
- unexpected server exit after readiness: show a restart action.

The app must never silently open a blank WebView or claim readiness before the
health endpoint succeeds.

## Testing And Acceptance

### Swift tests

- project-root and server-script paths are derived correctly;
- resource and environment overrides take precedence in a documented order;
- known Node candidate paths are accepted only when executable;
- listening output produces the correct localhost URL;
- unrelated output does not produce false readiness;
- bounded diagnostics do not grow without limit.

### Build and runtime checks

- `swift test` passes in `apps/macos/SignalLoomDesktop`;
- `script/build_and_run.sh --verify` builds the TypeScript Desktop package,
  stages the app, launches it, confirms the app process and `/health`, and
  exits with success;
- the staged artifact contains a valid `Info.plist`, executable, and resource
  files;
- a real double-click-equivalent `/usr/bin/open -n` launch brings the app
  forward and loads the existing Desktop URL;
- stopping the app does not leave the child Node server running;
- existing Desktop tests and the full TypeScript verification remain green.

## Constraints

- Do not reset or overwrite unrelated worktree changes.
- Do not copy Gemini/Codex artwork or proprietary assets.
- Keep native source ASCII-first.
- Keep the process bridge small and testable.
- Do not publish packages or make network releases as part of this change.
