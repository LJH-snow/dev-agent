import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
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

function createScreen(columns: number, rows: number) {
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
  const instance = render(createElement(InkCliApp, {
    store,
    provider: "fixture",
    model: "fixture",
    sessionId: "fixture",
    workingDirectory: "/tmp",
    executor: "local",
    terminalRowsOffset: 1,
    onSubmit: () => undefined,
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
  return { terminal, stdin, lines, button, buttonBackground, waitFor, loadTranscript, dispose };
}

for (const [columns, rows] of [[80, 24], [120, 40], [160, 50]] as const) {
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
