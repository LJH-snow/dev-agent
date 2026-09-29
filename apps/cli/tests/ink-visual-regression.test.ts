import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";
import { createElement } from "react";
import { render, renderToString } from "ink";

import { InkCliApp } from "../dist/ink/app.js";
import { ApprovalCard } from "../dist/ink/approval-card.js";
import { CommandPalette } from "../dist/ink/command-palette.js";
import { InkRuntimeStore } from "../dist/ink/runtime-store.js";
import { InkThemeProvider, getInkTheme } from "../dist/ink/theme.js";
import { ToolTimeline } from "../dist/ink/tool-timeline.js";

function normalizeSnapshot(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\n+$/u, "");
}

function snapshot(lines: readonly string[]): string {
  return lines.join("\n");
}

function assertSnapshot(name: string, actual: string, expected: readonly string[]): void {
  assert.equal(
    normalizeSnapshot(actual),
    snapshot(expected),
    `${name} visual snapshot changed`,
  );
}

function createInkTerminal(): {
  stdin: PassThrough & NodeJS.ReadStream;
  stdout: Writable & NodeJS.WriteStream;
  writes: string[];
} {
  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });
  const writes: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(String(chunk));
      callback();
    },
  }) as Writable & NodeJS.WriteStream;
  Object.assign(stdout, {
    isTTY: true,
    columns: 80,
    rows: 24,
  });
  return { stdin, stdout, writes };
}

async function captureScreenReaderFrame(node: React.ReactNode): Promise<string> {
  const { stdin, stdout, writes } = createInkTerminal();
  const instance = render(node, {
    stdin,
    stdout,
    stderr: stdout,
    debug: true,
    isScreenReaderEnabled: true,
    exitOnCtrlC: false,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return normalizeSnapshot(writes.join(""));
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
}

test("launch surface and empty composer have a stable visual contract", () => {
  const output = renderToString(
    createElement(InkCliApp, {
      store: new InkRuntimeStore(),
      provider: "fixture",
      model: "fixture-model",
      sessionId: "snapshot",
      workingDirectory: "/workspace/dev-agent",
      executor: "local",
      mcpCount: 0,
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 64 },
  );

  assertSnapshot("launch surface", output, [
    "             ╲╲                    ╱╱",
    "              ╲╲                  ╱╱",
    " ╭──────────────────────╾<>╼──────────────────────╮",
    " │                  SIGNAL LOOM                   │",
    " ╰──────────────────────╼<>╾──────────────────────╯",
    "              ╱╱                  ╲╲",
    "             ╱╱                    ╲╲",
    " DEV AGENT",
    " SIGNAL LOOM // local coding workbench",
    "",
    " Tips for getting started:",
    " 1. Ask questions, edit files, or run commands.",
    " 2. Be specific for the best results.",
    " 3. Type / or : for commands.",
    " 4. Wheel/PageUp/PageDown browse; Home/End jump to bounds.",
    "",
    " Provider: fixture",
    " Model: fixture-model",
    " Session: snapshot",
    " Workspace: /workspace/dev-agent",
    " Executor: local · MCP: 0",
    "",
    "",
    " READY / idle",
    "",
    "╭────────────────────────────────────────────────────────────────────────────╮",
    "│ › █Type your message or @path/to/file                         │",
    "╰────────────────────────────────────────────────────────────────────────────╯",
    " /work…  fixture/fixture-model · Context: unknown · snapshot · local · signal",
  ]);
});

test("command palette keeps the selected row and keyboard affordance stable", () => {
  const output = renderToString(
    createElement(CommandPalette, {
      suggestions: [
        { command: ":help", description: "Show available commands" },
        { command: ":plan", description: "Plan a task" },
        { command: ":quit", description: "Exit the session" },
      ],
      columns: 60,
      selectedIndex: 1,
      frameIndex: 1,
    }),
    { columns: 60 },
  );

  assertSnapshot("command palette", output, [
    "",
    "╭────────────────────────────────────────────────────────╮",
    "│ ✧ COMMANDS // DECK                                     │",
    "│ · :help  Show available commands                       │",
    "│ › :plan  Plan a task                                   │",
    "│ · :quit  Exit the session                              │",
    "│ Tab select · ↑↓ move · esc close                       │",
    "╰────────────────────────────────────────────────────────╯",
  ]);
});

test("approval card keeps its bounded action surface stable", () => {
  const card = {
    id: "approval-1",
    kind: "approval" as const,
    name: "bash",
    status: "approval" as const,
    startedAt: 1_700_000_000_000,
    detail: "rm -rf build",
  };
  const output = renderToString(
    createElement(InkThemeProvider, {
      theme: getInkTheme("signal"),
      children: createElement(ApprovalCard, {
        card,
        width: 48,
        frameIndex: 2,
      }),
    }),
    { columns: 60 },
  );

  assertSnapshot("approval card", output, [
    "╭──────────────────────────────────────────────╮",
    "│ ✸ APPROVAL / APPROVAL · bash                 │",
    "│ rm -rf build                                 │",
    "│ y / n to continue · esc to cancel            │",
    "╰──────────────────────────────────────────────╯",
  ]);
});

test("tool timeline keeps running progress and completed output stable", () => {
  const cards = [
    {
      id: "tool-1",
      kind: "tool" as const,
      name: "read-file",
      status: "running" as const,
      startedAt: 1_700_000_000_000,
      progress: { progress: 3, total: 5 },
      detail: "src/index.ts",
    },
    {
      id: "tool-2",
      kind: "tool" as const,
      name: "write-file",
      status: "completed" as const,
      startedAt: 1_699_999_999_000,
      finishedAt: 1_700_000_000_123,
      output: "updated README",
    },
  ];
  const output = renderToString(
    createElement(InkThemeProvider, {
      theme: getInkTheme("signal"),
      children: createElement(ToolTimeline, {
        cards,
        columns: 70,
        now: 1_700_000_000_500,
      }),
    }),
    { columns: 70 },
  );

  assertSnapshot("tool timeline", output, [
    "",
    "TOOL TIMELINE",
    "",
    "├─ ◌ read-file · RUNNING · 500ms",
    "│  ██████████░░░░░░ 60%",
    "│  src/index.ts",
    "",
    "└─ ✓ write-file · COMPLETED · 1.1s",
    "   updated README",
  ]);
});

test("screen-reader approval output stays deterministic and announces busy state", async () => {
  const card = {
    id: "approval-screen-reader",
    kind: "approval" as const,
    name: "bash",
    status: "approval" as const,
    startedAt: 1_700_000_000_000,
    detail: "rm -rf build",
  };
  const output = await captureScreenReaderFrame(
    createElement(InkThemeProvider, {
      theme: getInkTheme("signal"),
      children: createElement(ApprovalCard, { card, width: 48 }),
    }),
  );

  assertSnapshot("screen-reader approval", output, [
    "(busy) ✦ APPROVAL / APPROVAL · bash",
    "rm -rf build",
    "y / n to continue · esc to cancel",
  ]);
});
