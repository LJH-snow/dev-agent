import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";
import { createElement } from "react";
import { render } from "ink";
import { RotatingStatus } from "../dist/ink/rotating-status.js";
import { ThinkingIndicator } from "../dist/ink/thinking-indicator.js";
import { ApprovalCard } from "../dist/ink/approval-card.js";
import { InkThemeProvider, getInkTheme } from "../dist/ink/theme.js";

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

const pause = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

function stripEscapes(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "");
}

test("screen-reader mode renders one deterministic status line without animation frames", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const instance = render(
    createElement(RotatingStatus, { active: true, state: "thinking", steps: [] }),
    { stdin, stdout, stderr: stdout, exitOnCtrlC: false, isScreenReaderEnabled: true },
  );
  try {
    await pause(450);
    const output = stripEscapes(writes.join(""));
    assert.match(output, /THINKING/);
    assert.doesNotMatch(output, /PLANNING NEXT STEP/);
    assert.doesNotMatch(output, /READING CONTEXT/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("without screen-reader mode the status line still animates through frames", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const instance = render(
    createElement(RotatingStatus, { active: true, state: "thinking", steps: [] }),
    { stdin, stdout, stderr: stdout, exitOnCtrlC: false },
  );
  try {
    await pause(900);
    const output = stripEscapes(writes.join(""));
    assert.match(output, /THINKING/);
    assert.match(output, /PLANNING NEXT STEP/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("the decorative thinking glyph is omitted for screen readers", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const instance = render(
    createElement(ThinkingIndicator, { active: true }),
    { stdin, stdout, stderr: stdout, exitOnCtrlC: false, isScreenReaderEnabled: true },
  );
  try {
    await pause(250);
    const output = stripEscapes(writes.join(""));
    assert.equal(output.trim(), "");
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("a pending approval card announces itself as busy for screen readers", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const card = {
    id: "card-1",
    kind: "approval" as const,
    name: "bash",
    status: "approval" as const,
    startedAt: Date.now(),
    detail: "rm -rf build",
  };
  const instance = render(
    createElement(InkThemeProvider, {
      theme: getInkTheme("signal"),
      children: createElement(ApprovalCard, { card, width: 60 }),
    }),
    { stdin, stdout, stderr: stdout, exitOnCtrlC: false, isScreenReaderEnabled: true },
  );
  try {
    await pause(250);
    const output = stripEscapes(writes.join(""));
    assert.match(output, /\(busy\)[^\n]*APPROVAL \/ APPROVAL · bash/);
    assert.match(output, /y \/ n to continue/);
    assert.doesNotMatch(output, /[◐◓◑◒▖▘▝▗]/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("tool cards expose running state to screen readers and stay quiet when done", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const { ToolTimeline } = await import("../dist/ink/tool-timeline.js");
  const cards = [
    { id: "t1", kind: "tool" as const, name: "read-file", status: "running" as const, startedAt: Date.now() },
    { id: "t2", kind: "tool" as const, name: "list-dir", status: "completed" as const, startedAt: Date.now(), finishedAt: Date.now() },
  ];
  const instance = render(
    createElement(InkThemeProvider, {
      theme: getInkTheme("signal"),
      children: createElement(ToolTimeline, { cards, columns: 80 }),
    }),
    { stdin, stdout, stderr: stdout, exitOnCtrlC: false, isScreenReaderEnabled: true },
  );
  try {
    await pause(250);
    const output = stripEscapes(writes.join(""));
    assert.match(output, /\(busy\)[^\n]*read-file/);
    assert.match(output, /list-dir[^\n]*COMPLETED|COMPLETED[^\n]*list-dir/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});
