# Native macOS Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a double-clickable local `Signal Loom Desktop.app` that starts
the existing Desktop Node server and hosts it in a native macOS window.

**Architecture:** Add a SwiftPM SwiftUI/AppKit executable under
`apps/macos/SignalLoomDesktop`. Keep `apps/desktop` as the server and web UI
source of truth. A main-actor process controller starts Node on an ephemeral
localhost port, waits for `/health`, and supplies the ready URL to a small
`WKWebView` wrapper. A project-local shell script builds TypeScript, builds
Swift, stages the `.app` bundle, and launches or verifies it.

**Tech Stack:** Swift 6 / SwiftPM, SwiftUI, AppKit, WebKit, Foundation
`Process`, existing TypeScript/pnpm Desktop server, shell, XCTest.

**Spec:** `docs/superpowers/specs/2026-09-19-native-macos-desktop-shell-design.md`

## Global Constraints

- Preserve the existing CLI, Web Desktop, server APIs, and current user changes.
- Do not introduce Electron, Tauri, React, or a second Desktop client.
- Do not bundle Node or attempt signing/notarization in this local-development
  pass.
- Use `apply_patch` for manual file edits.
- Keep the app bundle local to `dist/` and never publish packages.
- Use the repository's existing build/test patterns before declaring success.
- Keep startup failures visible and bounded; never show a blank WebView as a
  substitute for readiness.

## Task 1: Add the SwiftPM application scaffold

**Files:**

- Create: `apps/macos/SignalLoomDesktop/Package.swift`
- Create: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/App/SignalLoomDesktopApp.swift`
- Create: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/Views/ContentView.swift`
- Create: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/Views/WebView.swift`
- Create: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/Support/AppTheme.swift`

- [x] Define a macOS 13+ executable target with a test target.
- [x] Add a `WindowGroup` with a 1440x900 default size and 960x640 minimum.
- [x] Set regular application activation and foreground the first window.
- [x] Add a dark startup/loading/failure surface that is visually consistent
      with Signal Loom but does not duplicate the web workbench.
- [x] Wrap `WKWebView` with `NSViewRepresentable` and load only after readiness.

**Verification:**

```bash
cd apps/macos/SignalLoomDesktop
swift build
```

Expected: the executable target compiles before the process service is wired.

## Task 2: Implement launch configuration and readiness parsing

**Files:**

- Create: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/Support/AppConfiguration.swift`
- Create: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/Support/ServerReadiness.swift`
- Create: `apps/macos/SignalLoomDesktop/Tests/SignalLoomDesktopTests/AppConfigurationTests.swift`
- Create: `apps/macos/SignalLoomDesktop/Tests/SignalLoomDesktopTests/ServerReadinessTests.swift`

- [x] Resolve project root from `DEV_AGENT_PROJECT_ROOT`, then bundled
      `project-root.txt`, then the current directory.
- [x] Resolve Node from `DEV_AGENT_NODE_PATH`, then bundled `node-path.txt`,
      then known Homebrew/Volta/nvm/mise locations.
- [x] Derive `apps/desktop/dist/index.js` and validate it before launch.
- [x] Parse only the existing Desktop server listening line into a localhost
      URL.
- [x] Bound captured diagnostics and preserve no secrets or full environment
      values.

**Verification:**

```bash
cd apps/macos/SignalLoomDesktop
swift test
```

Expected: configuration precedence, URL parsing, invalid-line, and diagnostic
limit tests pass.

## Task 3: Add the Node server process controller

**Files:**

- Create: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/Services/DesktopServerProcess.swift`
- Modify: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/Views/ContentView.swift`
- Modify: `apps/macos/SignalLoomDesktop/Sources/SignalLoomDesktop/App/SignalLoomDesktopApp.swift`

- [x] Launch the existing server with host `127.0.0.1`, port `0`, project-root
      working directory, and inherited provider configuration.
- [x] Read stdout/stderr without blocking the UI and detect readiness.
- [x] Poll `/health` with a bounded retry window before exposing the WebView.
- [x] Publish idle, starting, ready, failed, and stopped states on the main
      actor.
- [x] Support retry and idempotent start behavior.
- [x] Stop the child process and close pipes during app termination/deinit.

**Verification:**

```bash
cd apps/macos/SignalLoomDesktop
swift test
swift build
```

Expected: the app compiles and the startup view transitions only after health
readiness.

## Task 4: Add the local app-bundle build and run entrypoint

**Files:**

- Create: `script/build_and_run.sh`
- Create: `.codex/environments/environment.toml`
- Modify: `.gitignore`

- [x] Build `@dev-agent/desktop` before SwiftPM compilation.
- [x] Stage `dist/Signal Loom Desktop.app/Contents/MacOS/SignalLoomDesktop`.
- [x] Generate `Info.plist` with APPL metadata, bundle identifier, minimum
      macOS version, and `NSPrincipalClass`.
- [x] Copy `project-root.txt` and the resolved Node executable path into
      `Contents/Resources`.
- [x] Support `run`, `--verify`, `--debug`, `--logs`, and `--telemetry`.
- [x] Kill only the app-owned process before a rebuild. The default launcher
      uses the app executable directly; setting
      `DEV_AGENT_DESKTOP_LAUNCH_SERVICES=1` uses `/usr/bin/open -n`.
- [x] Ignore staged `.app` output and SwiftPM build products.

**Verification:**

```bash
./script/build_and_run.sh --verify
```

Expected: TypeScript build, Swift build, app staging, app launch, process
presence, and `/health` all succeed.

## Task 5: Document local double-click usage

**Files:**

- Modify: `README.md`
- Modify: `apps/desktop/README.md`

- [x] Explain the local prerequisites: macOS, Node.js, pnpm, and a configured
      provider.
- [x] Document the one-command build/run flow and the staged `.app` location.
- [x] Explain that the first implementation is local, not Developer ID signed,
      and not a distributable notarized release.
- [x] Keep browser startup instructions available for development.

**Verification:**

```bash
rg -n "Signal Loom Desktop|build_and_run|double-click|Developer ID|notarized" README.md apps/desktop/README.md
```

Expected: the documented flow matches the script and artifact path.

## Task 6: Run complete verification and inspect the artifact

- [x] Run `swift test` and `swift build` for the native package.
- [x] Run `pnpm --filter @dev-agent/desktop run test`.
- [x] Run `pnpm --filter @agent_cli/cli run test`.
- [x] Run `pnpm build` and `git diff --check`.
- [x] Run `./script/build_and_run.sh --verify`.
- [x] Inspect `dist/Signal Loom Desktop.app` with `plutil`, `file`, and
      `codesign --display --verbose` where available; do not claim signing.
- [ ] Confirm the app opens through `/usr/bin/open -n` after the checkout folder
      has been granted to the non-Developer-ID-signed app, and the child Node server is
      cleaned up after termination.
- [x] Update this plan's remaining verification checkboxes and record any
      remaining limitation.

### Known local limitation

When the checkout lives under a macOS-protected `Desktop` or `Documents`
folder, LaunchServices may start the non-Developer-ID-signed app without the terminal's
folder authorization. In that case Node can block while reading the project
metadata. The default script launcher and `--verify` use the executable from
the terminal context; `DEV_AGENT_DESKTOP_LAUNCH_SERVICES=1` is available for
testing the real `/usr/bin/open -n` path after granting the app access in
System Settings > Privacy & Security > Files and Folders.
