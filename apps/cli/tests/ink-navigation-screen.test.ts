import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createElement } from "react";
import headless from "@xterm/headless";

const { Terminal } = headless;
import { RuntimeEventSequence } from "@dev-agent/agent-core";

// Load Ink after enabling ANSI colors so the screen emulator can inspect the
// actual painted hover background, not just a state flag or an output string.
process.env.FORCE_COLOR = "3";
delete process.env.NO_COLOR;
const { render } = await import("ink");
const { InkCliApp } = await import("../dist/ink/app.js");
const { InkRuntimeStore } = await import("../dist/ink/runtime-store.js");
const { createInkRenderOutput } = await import("../dist/ink/terminal-size.js");

function createScreen(
  columns: number,
  rows: number,
  commands?: readonly { command: string; description: string }[],
  workingDirectory = "/tmp",
) {
  const terminal = new Terminal({ cols: columns, rows, convertEol: true, allowProposedApi: true, scrollback: 1000 });
  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });
  const physicalOutput = new Writable({
    write(chunk, _encoding, callback) {
      terminal.write(String(chunk), callback);
    },
  }) as Writable & NodeJS.WriteStream;
  Object.assign(physicalOutput, { isTTY: true, columns, rows });
  const store = new InkRuntimeStore();
  const submitted: string[] = [];
  const resumed: number[] = [];
  const instance = render(createElement(InkCliApp, {
    store,
    provider: "fixture",
    model: "fixture",
    sessionId: "fixture",
    workingDirectory,
    executor: "local",
    terminalRowsOffset: 1,
    ...(commands === undefined ? {} : { commands }),
    onSubmit: (value: string) => submitted.push(value),
    onSessionResume: (index: number) => resumed.push(index),
    onCancel: () => undefined,
    onExit: () => undefined,
  }), {
    stdin,
    stdout: createInkRenderOutput(physicalOutput),
    stderr: physicalOutput,
    exitOnCtrlC: false,
    maxFps: 15,
  });
  const lines = (): string[] => Array.from({ length: rows }, (_, y) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y)?.translateToString(true) ?? ""
  );
  const button = (): { x: number; y: number } | undefined => {
    const screen = lines();
    const row = screen.findIndex((line) => line.includes("Back to bottom"));
    if (row < 0) return undefined;
    return { x: screen[row]!.indexOf("Back to bottom") + 1, y: row + 1 };
  };
  const buttonBackground = (): number | undefined => {
    const position = button();
    if (!position) return undefined;
    return terminal.buffer.active.getLine(terminal.buffer.active.viewportY + position.y - 1)
      ?.getCell(position.x - 1)?.getBgColor();
  };
  const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
    for (let attempt = 0; attempt < 70; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`${message}: ${JSON.stringify(lines())}`);
  };
  const loadTranscript = async (): Promise<void> => {
    const events = new RuntimeEventSequence("screen-navigation-session");
    const runId = "screen-navigation-run";
    store.apply(events.create("run.started", { prompt: "screen navigation task", model: "fixture" }, { runId }));
    store.apply(events.create("assistant.completed", {
      text: Array.from({ length: 80 }, (_, index) => `screen-line-${index + 1}`).join("\n"),
    }, { runId }));
    store.apply(events.create("run.completed", { turns: 1 }, { runId }));
    await waitFor(() => lines().some((line) => line.includes("screen-line-80")), "transcript should render");
    stdin.write("\u001b[5~");
    await waitFor(() => button() !== undefined, "PageUp should reveal navigation");
  };
  const dispose = (): void => {
    instance.unmount();
    stdin.destroy();
    physicalOutput.destroy();
    terminal.dispose();
  };
  const resize = (nextColumns: number, nextRows: number): void => {
    columns = nextColumns;
    rows = nextRows;
    terminal.resize(columns, rows);
    Object.assign(physicalOutput, { columns, rows });
    physicalOutput.emit("resize");
  };
  const click = (x: number, y: number): void => {
    stdin.write(`\u001b[<0;${x};${y}M\u001b[<0;${x};${y}m`);
  };
  const paintedRow = (needle: string): number | undefined => {
    const row = lines().findIndex((line) => line.includes(needle));
    return row < 0 ? undefined : row + 1;
  };
  return { store, resize, terminal, stdin, lines, button, buttonBackground, waitFor, loadTranscript, click, paintedRow, submitted, resumed, dispose };
}

for (const [columns, rows] of [[20, 12], [80, 24], [120, 40], [160, 50]] as const) {
  test(`Back to bottom highlights only under the pointer on a ${columns}x${rows} terminal`, async () => {
    const screen = createScreen(columns, rows);
    try {
      await screen.loadTranscript();
      const position = screen.button()!;
      assert.equal(screen.buttonBackground(), -1);
      screen.stdin.write(`\u001b[<35;${position.x};${position.y}M`);
      await screen.waitFor(
        () => screen.buttonBackground() === 0x67a9ff,
        "hovering the painted label should paint it blue",
      );
      screen.stdin.write(`\u001b[<35;${position.x};${position.y + 1}M`);
      await screen.waitFor(
        () => screen.buttonBackground() === -1,
        "moving one row below the painted label should clear the hover background",
      );
      screen.stdin.write(`\u001b[<35;${position.x};${position.y}M`);
      await screen.waitFor(() => screen.buttonBackground() === 0x67a9ff, "hover should return on re-entry");
      screen.stdin.write(`\u001b[<35;${position.x};${position.y + 2}M`);
      await screen.waitFor(
        () => screen.buttonBackground() === -1,
        "moving onto the status line should remove the button's hover background",
      );
      screen.stdin.write(`\u001b[<35;${position.x};${position.y}M`);
      await screen.waitFor(() => screen.buttonBackground() === 0x67a9ff, "hover should return again");
      screen.stdin.write(`\u001b[<35;1;${position.y}M`);
      await screen.waitFor(
        () => screen.buttonBackground() === -1,
        "moving left of the label should remove the button's hover background",
      );
    } finally {
      screen.dispose();
    }
  });

  test(`Back to bottom clicks at its painted location on a ${columns}x${rows} terminal`, async () => {
    const screen = createScreen(columns, rows);
    try {
      await screen.loadTranscript();
      const position = screen.button()!;
      screen.stdin.write(`\u001b[<0;${position.x};${position.y}M\u001b[<0;${position.x};${position.y}m`);
      await screen.waitFor(
        () => screen.button() === undefined && screen.lines().some((line) => line.includes("screen-line-80")),
        "clicking the painted label should return to the latest transcript",
      );
    } finally {
      screen.dispose();
    }
  });
}

for (const [columns, rows] of [[60, 18], [120, 40]] as const) {
  test(`startup wheel, growing composer, diagnostics and resize at ${columns}x${rows}`, async () => {
    const screen = createScreen(columns, rows);
    try {
      await screen.waitFor(() => screen.lines().some((line) => line.includes("Context:")), "status visible at startup");
      screen.stdin.write("\u001b[<64;20;5M");
      screen.stdin.write("\u001b[H");
      await screen.waitFor(() => screen.lines().some((line) => line.includes("SIGNAL LOOM")), "welcome reachable by scrolling");
      for (let i = 0; i < 100; i++) screen.store.addNotice(`[route] mode=fast reason=${i}`);
      assert.equal(screen.store.getSnapshot().notices.length, 0);
      screen.stdin.write("\u001b[F");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await screen.loadTranscript();
      screen.stdin.write("one\ntwo\nthree\n");
      await screen.waitFor(() => screen.lines().some((line) => line.includes("three")), "multiline composer visible");
      screen.resize(80, 24);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const position = screen.button()!;
      assert.ok(position);
      screen.stdin.write(`\u001b[<35;${position.x};${position.y}M`);
      await screen.waitFor(() => screen.buttonBackground() === 0x67a9ff, "hover follows resized composer");
      screen.stdin.write(`\u001b[<0;${position.x};${position.y}M`);
      await screen.waitFor(() => screen.button() === undefined, "click follows resized composer");
      screen.store.setConversation({ sessionId: "fixture", provider: "remote", model: "current", promptTokens: 123 });
      await screen.waitFor(() => screen.lines().some((line) => line.includes("123 tokens (last request)")), "request usage visible");
      screen.store.setConversation({ sessionId: "fixture", provider: "remote", model: "next" });
      await screen.waitFor(() => screen.lines().some((line) => line.includes("remote/next") && line.includes("unknown")), "model switch clears usage");
      screen.store.setConversation({ sessionId: "stale", provider: "wrong", model: "stale", promptTokens: 999 });
      await screen.waitFor(() => screen.lines().some((line) => line.includes("fixture/fixture")), "stale session ignored");
      assert.ok(!screen.lines().join("\n").includes("999 tokens"));
    } finally { screen.dispose(); }
  });
}

test("notices are bounded and request usage rejects stale sessions and duplicate events", () => {
  const store = new InkRuntimeStore();
  for (let i = 0; i < 80; i++) store.addNotice(`action ${i}`);
  store.addNotice("action 79");
  assert.equal(store.getSnapshot().notices.length, 50);
  store.setRetry({ prompt: "retry", error: "failed" });
  store.setConversation({ sessionId: "current", provider: "remote", model: "model" });
  const events = new RuntimeEventSequence("current");
  const usage = events.create("usage.reported", { promptTokens: 12, completionTokens: 3, totalTokens: 15 });
  store.apply(usage);
  store.apply(usage);
  store.apply(new RuntimeEventSequence("old").create("usage.reported", { promptTokens: 999, completionTokens: 0, totalTokens: 999 }));
  assert.equal(store.getSnapshot().conversation?.promptTokens, 12);
  assert.equal(store.getSnapshot().retry?.prompt, "retry");
  store.reset();
  assert.equal(store.getSnapshot().conversation, undefined);
});

test("oversized paste notice leaves resized navigation and status usable", async () => {
  const screen = createScreen(80, 24);
  try {
    await screen.loadTranscript();
    screen.stdin.write("x".repeat(8100) + "\na\nb\n");
    await screen.waitFor(() => screen.lines().some((line) => line.includes("truncated")), "paste notice visible");
    const position = screen.button()!;
    screen.stdin.write(`\u001b[<35;${position.x};${position.y}M`);
    await screen.waitFor(() => screen.buttonBackground() === 0x67a9ff, "paste notice shifts hit row with layout");
    screen.stdin.write(`\u001b[<0;${position.x};${position.y}M`);
    await screen.waitFor(() => screen.button() === undefined, "paste notice click works");
    assert.ok(screen.lines().some((line) => line.includes("Context:")));
  } finally { screen.dispose(); }
});

test("unmatched fuzzy input closes the palette and the wheel moves its selection", async () => {
  const screen = createScreen(80, 24);
  try {
    screen.stdin.write(":zzz");
    await screen.waitFor(
      () => screen.paintedRow("COMMANDS // DECK") === undefined,
      "no command matches :zzz",
    );

    screen.stdin.write("\u007f".repeat(4));
    screen.stdin.write(":");
    await screen.waitFor(() => screen.paintedRow("COMMANDS // DECK") !== undefined, "palette open");
    assert.ok(screen.paintedRow("› :help") !== undefined, "first row starts selected");

    // Wheel down moves the highlight; the transcript viewport stays put.
    screen.stdin.write("\u001b[<65;10;10M");
    await screen.waitFor(() => screen.paintedRow("› :editor") !== undefined, "wheel down selects :editor");
    screen.stdin.write("\u001b[<64;10;10M");
    await screen.waitFor(() => screen.paintedRow("› :help") !== undefined, "wheel up returns to :help");
    screen.stdin.write("\u001b[<64;10;10M");
    await screen.waitFor(() => screen.paintedRow("› :help") !== undefined, "wheel up is bounded at the top");
  } finally { screen.dispose(); }
});

test("clicking a palette row selects it and clicking again submits it", async () => {
  const screen = createScreen(80, 24);
  try {
    screen.stdin.write(":");
    await screen.waitFor(() => screen.paintedRow("COMMANDS // DECK") !== undefined, "palette open");
    const editorRow = screen.paintedRow(":editor");
    assert.ok(editorRow !== undefined, "editor row painted");
    assert.ok(screen.paintedRow("› :help") !== undefined, "first row starts selected");

    screen.click(2, editorRow);
    await screen.waitFor(() => screen.paintedRow("› :editor") !== undefined, "click selects editor row");
    assert.deepEqual(screen.submitted, []);

    screen.click(2, editorRow);
    await screen.waitFor(() => screen.submitted.length === 1, "second click submits the command");
    assert.deepEqual(screen.submitted, [":editor"]);
    await screen.waitFor(
      () => screen.paintedRow("COMMANDS // DECK") === undefined,
      "palette closes after submit",
    );
  } finally { screen.dispose(); }
});

test("browsing pins the task that owns the top of the viewport", async () => {
  const screen = createScreen(80, 24);
  // The run projection already paints the prompt text inside the transcript,
  // so discriminate the pinned header by its full-width dim background.
  const topRowIsPinned = (): boolean => {
    const line = screen.terminal.buffer.active.getLine(screen.terminal.buffer.active.viewportY);
    if (line === undefined) return false;
    // The Box padding leaves the first cell unpainted; scan into the Text.
    for (let x = 0; x < 6; x += 1) {
      const cell = line.getCell(x);
      if (cell !== undefined && cell.getBgColor() !== -1) return true;
    }
    return false;
  };
  const pinnedTitle = (): string | undefined =>
    topRowIsPinned() ? screen.lines()[0]!.trimStart() : undefined;
  try {
    await screen.loadTranscript();
    // loadTranscript intentionally ends in browsing mode; return to follow so
    // the second task's rows stream into view, and so the pinned header's
    // absence is actually exercised.
    screen.stdin.write("\u001b[F");
    await screen.waitFor(() => screen.button() === undefined, "End returns to follow");
    await screen.waitFor(
      () => !topRowIsPinned(),
      "follow mode paints no pinned header",
    );

    const secondEvents = new RuntimeEventSequence("screen-navigation-session-2");
    screen.store.apply(secondEvents.create(
      "run.started",
      { prompt: "second navigation task", model: "fixture" },
      { runId: "screen-navigation-run-2" },
    ));
    screen.store.apply(secondEvents.create(
      "assistant.completed",
      { text: Array.from({ length: 30 }, (_, index) => `second-line-${index + 1}`).join("\n") },
      { runId: "screen-navigation-run-2" },
    ));
    screen.store.apply(secondEvents.create(
      "run.completed",
      { turns: 1 },
      { runId: "screen-navigation-run-2" },
    ));
    await screen.waitFor(
      () => screen.lines().some((line) => line.includes("second-line-30")),
      "second task rendered",
    );

    screen.stdin.write("\u001b[5~");
    await screen.waitFor(() => screen.button() !== undefined, "PageUp starts browsing");
    await screen.waitFor(
      () => pinnedTitle()?.startsWith("second navigation task") === true,
      "current task pinned while browsing its block",
    );

    // Scroll up past the second task's prompt: the header must switch to the
    // previous task instead of staying on the latest one.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (pinnedTitle()?.startsWith("screen navigation task") === true) break;
      screen.stdin.write("\u001b[5~");
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await screen.waitFor(
      () => pinnedTitle()?.startsWith("screen navigation task") === true,
      "header switches to the previous task past its prompt",
    );

    screen.stdin.write("\u001b[F");
    await screen.waitFor(() => screen.button() === undefined, "End returns to follow again");
    await screen.waitFor(
      () => !topRowIsPinned(),
      "pinned header disappears in follow mode",
    );
  } finally { screen.dispose(); }
});

test("clicking session picker rows selects and then resumes", async () => {
  const screen = createScreen(80, 24);
  try {
    screen.store.setSessionPicker({
      title: "SESSIONS",
      rows: ["session-one", "session-two"],
      selectedIndex: 0,
    });
    await screen.waitFor(() => screen.paintedRow("SESSIONS") !== undefined, "picker open");
    const secondRow = screen.paintedRow("session-two");
    assert.ok(secondRow !== undefined, "second row painted");

    screen.click(2, secondRow);
    await screen.waitFor(() => screen.paintedRow("› session-two") !== undefined, "click selects second row");
    assert.deepEqual(screen.resumed, []);

    screen.click(2, secondRow);
    await screen.waitFor(() => screen.resumed.length === 1, "second click resumes");
    assert.deepEqual(screen.resumed, [1]);
  } finally { screen.dispose(); }
});

test("large session lists scroll a bounded window and clicks map to absolute rows", async () => {
  const screen = createScreen(120, 40);
  try {
    const rows = Array.from({ length: 30 }, (_, index) => `session-${index + 1}`);
    screen.store.setSessionPicker({
      title: "SESSIONS",
      rows,
      selectedIndex: 0,
    });
    await screen.waitFor(() => screen.paintedRow("SESSIONS") !== undefined, "picker open");
    await screen.waitFor(() => screen.paintedRow("session-8") !== undefined, "window paints 8 rows");
    assert.equal(screen.paintedRow("session-9"), undefined, "window stays bounded");
    assert.ok(screen.paintedRow("1/30") !== undefined, "position hint painted");

    // Move the selection to session-12 (absolute index 11): the window must
    // follow and paint session-5..session-12.
    for (let step = 0; step < 11; step += 1) {
      screen.stdin.write("\u001b[B");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await screen.waitFor(() => screen.paintedRow("› session-12") !== undefined, "window follows the selection");
    assert.equal(screen.paintedRow("session-4"), undefined, "rows above the window stay hidden");

    // session-8 (absolute 7) is window row 3; the offset must map the click
    // onto the absolute row: first click selects, second click resumes.
    const sessionEightRow = screen.paintedRow("session-8");
    assert.ok(sessionEightRow !== undefined, "session-8 painted in the window");
    screen.click(2, sessionEightRow);
    await screen.waitFor(() => screen.paintedRow("› session-8") !== undefined, "click selects the absolute row");
    screen.click(2, sessionEightRow);
    await screen.waitFor(() => screen.resumed.length === 1, "second click resumes");
    assert.deepEqual(screen.resumed, [7]);

    // Wrapping above the first row jumps the window to the list end.
    for (let step = 0; step < 8; step += 1) {
      screen.stdin.write("\u001b[A");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await screen.waitFor(() => screen.paintedRow("› session-30") !== undefined, "wrap scrolls to the last row");
    assert.ok(screen.paintedRow("30/30") !== undefined, "wrap updates the position hint");
  } finally { screen.dispose(); }
});

test("hovering the MCP capability card scrolls its bounded window", async () => {
  const screen = createScreen(120, 40);
  try {
    const servers = Array.from({ length: 12 }, (_, index) => ({
      name: `server-${index + 1}`,
      state: "ready" as const,
      tools: 1,
      resources: 0,
      prompts: 0,
    }));
    screen.store.setMcpSnapshot({
      status: "ready",
      servers,
      totals: { servers: 12, tools: 12, resources: 0, prompts: 0 },
    });
    await screen.waitFor(() => screen.paintedRow("MCP CAPABILITIES") !== undefined, "panel open");
    await screen.waitFor(() => screen.paintedRow("server-8") !== undefined, "window paints 8 servers");
    assert.equal(screen.paintedRow("server-9"), undefined, "window stays bounded");

    // A motion report parks the pointer on the painted server-8 row; the
    // following wheel-down must scroll the card's window, not the transcript.
    const hoverRow = screen.paintedRow("server-8");
    assert.ok(hoverRow !== undefined, "hover target painted");
    screen.stdin.write(`\u001b[<35;2;${hoverRow}M`);
    await new Promise((resolve) => setTimeout(resolve, 60));
    screen.stdin.write(`\u001b[<65;2;${hoverRow}M`);
    await screen.waitFor(() => screen.paintedRow("server-9") !== undefined, "wheel scrolls the card window");
    assert.ok(screen.paintedRow("2–9/12") !== undefined, "position hint tracks the window");
    assert.equal(screen.paintedRow("server-1"), undefined, "the window left the first server behind");
  } finally { screen.dispose(); }
});

test("session replacement isolates hydrated composer history", async () => {
  const screen = createScreen(120, 40);
  try {
    screen.store.setPromptHistory(["session A secret prompt"]);
    screen.stdin.write("\u0012");
    await screen.waitFor(() => screen.paintedRow("HISTORY // SEARCH") !== undefined, "session A search open");
    assert.ok(screen.lines().some((line) => line.includes("session A secret prompt")));
    screen.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 40));

    screen.store.replaceSession(["session B restored prompt"]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    screen.stdin.write("\u0012");
    await screen.waitFor(() => screen.paintedRow("HISTORY // SEARCH") !== undefined, "session B search open");
    const output = screen.lines().join("\\n");
    assert.match(output, /session B restored prompt/);
    assert.doesNotMatch(output, /session A secret prompt/);
  } finally { screen.dispose(); }
});

test("history search moves with the wheel and accepts with clicks", async () => {
  const screen = createScreen(120, 40);
  const lastRowWith = (needle: string): number | undefined => {
    const rows = screen.lines();
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]?.includes(needle)) return index + 1;
    }
    return undefined;
  };
  try {
    for (const prompt of ["alpha task one", "alpha task two", "beta task three"]) {
      screen.stdin.write(`${prompt}\r`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    assert.deepEqual(screen.submitted, [
      "alpha task one",
      "alpha task two",
      "beta task three",
    ]);

    screen.stdin.write("\u0012");
    await screen.waitFor(() => screen.paintedRow("HISTORY // SEARCH") !== undefined, "search open");
    await screen.waitFor(
      () => lastRowWith("› beta task three") !== undefined,
      "the empty query selects the newest entry",
    );

    // Wheel up moves the selection one match older; because the row under the
    // pointer is now the selected one, a single click accepts it immediately.
    screen.stdin.write("\u001b[<64;10;10M");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const selectedRow = lastRowWith("› alpha task two");
    assert.ok(selectedRow !== undefined, "the wheel moved the selection to the older match");
    screen.click(2, selectedRow);
    await screen.waitFor(
      () => screen.lines().some((line) => line.includes("alpha task two█")),
      "clicking the selected row restores the prompt into the composer",
    );

    screen.stdin.write("\r");
    await screen.waitFor(() => screen.submitted.length === 4, "Enter submits the restored prompt");
    assert.deepEqual(screen.submitted, [
      "alpha task one",
      "alpha task two",
      "beta task three",
      "alpha task two",
    ]);
  } finally { screen.dispose(); }
});

test("clicking path completion rows selects and then accepts", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dev-agent-click-path-"));
  await writeFile(join(workspace, "notes.md"), "notes\n", "utf8");
  const screen = createScreen(80, 24, undefined, workspace);
  try {
    screen.stdin.write("@");
    await screen.waitFor(() => screen.paintedRow("PATH COMPLETION") !== undefined, "panel open");
    const row = screen.paintedRow("notes.md");
    assert.ok(row !== undefined, "notes row painted");

    screen.click(2, row);
    await screen.waitFor(() => screen.paintedRow("› notes.md") !== undefined, "click selects notes.md");
    assert.deepEqual(screen.submitted, []);

    screen.click(2, row);
    await screen.waitFor(
      () => screen.paintedRow("PATH COMPLETION") === undefined &&
        screen.lines().some((line) => line.includes("@notes.md")),
      "second click accepts the path",
    );
    assert.deepEqual(screen.submitted, []);

    screen.stdin.write("\r");
    await screen.waitFor(() => screen.submitted.length === 1, "Enter submits the accepted path");
    assert.deepEqual(screen.submitted, ["@notes.md"]);
  } finally {
    screen.dispose();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("clicking a scrolled palette window row maps to the absolute command", async () => {
  const commands = Array.from({ length: 8 }, (_, index) => ({
    command: `:c${index}`,
    description: `Command ${index}`,
  }));
  const screen = createScreen(80, 24, commands);
  try {
    screen.stdin.write(":");
    await screen.waitFor(() => screen.paintedRow("COMMANDS // DECK") !== undefined, "palette open");

    for (let step = 0; step < 6; step += 1) {
      screen.stdin.write("\u001b[B");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await screen.waitFor(() => screen.paintedRow("› :c6") !== undefined, "window scrolled to c6");

    // The window shows c1..c6, so the painted :c3 row is window row 2. With
    // the offset applied the click selects :c3, not the unscrolled :c2.
    const c3Row = screen.paintedRow(":c3");
    assert.ok(c3Row !== undefined, "c3 painted in scrolled window");
    screen.click(2, c3Row);
    await screen.waitFor(() => screen.paintedRow("› :c3") !== undefined, "click selects c3");
    assert.deepEqual(screen.submitted, []);

    screen.click(2, c3Row);
    await screen.waitFor(() => screen.submitted.length === 1, "second click submits c3");
    assert.deepEqual(screen.submitted, [":c3"]);
  } finally { screen.dispose(); }
});

test("clicking a template palette row fills the composer for completion", async () => {
  const screen = createScreen(80, 24);
  try {
    screen.stdin.write(":");
    await screen.waitFor(() => screen.paintedRow("COMMANDS // DECK") !== undefined, "palette open");
    const planRow = screen.paintedRow(":plan <request>");
    assert.ok(planRow !== undefined, "plan row painted");

    screen.click(2, planRow);
    await screen.waitFor(() => screen.paintedRow("› :plan <request>") !== undefined, "click selects plan row");
    assert.deepEqual(screen.submitted, []);

    screen.click(2, planRow);
    await screen.waitFor(
      () => screen.paintedRow("COMMANDS // DECK") === undefined &&
        screen.lines().some((line) => line.includes(":plan <request>")),
      "composer shows the accepted template",
    );
    assert.deepEqual(screen.submitted, []);

    screen.stdin.write("\r");
    await screen.waitFor(() => screen.submitted.length === 1, "Enter submits the filled template");
    assert.deepEqual(screen.submitted, [":plan <request>"]);
  } finally { screen.dispose(); }
});
