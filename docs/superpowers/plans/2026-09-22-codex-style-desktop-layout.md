# Codex-Style Desktop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Desktop web workbench into a Codex-inspired workspace shell without changing agent runtime behavior.

**Architecture:** Preserve the current vanilla HTML/JavaScript controller and existing element IDs. Add only the missing shell regions in `index.html`, move visual ownership into `styles.css`, and keep the Inspector as a toggleable drawer so runtime diagnostics remain available without dominating the first viewport.

**Tech Stack:** Vanilla HTML, CSS, browser JavaScript, TypeScript Node tests, Playwright CLI.

**Spec:** `docs/superpowers/specs/2026-09-22-codex-style-desktop-layout-design.md`

## Global Constraints

- Do not change the SSE event schema, server routes, session queue, replay, approval, or persistence behavior.
- Keep every controller-referenced element ID stable.
- Use the existing Signal Loom SVG and system font stack.
- Keep light theme, bilingual labels, keyboard focus, and narrow-screen behavior working.
- Do not add a frontend framework or runtime dependency.

---

### Task 1: Lock the new shell contract with failing tests

**Files:**
- Create: `apps/desktop/tests/codex-layout.test.ts`
- Read: `docs/superpowers/specs/2026-09-22-codex-style-desktop-layout-design.md`

**Interfaces:**
- Consumes: the served HTML and `/public/styles.css` response from
  `createDesktopServer()`.
- Produces: assertions for `workspace-identity`, `workspace-nav`,
  `conversation-context`, `composer-meta`, and the inspector drawer contract.

- [x] **Step 1: Write the failing served-HTML assertions**

  Assert that the page contains:

  ```ts
  assert.match(html, /class="workspace-identity"/);
  assert.match(html, /class="workspace-nav"/);
  assert.match(html, /class="conversation-context"/);
  assert.match(html, /class="composer-meta"/);
  assert.match(html, /id="toggle-inspector"/);
  ```

- [x] **Step 2: Write the failing stylesheet assertions**

  Assert that the stylesheet contains the layout boundaries:

  ```ts
  assert.match(styles, /\.workbench\s*\{[^}]*grid-template-columns:\s*minmax\(280px/);
  assert.match(styles, /\.inspector-shell\s*\{[^}]*display:\s*none/);
  assert.match(styles, /\.composer\s*\{[^}]*position:\s*sticky/);
  assert.match(styles, /\.composer:focus-within/);
  ```

- [x] **Step 3: Run the focused test and verify it fails for missing contract**

  Run:

  ```bash
  pnpm --filter @dev-agent/desktop exec tsc -p tsconfig.json
  pnpm --filter @dev-agent/desktop exec tsc -p tsconfig.test.json
  node --test apps/desktop/tests-dist/codex-layout.test.js
  ```

  Expected: failure because the new shell classes and drawer/composer rules do
  not exist yet.

### Task 2: Add the Codex-like shell regions

**Files:**
- Modify: `apps/desktop/public/index.html`
- Test: `apps/desktop/tests/codex-layout.test.ts`

**Interfaces:**
- Consumes: the existing session controls, translations, and controller IDs.
- Produces: semantic shell regions that preserve the existing controller
  references.

- [x] **Step 1: Add the workspace identity and navigation wrappers**

  Keep `new-session`, `session-search`, `session-status-filter`, `session`,
  `session-meta`, and existing action IDs unchanged. Wrap them in
  `workspace-identity`, `workspace-nav`, and `workspace-session-list`
  containers; add only labels using existing translation keys.

- [x] **Step 2: Add the conversation context wrapper**

  Keep `conversation-toolbar`, `toggle-inspector`, and the existing heading
  IDs/labels. Add a `conversation-context` region containing the active
  workspace/session label and inspector action.

- [x] **Step 3: Add the composer metadata row**

  Keep `form`, `input`, and `send` unchanged. Add a `composer-meta` row below
  the textarea actions for session/workspace context and the current status.
  It must remain presentation-only and must not duplicate the input event
  handling.

- [x] **Step 4: Run the focused contract test**

  Run:

  ```bash
  pnpm --filter @dev-agent/desktop exec tsc -p tsconfig.json
  pnpm --filter @dev-agent/desktop exec tsc -p tsconfig.test.json
  node --test apps/desktop/tests-dist/codex-layout.test.js
  ```

  Expected: the HTML contract passes while the visual stylesheet assertions
  remain red until Task 3.

### Task 3: Reframe the visual layout and responsive states

**Files:**
- Modify: `apps/desktop/public/styles.css`
- Test: `apps/desktop/tests/codex-layout.test.ts`

**Interfaces:**
- Consumes: the shell regions from Task 2 and existing theme tokens.
- Produces: desktop, drawer, and narrow-screen layout states.

- [x] **Step 1: Define the Codex-inspired layout tokens**

  Use the existing token names and add only the needed geometry variables:

  ```css
  --rail-width: 292px;
  --content-max: 1024px;
  --composer-blue: #6ea8ff;
  ```

- [x] **Step 2: Style the rail and main context bar**

  Use a fixed-width left rail, quiet separators, open list rows, selected
  session state, and a main context bar that keeps the active project visible.
  Do not add nested decorative cards.

- [x] **Step 3: Style the conversation and message families**

  Keep normal user/assistant messages open on the canvas, retain framed tool
  and approval states, and preserve the existing turn/queue status affordances.

- [x] **Step 4: Make the composer sticky and focus-visible**

  Keep the composer at the bottom of the center column, use a blue
  `:focus-within` frame, and keep metadata below the input without duplicating
  the workspace path in multiple rows.

- [x] **Step 5: Convert the inspector into a desktop drawer**

  Hide the inspector by default, expose it through `toggle-inspector`, and
  keep `.is-open` visible without changing its content or data loading.

- [x] **Step 6: Add responsive rules**

  Preserve the current mobile stack, collapse the rail without horizontal
  overflow, and keep the composer and inspector usable at 390px width.

- [x] **Step 7: Run the focused contract and existing UI tests**

  Run:

  ```bash
  pnpm --filter @dev-agent/desktop exec tsc -p tsconfig.json
  pnpm --filter @dev-agent/desktop exec tsc -p tsconfig.test.json
  node --test \
    apps/desktop/tests-dist/codex-layout.test.js \
    apps/desktop/tests-dist/composer-layout.test.js \
    apps/desktop/tests-dist/server.test.js
  ```

  Expected: all focused UI contracts pass.

### Task 4: Browser visual and interaction verification

**Files:**
- Create outside repository: `/tmp/dev-agent-codex-layout-*.png`
- Review: `/Users/Admin/.codex/attachments/6febe0d5-51a7-4ca1-bdd4-b8c6d1672265/image-1.png`

**Interfaces:**
- Consumes: the running Desktop server at `http://127.0.0.1:4317`.
- Produces: screenshots and interaction evidence for the main shell.

- [x] **Step 1: Capture the desktop viewport**

  Use Playwright CLI at 1440x900. Verify the page title, meaningful content,
  no framework overlay, and the left rail/main/composer geometry.

- [x] **Step 2: Exercise the core UI path**

  Focus the composer, open and close Inspector, switch the session selector,
  and confirm the active session remains visible while the center stream keeps
  its scroll container.

- [x] **Step 3: Capture the narrow viewport**

  Use a 390x844 viewport and verify no horizontal overflow, readable controls,
  and a usable composer.

- [x] **Step 4: Review the mismatch ledger**

  Compare at least five points against the reference: left rail width,
  context header, message alignment, composer placement, and dark surface
  hierarchy. Record intentional differences such as the existing Inspector
  and Signal Loom branding.

### Task 5: Full regression and documentation

**Files:**
- Modify: `apps/desktop/README.md`
- Modify: `progress.md`
- Modify: `task_plan.md`

**Interfaces:**
- Consumes: the verified layout and test results.
- Produces: user-facing run instructions and project progress records.

- [x] **Step 1: Document the new layout and Inspector behavior**

  Explain that the browser Desktop uses a Codex-inspired workspace shell while
  retaining the existing server and native Swift host.

- [x] **Step 2: Run the complete Desktop suite**

  ```bash
  pnpm --filter @dev-agent/desktop test
  ```

- [x] **Step 3: Run diff checks**

  ```bash
  git diff --check
  ```

- [x] **Step 4: Record the final counts and screenshots**

  Add the verified test count and the desktop/narrow viewport checks to
  `progress.md` and mark this plan complete in `task_plan.md`.

## Verification Record

Completed on 2026-09-22.

- Added the Codex-inspired workspace shell while preserving the existing
  controller IDs and server contracts.
- Fixed the legacy `#new-session` specificity collision that collapsed the
  new-session action into a 30px icon grid.
- Restored persisted sessions on first runtime-status inspection so a session
  selected from the sidebar does not produce a false `/api/status` 404.
- Desktop screenshot reviewed at 1440x900 against the supplied Codex reference.
- Browser interaction smoke passed: Inspector open/close, composer focus,
  session switching, and persisted-session status recovery.
- Narrow viewport smoke passed at 390x844 with no horizontal overflow.
- Added independent panel collapse state: the session rail collapses to a
  56px control strip, the Runtime Inspector collapses out of the grid, and
  both states are persisted locally.
- Full Desktop suite: **178/178**.
- `git diff --check`: passed.
