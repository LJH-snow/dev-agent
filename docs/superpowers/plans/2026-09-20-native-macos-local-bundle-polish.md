# Native macOS Local Bundle Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local `Signal Loom Desktop.app` feel like a complete macOS application by giving it the canonical Signal Loom icon and a reproducible checkout-bound archive command.

**Architecture:** Keep the existing SwiftUI/AppKit shell and `script/build_and_run.sh` as the only native entrypoint. Generate the app icon during staging from the checked-in `apps/desktop/public/signal-loom.svg`, add the icon metadata to the generated `Info.plist`, and add a `--package` mode that archives the staged app plus a SHA-256 sidecar without launching or publishing it.

**Tech Stack:** Swift 6 / SwiftPM, macOS `sips` and `iconutil`, shell, `ditto`, Node.js test runner, Markdown.

**Spec:** `docs/superpowers/specs/2026-09-19-native-macos-desktop-shell-design.md`

## Global Constraints

- Preserve the existing CLI, Web Desktop, server APIs, and native startup lifecycle.
- Use the checked-in `apps/desktop/public/signal-loom.svg` as the only logo source; do not copy Gemini, Codex, or other proprietary artwork.
- Keep the generated archive checkout-bound because Node.js and the project root remain external resources.
- Do not bundle Node, add Electron/Tauri, sign/notarize, publish npm packages, create releases, or push a release tag.
- Use only standard macOS tools already required by the native shell: `sips`, `iconutil`, `ditto`, and `shasum`.
- Keep generated `.app`, iconset, archive, and checksum outputs ignored or under `dist/`.
- Use `apply_patch` for source, script, and documentation edits.

---

### Task 1: Lock the local bundle contract

**Files:**

- Create: `tests/native-desktop-bundle.test.mjs`
- Modify: `scripts/release-gate.mjs` only if the new contract test is added to the fixed TypeScript gate
- Modify: `tests/release-gate.test.mjs` only if the fixed gate order changes

**Interfaces:**

- Consumes: `script/build_and_run.sh` and `apps/desktop/public/signal-loom.svg`.
- Produces: a platform-independent contract test proving the launcher exposes icon staging, `CFBundleIconFile`, `--package`, `ditto`, and the documented local archive name.

- [x] **Step 1: Write the failing contract test**

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);
const launcher = readFileSync(resolve(root, "script/build_and_run.sh"), "utf8");

test("native launcher stages the canonical Signal Loom icon", () => {
  assert.equal(existsSync(resolve(root, "apps/desktop/public/signal-loom.svg")), true);
  assert.match(launcher, /sips .*signal-loom\.svg/);
  assert.match(launcher, /iconutil -c icns/);
  assert.match(launcher, /CFBundleIconFile/);
  assert.match(launcher, /SignalLoom\.icns/);
});

test("native launcher exposes a local archive mode without launching", () => {
  assert.match(launcher, /--package\|package/);
  assert.match(launcher, /Signal Loom Desktop-local\.zip/);
  assert.match(launcher, /ditto -c -k/);
  assert.match(launcher, /shasum -a 256/);
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
node --test tests/native-desktop-bundle.test.mjs
```

Expected: FAIL because the launcher does not yet stage an icon or expose
`--package`.

- [x] **Step 3: Add the contract to the TypeScript verification gate**

Add a fixed `native-desktop-contract` step after `documentation-contract` in
`scripts/release-gate.mjs`, using:

```text
node --test tests/native-desktop-bundle.test.mjs
```

Update the fixed-order assertions in `tests/release-gate.test.mjs`.

- [x] **Step 4: Run the gate contract test**

Run:

```bash
node --test tests/release-gate.test.mjs
```

Expected: PASS with the new step present in the fixed order.

### Task 2: Stage the branded native app icon

**Files:**

- Modify: `script/build_and_run.sh`
- Test: `tests/native-desktop-bundle.test.mjs`

**Interfaces:**

- Consumes: `apps/desktop/public/signal-loom.svg`.
- Produces: `dist/Signal Loom Desktop.app/Contents/Resources/SignalLoom.icns` and matching `Info.plist` metadata.

- [x] **Step 1: Add a bounded icon staging helper**

Add a `stage_app_icon` helper that:

1. checks that `/usr/bin/sips` and `/usr/bin/iconutil` are executable;
2. creates a temporary iconset under `.codex/native-build`;
3. rasterizes the canonical SVG into the standard 16, 32, 128, 256, and 512 point sizes plus retina variants;
4. converts the iconset to `SignalLoom.icns` under app resources;
5. removes only the generated temporary iconset after conversion.

The helper must fail with a clear macOS prerequisite message if a required
system tool is unavailable.

- [x] **Step 2: Add icon metadata to the generated plist**

Add:

```xml
<key>CFBundleIconFile</key>
<string>SignalLoom.icns</string>
```

Keep the existing bundle identifier, executable, minimum system version, and
local resource files unchanged.

- [x] **Step 3: Run the focused contract test**

Run:

```bash
node --test tests/native-desktop-bundle.test.mjs
```

Expected: PASS.

- [x] **Step 4: Stage the app and inspect the icon**

Run:

```bash
./script/build_and_run.sh --verify
plutil -p "dist/Signal Loom Desktop.app/Contents/Info.plist"
file "dist/Signal Loom Desktop.app/Contents/Resources/SignalLoom.icns"
```

Expected: the app passes health verification, the plist names
`SignalLoom.icns`, and the resource is a valid Apple icon file.

### Task 3: Add a checkout-bound local archive mode

**Files:**

- Modify: `script/build_and_run.sh`
- Modify: `.gitignore` only if the archive path is not already covered by `dist/`
- Test: `tests/native-desktop-bundle.test.mjs`

**Interfaces:**

- Consumes: the staged `dist/Signal Loom Desktop.app`.
- Produces: `dist/Signal Loom Desktop-local.zip` and
  `dist/Signal Loom Desktop-local.zip.sha256`.

- [x] **Step 1: Add an archive helper**

Add a `package_app` helper that stages the app, archives it with:

```bash
/usr/bin/ditto -c -k --sequesterRsrc --keepParent \
  "$APP_BUNDLE" "$DIST_DIR/Signal Loom Desktop-local.zip"
```

Write the SHA-256 sidecar with:

```bash
/usr/bin/shasum -a 256 "Signal Loom Desktop-local.zip"
```

from inside `dist/`, using temporary files followed by `mv` so an interrupted
archive does not replace the previous complete artifact.

- [x] **Step 2: Add the non-launching `--package` mode**

Extend the launcher case statement with `package` and `--package`. It must
stage and archive the app, print both artifact paths, and exit without calling
`open`, `nohup`, or `verify_app`.

Update the usage text to include:

```text
usage: $0 [run|--verify|--package|--debug|--logs|--telemetry]
```

- [x] **Step 3: Run the packaging smoke check**

Run:

```bash
./script/build_and_run.sh --package
unzip -l "dist/Signal Loom Desktop-local.zip"
(cd dist && shasum -a 256 -c "Signal Loom Desktop-local.zip.sha256")
```

Expected: the archive contains one top-level `Signal Loom Desktop.app`,
contains the executable, plist, local resource files, and `SignalLoom.icns`,
and the checksum verifies.

### Task 4: Document and verify the new local handoff

**Files:**

- Modify: `README.md`
- Modify: `apps/desktop/README.md`
- Modify: `task_plan.md`
- Modify: `progress.md`
- Modify: `docs/superpowers/plans/2026-09-20-native-macos-local-bundle-polish.md`

**Interfaces:**

- Consumes: the launcher behavior and artifact names from Tasks 2 and 3.
- Produces: accurate local build, double-click, archive, and limitation
  documentation.

- [x] **Step 1: Document the archive command and limitation**

Add the command:

```bash
./script/build_and_run.sh --package
```

Explain that the output is a local checkout-bound archive, not a distributable
release: it records the current project root and Node executable path, does not
bundle Node, and is not signed or notarized.

- [x] **Step 2: Mark the implementation plan and project progress**

Mark completed plan checkboxes, add a completed Phase 5 to `task_plan.md`, and
append the exact artifact paths and verification results to `progress.md`.

- [x] **Step 3: Run focused and full verification**

Run:

```bash
node --test tests/native-desktop-bundle.test.mjs
swift test --package-path apps/macos/SignalLoomDesktop --scratch-path .codex/native-test
pnpm build
pnpm verify
./script/build_and_run.sh --verify
./script/build_and_run.sh --package
git diff --check
```

Expected: all existing gates remain green; the native app launches and cleans
up its child server; the local archive and checksum are reproducible and valid.

- [x] **Step 4: Preserve the release boundary**

## Completion Record

Completed on 2026-09-20:

- Native `.app` verification passed, including `/health` readiness and no
  residual `SignalLoomDesktop` or child Desktop server process afterward.
- `SignalLoom.icns` was generated from the canonical SVG and validated as a
  macOS icon resource.
- `dist/Signal Loom Desktop-local.zip` and its `.sha256` sidecar were created;
  checksum verification passed from the `dist/` directory.
- Focused native bundle contracts passed 2/2; Swift package tests passed 8/8.
- Full `pnpm verify` passed: CLI 392/392, Desktop 138/138, model 72/72,
  tools 151/151, documentation 57/57, native bundle contract 2/2, Rust
  unit/bin/doc tests 54/54, and real Rust integration 11/11.
- No npm publish, tag, GitHub Release, signing, notarization, or package
  upload was performed.

Confirm the final report says that no npm publish, tag, GitHub Release,
signing, notarization, or package upload was performed.
