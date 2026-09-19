# Signal Loom CLI TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the rich `dev-agent` terminal experience around the Signal Loom brand with a correct run-state model, Gemini-like bordered input editing, command completion, and live tool cards while preserving every non-rich output contract.

**Architecture:** Keep the existing TypeScript/Node.js CLI and split only the rich interactive path into focused modules: brand rendering, display-cell measurement, input editing, session state, and transcript cards. The current `readline/promises` path remains the fallback for pipe/non-TTY modes; rich mode gets a raw-terminal controller that emits prompt submissions to the existing `AgentLoop`.

**Tech Stack:** TypeScript, Node.js built-ins (`node:readline`, `node:tty`, `node:events`), ANSI escape sequences, existing `tui-mode.ts`, `tui-renderer.ts`, `colors.ts`, Node test runner, `expect` PTY tests, existing Desktop vanilla HTML/CSS.

**Implementation status (September 19, 2026):** Complete. The Signal Loom brand,
rich run-state model, bordered editor, blue truecolor input frame, blue-purple-
pink ANSI gradient launch mark, `/` and `:` palette, session path footer,
terminal-safe width handling, live cards with approval diffs and local
collapse/expand commands, waiting-prompt queueing, per-turn composer
separation, Desktop SVG integration, and compatibility boundaries are
implemented. The latest verification includes CLI `380/380` tests, Desktop
`136/136` tests, documentation `57/57`, `11/11` rich interactive tests, and
real PTY sessions at 80/100/120/160 columns with command-palette expansion,
interrupt handling, tool cards, and approval denial recovery.

**Spec:** `docs/superpowers/specs/2026-09-19-desktop-cli-workbench-design.md`

## Global Constraints

- Do not copy Gemini or Codex logos, artwork, proprietary text, or exact visual assets.
- Do not migrate the Desktop app or CLI to a new UI framework.
- Do not change the server API or machine-readable CLI schemas.
- Do not emit rich launch marks, ANSI styling, raw terminal controls, or human-facing headings in JSON, pipe, `--once`, MCP server, `NO_COLOR`, or non-rich paths.
- The launch screen must start in `ready`, even when streaming transport is enabled.
- All rich output must remain bounded at 80, 100, 120, and 160 terminal columns.
- Secret redaction and terminal control-sequence sanitization must happen before rendering untrusted text.
- The canonical visual fixture is ANSI color enabled at 120 columns by 36 rows on a macOS monospace terminal.
- Existing Desktop session, approval, validation, evidence, export, undo, and rerun behavior must remain functional.

---

### Task 1: Lock the rich TTY contracts with failing tests

**Files:**
- Modify: `apps/cli/tests/tui-renderer.test.ts`
- Modify: `apps/cli/tests/interactive.test.ts`
- Create: `apps/cli/tests/tui-input.test.ts`
- Create: `apps/cli/tests/tui-session.test.ts`
- Create: `apps/cli/tests/tui-brand.test.ts`

**Interfaces:**
- Consumes: existing renderer exports and the current interactive subprocess helpers.
- Produces: executable tests that define `SignalLoom`, `TuiRunState`, input reducer, command palette, and live-card behavior for later tasks.

- [x] **Step 1: Write the failing brand and startup tests**

Add tests that import the future brand renderer and assert the launch surface is bounded, recognizable, and starts in `READY`:

```ts
test("Signal Loom launch surface contains the mark, tips, and ready state", () => {
  const output = renderWelcome({
    provider: "ollama",
    model: "qwen3:4b-instruct",
    streaming: true,
    runState: "ready",
    sessionId: "default",
    workingDirectory: "/tmp/project",
    mcpCount: 0,
    width: 80,
  });

  assert.match(output, /DEV AGENT/);
  assert.match(output, /READY/);
  assert.match(output, /Tips/);
  assert.match(output, /qwen3:4b-instruct/);
  assert.ok(stripAnsi(output).split("\n").every((line) => line.length <= 80));
});
```

- [x] **Step 2: Write the failing state-machine tests**

Define expected transitions before implementation:

```ts
test("a turn moves from ready to thinking to streaming and back to ready", () => {
  const session = new TuiSessionModel();

  assert.equal(session.snapshot().state, "ready");
  session.dispatch({ type: "turn-start" });
  assert.equal(session.snapshot().state, "thinking");
  session.dispatch({ type: "assistant-token", text: "hello" });
  assert.equal(session.snapshot().state, "streaming");
  session.dispatch({ type: "turn-complete" });
  assert.equal(session.snapshot().state, "ready");
});

test("approval and validation are explicit states", () => {
  const session = new TuiSessionModel();

  session.dispatch({ type: "turn-start" });
  session.dispatch({ type: "approval-request", tool: "filesystem" });
  assert.equal(session.snapshot().state, "waiting-approval");
  session.dispatch({ type: "approval-resolved", decision: "allow" });
  session.dispatch({ type: "validation-start" });
  assert.equal(session.snapshot().state, "validating");
});
```

- [x] **Step 3: Write the failing input reducer tests**

The reducer must cover cursor movement, insertion, newline, history, palette, escape, and clear without requiring a TTY:

```ts
test("input reducer supports multiline editing and command palette filtering", () => {
  let state = createInputEditorState();
  state = reduceInputKey(state, key("h"));
  state = reduceInputKey(state, key("i"));
  state = reduceInputKey(state, key("shift+enter"));
  state = reduceInputKey(state, key("/"));

  assert.equal(state.value, "hi\n/");
  assert.equal(state.palette.open, true);
  assert.deepEqual(state.palette.matches.map((item) => item.command), ["/help", "/model"]);
});
```

- [x] **Step 4: Write the failing tool-card tests**

Cover running, completed, failed, cancelled, approval, validation, stable card IDs, and bounded rendering:

```ts
test("tool card updates in place instead of duplicating call and result blocks", () => {
  const session = new TuiSessionModel();
  const id = session.dispatch({ type: "tool-start", name: "shell", input: "pwd" });

  session.dispatch({ type: "tool-finish", id, output: "/tmp/project" });
  const cards = session.snapshot().cards;

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.status, "completed");
  assert.match(renderToolCard(cards[0]!, { width: 48 }), /shell/);
});
```

- [x] **Step 5: Run the focused tests to confirm RED**

Run:

```bash
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json
pnpm --filter @agent_cli/cli exec node --test tests-dist/tui-brand.test.js tests-dist/tui-input.test.js tests-dist/tui-session.test.js
```

Expected: compilation or test failures because the new modules and interfaces do not exist yet. Do not weaken assertions to make the tests pass.

- [x] **Step 6: Commit the contract tests**

```bash
git add apps/cli/tests/tui-renderer.test.ts apps/cli/tests/interactive.test.ts apps/cli/tests/tui-input.test.ts apps/cli/tests/tui-session.test.ts apps/cli/tests/tui-brand.test.ts
git commit -m "test(cli): define Signal Loom TTY contracts"
```

### Task 2: Add display-cell measurement and Signal Loom brand assets

**Files:**
- Create: `apps/cli/src/tui-width.ts`
- Create: `apps/cli/src/tui-brand.ts`
- Create: `apps/desktop/public/signal-loom.svg`
- Modify: `apps/cli/src/tui-renderer.ts`
- Modify: `apps/cli/tests/tui-renderer.test.ts`
- Modify: `apps/desktop/public/index.html`
- Modify: `apps/desktop/public/styles.css`
- Modify: `apps/desktop/tests/server.test.ts`

**Interfaces:**
- Consumes: current `sanitizeTerminalText`, `redactSensitiveText`, color helpers, and CSS brand mark.
- Produces:
  - `displayWidth(value: string): number`
  - `truncateToDisplayWidth(value: string, width: number): string`
  - `renderSignalLoomMark(options?: { width?: number; color?: boolean; compact?: boolean }): string`
  - `renderSignalLoomWordmark(options?: { width?: number; color?: boolean }): string`
  - `renderSignalLoomSvg(): string` as the checked-in Desktop asset.

- [x] **Step 1: Add failing display-width cases**

Extend width tests with ASCII, CJK, combining marks, and common emoji:

```ts
test("display width counts terminal cells rather than JavaScript code points", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("e\u0301"), 1);
  assert.ok(displayWidth("🙂") >= 1);
  assert.ok(truncateToDisplayWidth("中文abc", 4).length <= 3);
});
```

- [x] **Step 2: Implement bounded width helpers**

Implement a small deterministic table for combining marks, East Asian wide ranges, and common emoji ranges. Keep ambiguous-width characters at one cell for macOS compatibility. Ensure truncation never splits a surrogate pair or combining sequence.

- [x] **Step 3: Implement the Signal Loom terminal mark**

Use the existing angular geometry as the base, but expose stable compact and full variants. The full launch mark must contain the central `<>` connector; the compact mark must fit within 8 columns and remain readable with `NO_COLOR`.

- [x] **Step 4: Add the SVG brand asset**

Create an editable SVG with:

- a square workbench frame;
- two crossing signal paths;
- a central `<>` connector;
- teal primary stroke and amber secondary connector;
- no gradients, raster images, or embedded external resources;
- a monochrome-safe geometry.

- [x] **Step 5: Integrate the SVG into Desktop**

Replace the existing CSS-only brand mark with the SVG asset while keeping the existing `.brand-mark` sizing contract and accessible `aria-hidden` behavior. Add a server HTML assertion that `/public/signal-loom.svg` is referenced.

- [x] **Step 6: Run focused brand and width tests**

Run:

```bash
pnpm --filter @agent_cli/cli run build
pnpm --filter @agent_cli/cli exec tsc -p tsconfig.test.json
pnpm --filter @agent_cli/cli exec node --test tests-dist/tui-renderer.test.js tests-dist/tui-brand.test.js
pnpm --filter @dev-agent/desktop run test
```

Expected: brand, width, and Desktop asset tests pass; unrelated interactive tests remain unchanged.

- [x] **Step 7: Commit the brand layer**

```bash
git add apps/cli/src/tui-width.ts apps/cli/src/tui-brand.ts apps/cli/src/tui-renderer.ts apps/cli/tests/tui-renderer.test.ts apps/desktop/public/signal-loom.svg apps/desktop/public/index.html apps/desktop/public/styles.css apps/desktop/tests/server.test.ts
git commit -m "feat: add Signal Loom brand assets"
```

### Task 3: Implement the explicit rich TTY state model

**Files:**
- Create: `apps/cli/src/tui-session.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/tui-renderer.ts`
- Modify: `apps/cli/tests/tui-session.test.ts`
- Modify: `apps/cli/tests/tui-renderer.test.ts`

**Interfaces:**
- Consumes: `AgentLoop` callbacks, existing approval/validation records, `StreamingRun`.
- Produces:
  - `type TuiRunState = "ready" | "thinking" | "streaming" | "tool-running" | "waiting-approval" | "validating" | "done" | "error" | "interrupted"`
  - `type TuiSessionEvent`
  - `interface TuiStateSnapshot { state: TuiRunState; cards: readonly ToolCard[]; usage?: UsageSummary }`
  - `class TuiSessionModel { dispatch(event): string | void; snapshot(): TuiStateSnapshot }`

- [x] **Step 1: Expand renderer input types**

Change `renderWelcome` to accept `runState` separately from `streaming` transport capability:

```ts
export interface WelcomeOptions {
  provider: string;
  model: string;
  streaming: boolean;
  runState: TuiRunState;
  sessionId: string;
  workingDirectory: string;
  mcpCount?: number;
  executor?: string;
  width?: number;
}
```

- [x] **Step 2: Implement the state reducer**

Use explicit events for turn start, first token, tool start/progress/finish, approval request/resolution, validation start/result, completion, failure, and interruption. Invalid late events must not move a completed or interrupted turn back into an active state.

- [x] **Step 3: Wire state transitions into `runPrompt` and callbacks**

At interactive startup, initialize `TuiSessionModel` with `ready`. On prompt submission dispatch `turn-start`; on the first token dispatch `assistant-token`; on approval/validation/tool callbacks dispatch corresponding events; on completion dispatch `turn-complete`; on exceptions dispatch `turn-error`; on Ctrl-C dispatch `turn-interrupted`.

- [x] **Step 4: Fix the launch screen status**

Pass `runState: "ready"` to `renderWelcome` and show `streaming` only as a transport capability label. `:model` must show `READY / idle` before a turn and `LIVE / streaming` only during an active turn.

- [x] **Step 5: Run state and interactive regression tests**

Run:

```bash
pnpm --filter @agent_cli/cli run test
```

Expected: all existing CLI tests plus the new state tests pass, and the screenshot-equivalent launch output no longer reports an idle session as `Status: streaming`.

- [x] **Step 6: Commit the state model**

```bash
git add apps/cli/src/tui-session.ts apps/cli/src/index.ts apps/cli/src/tui-renderer.ts apps/cli/tests/tui-session.test.ts apps/cli/tests/tui-renderer.test.ts
git commit -m "feat(cli): model rich TTY run states"
```

### Task 4: Implement the bordered rich input editor

**Files:**
- Create: `apps/cli/src/tui-input.ts`
- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/tests/tui-input.test.ts`
- Modify: `apps/cli/tests/interactive.test.ts`

**Interfaces:**
- Consumes: `CommandHint`, `displayWidth`, terminal width resolver, existing command dispatch.
- Produces:
  - `interface InputEditorState { value: string; cursor: number; historyIndex: number; palette: PaletteState }`
  - `function reduceInputKey(state: InputEditorState, key: InputKey, commands: readonly CommandHint[]): InputEditorState`
  - `function renderInputEditor(state: InputEditorState, width: number): string[]`
  - `class RichInputController { read(): Promise<string | null>; close(): void; redraw(): void }`

- [x] **Step 1: Define key events and reducer tests**

Represent escape sequences as named keys before reducing them:

```ts
type InputKey =
  | { type: "text"; value: string }
  | { type: "enter"; shift: boolean }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" | "right" | "up" | "down" | "home" | "end" }
  | { type: "tab" | "escape" | "ctrl-l" | "ctrl-c" };
```

Test insertion, cursor movement, newline, history, palette filtering, Tab completion, escape, clear, and submit independently from raw stdin.

- [x] **Step 2: Implement the pure reducer**

Keep the editor state immutable. Enter submits when `shift` is false; an
incomplete palette match is completed first, while an exact command match is
submitted immediately. Shift+Enter inserts `\n`. Up/Down navigate history when
the cursor is on the first/last logical line and otherwise move within
multiline content.

- [x] **Step 3: Implement command palette matching**

Normalize both `/command` and `:command` to the same command registry. Match by command prefix first, then description substring. Preserve the typed prefix in the completion result and never execute a command during Tab completion.

- [x] **Step 4: Implement ANSI rendering**

Render a top border, prompt marker, wrapped content, cursor position, optional palette rows, and bottom border. Use display-cell width for every line. Keep palette rows bounded so the input box cannot push the terminal beyond the viewport.

- [x] **Step 5: Implement raw-mode controller**

Only `RichInputController` may call `stdin.setRawMode(true)`. It must:

- save and restore raw mode and cursor visibility;
- listen for `data`, `resize`, `SIGINT`, and stream close;
- redraw from a known cursor anchor;
- return a submitted string to `interactive`;
- reject or cancel cleanly on Ctrl-C;
- leave `readline/promises` untouched for non-rich paths.

- [x] **Step 6: Replace rich `rl.question()`**

Use `RichInputController.read()` in the rich branch and keep the current `rl.question()` branch for non-rich mode. Route approval prompts through the same controller so they cannot open a second stdin reader.

- [x] **Step 7: Run PTY and reducer tests**

Run:

```bash
pnpm --filter @agent_cli/cli run test
```

Expected: scripted key sequences pass, rich TTY input is not duplicated, Ctrl-C cancels the active run, and pipe/JSON tests remain unchanged.

- [x] **Step 8: Commit the input editor**

```bash
git add apps/cli/src/tui-input.ts apps/cli/src/index.ts apps/cli/tests/tui-input.test.ts apps/cli/tests/interactive.test.ts
git commit -m "feat(cli): add rich terminal input editor"
```

### Task 5: Implement live tool cards, approvals, validation, and diffs

**Files:**
- Modify: `apps/cli/src/tui-session.ts`
- Modify: `apps/cli/src/tui-renderer.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/tests/tui-session.test.ts`
- Modify: `apps/cli/tests/tui-renderer.test.ts`
- Modify: `apps/cli/tests/interactive.test.ts`

**Interfaces:**
- Consumes: tool call/progress/result callbacks, approval decisions, review records, validation results.
- Produces:
  - `interface ToolCard { id: string; kind: "tool" | "approval" | "validation"; name: string; status: CardStatus; input?: string; output?: string; diff?: string; detail?: string; startedAt: number; finishedAt?: number }`
  - `renderToolCard(card: ToolCard, options: { width: number; collapsed?: boolean }): string`
  - `renderCardUpdate(card: ToolCard, options: { width: number }): string`

- [x] **Step 1: Add card lifecycle tests**

Test that tool progress changes one stable card, late results are ignored after cancellation, approval cards contain review summaries, validation cards show passed/failed/blocked, and long input/output is bounded.

- [x] **Step 2: Implement card storage and stable IDs**

Generate an in-memory card ID when a tool starts. Store cards in `TuiSessionModel`; update by ID. Do not append a second card for tool result or progress.

- [x] **Step 3: Implement compact card rendering**

Use the Signal Loom divider vocabulary only at card boundaries. Render:

```text
╞═ TOOL <> ═══════════════════════════════════════════════╡
  ◌ shell   running  1.2s
  input: git status --short
```

On completion replace the marker with `✓`; on error use `×`; on approval use `?`; on validation use `+`. Preserve the existing redaction and width limits.

- [x] **Step 4: Wire tool callbacks and approval events**

Update `StreamingRun` callbacks to dispatch card events and redraw the current card. Approval review data must stay bounded and must not expose secrets or absolute paths that existing output redaction would remove.

- [x] **Step 5: Add collapse/expand commands**

Support a compact default card and a deterministic expanded rendering when the user presses the configured expand key or enters the card command. Keep collapse state local to the current rich session and do not persist it in memory.

- [x] **Step 6: Run CLI tests and a real PTY scenario**

Run:

```bash
pnpm --filter @agent_cli/cli run test
memory_file="/tmp/dev-agent-signal-loom-$$_session.json"
expect -c '
  log_user 1
  spawn env DEV_AGENT_MODEL_PROVIDER=ollama DEV_AGENT_MODEL=qwen3:4b-instruct DEV_AGENT_MEMORY_FILE='"$memory_file"' node apps/cli/dist/index.js
  expect "DEV AGENT"
  send "/model\r"
  expect "READY"
  send ":quit\r"
  expect eof
'
```

Expected: the launch screen is ready, `/model` and `:model` share the same command behavior, and the prompt redraw is not duplicated.

- [x] **Step 7: Commit live cards**

```bash
git add apps/cli/src/tui-session.ts apps/cli/src/tui-renderer.ts apps/cli/src/index.ts apps/cli/tests/tui-session.test.ts apps/cli/tests/tui-renderer.test.ts apps/cli/tests/interactive.test.ts
git commit -m "feat(cli): render live tool cards"
```

### Task 6: Complete Desktop brand integration and documentation

**Files:**
- Modify: `apps/desktop/public/index.html`
- Modify: `apps/desktop/public/styles.css`
- Modify: `apps/desktop/tests/server.test.ts`
- Modify: `apps/desktop/README.md`
- Modify: `apps/cli/README.md`
- Modify: `README.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: `apps/desktop/public/signal-loom.svg`, CLI command registry and final brand naming.
- Produces: consistent Signal Loom usage instructions and a documented canonical TTY profile.

- [x] **Step 1: Add Desktop brand contract assertions**

Assert the HTML references the SVG, exposes accessible brand text, and preserves existing session/workbench IDs.

- [x] **Step 2: Tune Desktop brand sizing**

Use the same geometry and semantic colors as the CLI mark. Keep the SVG decorative mark `aria-hidden` and expose `dev-agent` as the accessible brand name.

- [x] **Step 3: Document rich TTY behavior**

Document `/` and `:` command aliases, `READY`/`THINKING`/`STREAMING` states, the canonical terminal profile, and the fact that `pnpm cli` is workspace-only while `dev-agent` is the installed command for external projects.

- [x] **Step 4: Run Desktop and documentation tests**

Run:

```bash
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

Expected: all tests pass and the new documentation remains linked from `docs/README.md`.

- [x] **Step 5: Commit the integration docs**

```bash
git add apps/desktop/public/index.html apps/desktop/public/styles.css apps/desktop/tests/server.test.ts apps/desktop/README.md apps/cli/README.md README.md docs/README.md
git commit -m "docs: describe Signal Loom terminal experience"
```

### Task 7: Run the full visual and compatibility verification

**Files:**
- Create: `/tmp/dev-agent-signal-loom-launch.png`
- Create: `/tmp/dev-agent-signal-loom-input.png`
- Create: `/tmp/dev-agent-signal-loom-tools.png`
- No repository source changes unless a verification failure identifies one.

**Interfaces:**
- Consumes: completed CLI rich TTY, Desktop server, canonical PTY capture.
- Produces: verified screenshots, PTY transcripts, and final test evidence.

- [x] **Step 1: Build the workspace and CLI package**

Run:

```bash
pnpm --filter @agent_cli/cli run build
pnpm --filter @dev-agent/desktop run build
```

Expected: both builds exit successfully.

- [x] **Step 2: Run the focused and full test suites**

Run:

```bash
pnpm --filter @agent_cli/cli run test
pnpm --filter @dev-agent/desktop run test
node --test tests/documentation-contract.test.mjs
git diff --check
```

Expected: CLI and Desktop suites pass with zero failures and no whitespace errors.

- [x] **Step 3: Capture rich TTY at 80, 100, 120, and 160 columns**

Use an `expect` PTY fixture that starts the CLI, captures the welcome screen,
opens `/` and `:`, inserts a multiline prompt, exercises history, sends
`Ctrl-L`, submits a second prompt while the first is active, and exits. Strip
ANSI only for width assertions; retain ANSI output for visual inspection. The
current fixture covers launch, command-palette expansion, and interruption at
80/100/120/160 columns.

- [x] **Step 4: Capture a live tool-card scenario**

Run a deterministic provider/tool fixture that produces a tool call, progress, approval, result, and validation. Verify there is one card per stable ID, no duplicate prompt, and no secret/control sequence leakage.

- [x] **Step 5: Verify compatibility modes**

Run:

```bash
NO_COLOR=1 dev-agent --tools
printf 'hello\n' | dev-agent --once --json
dev-agent --once --json "report the current directory"
dev-agent --mcp-server --help
```

Expected: no rich banner or raw terminal controls in machine-readable output, and all commands retain their existing exit behavior.

- [x] **Step 6: Inspect screenshots and terminal captures**

Check the launch hierarchy, input border, cursor, palette placement, card transitions, 80-column wrapping, 120-column canonical layout, and 160-column breathing room. Check Desktop at wide, medium, and mobile widths for the same Signal Loom mark.

- [x] **Step 7: Commit only after verification is green**

```bash
git status --short
git diff --check
```

Expected: only intentional implementation and documentation files are modified. Do not stage `.playwright-cli/` or unrelated user changes.

## Execution Order

Tasks must be completed in order because each task produces interfaces consumed by the next:

1. Contracts and RED tests.
2. Display width and brand assets.
3. Rich state model.
4. Input editor.
5. Live cards and approvals.
6. Desktop integration and documentation.
7. Full verification.

## Plan Self-Review

- **Spec coverage:** Logo variants are covered by Task 2; explicit states by Task 3; `/` and `:` palette plus input behavior by Task 4; live tool, approval, validation, and diff cards by Task 5; Desktop consistency by Task 6; canonical visual and compatibility verification by Task 7.
- **No placeholders:** The plan uses concrete file paths, event names, commands, assertions, and expected outcomes. `@path` completion is explicitly a later extension point with a safe fallback, so it is not falsely presented as a required first-release filesystem completion feature.
- **Type consistency:** `TuiRunState`, `TuiSessionEvent`, `TuiStateSnapshot`, `InputEditorState`, `InputKey`, and `ToolCard` are introduced before their consumers. `renderWelcome` gains `runState` before Task 3 wires the state model. `renderToolCard` is introduced in Task 5 before the PTY verification uses its output.
- **Scope:** Desktop brand integration is kept as a separate task; the rich CLI controller, state model, and cards remain one CLI surface with independent test cycles. No native packaging or provider behavior is included.
