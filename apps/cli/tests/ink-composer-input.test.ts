import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Writable } from "node:stream";
import { createElement } from "react";
import { render } from "ink";
import { InkCliApp } from "../dist/ink/app.js";
import { InkRuntimeStore } from "../dist/ink/runtime-store.js";
import { DEFAULT_COMMAND_HINTS, type CommandHint } from "../dist/tui-renderer.js";

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

function renderComposerApp(
  stdin: PassThrough & NodeJS.ReadStream,
  stdout: Writable & NodeJS.WriteStream,
  onSubmit: (value: string) => void,
  commands: readonly CommandHint[] = [],
) {
  return render(
    createElement(InkCliApp, {
      store: new InkRuntimeStore(),
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands,
      onSubmit,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      debug: true,
      incrementalRendering: false,
      exitOnCtrlC: false,
    },
  );
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 30));

test("bracketed paste is routed through Ink's usePaste channel", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const submitted: string[] = [];
  const instance = renderComposerApp(stdin, stdout, (value) => submitted.push(value));

  try {
    // Let Ink install usePaste before sending the bracketed-paste markers.
    await pause();
    stdin.write("\u001b[200~first line\nsecond line\u001b[201~");
    await pause();
    assert.deepEqual(submitted, []);
    assert.match(writes.join(""), /first line/);
    assert.match(writes.join(""), /second line/);

    stdin.write("\r");
    await pause();
    assert.deepEqual(submitted, ["first line\nsecond line"]);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("pasted multi-line text inserts as one block instead of submitting early", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const submitted: string[] = [];
  const instance = renderComposerApp(stdin, stdout, (value) => submitted.push(value));

  try {
    stdin.write("first line\r\nsecond line\r\n\r\nthird line\n");
    await pause();
    assert.deepEqual(submitted, []);
    const output = writes.join("");
    assert.match(output, /first line/);
    assert.match(output, /second line/);
    assert.match(output, /third line/);

    stdin.write("\r");
    await pause();
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0], "first line\nsecond line\n\nthird line");
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("a single-line paste with one trailing newline still submits (script-driver parity)", async () => {
  const { stdin, stdout } = createInkTerminal();
  const submitted: string[] = [];
  const instance = renderComposerApp(stdin, stdout, (value) => submitted.push(value));

  try {
    stdin.write("git status --short\n");
    await pause();
    assert.deepEqual(submitted, ["git status --short"]);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("two pasted lines with a trailing newline insert as a block without submitting", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const submitted: string[] = [];
  const instance = renderComposerApp(stdin, stdout, (value) => submitted.push(value));

  try {
    stdin.write("git status --short\ngit diff --stat\n");
    await pause();
    assert.deepEqual(submitted, []);
    assert.match(writes.join(""), /git status --short/);
    assert.match(writes.join(""), /git diff --stat/);

    stdin.write("\r");
    await pause();
    assert.deepEqual(submitted, ["git status --short\ngit diff --stat"]);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("oversized pastes are truncated to the bounded limit with a notice", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const submitted: string[] = [];
  const instance = renderComposerApp(stdin, stdout, (value) => submitted.push(value));

  try {
    const oversized = `x\n${"y".repeat(9_000)}\n`;
    stdin.write(oversized);
    await pause();
    assert.deepEqual(submitted, []);
    const output = writes.join("");
    assert.match(output, /truncated to 8000 characters/);
    assert.match(output, /yyyyy/);

    stdin.write("\r");
    await pause();
    assert.equal(submitted.length, 1);
    const chars = Array.from(submitted[0] ?? "");
    assert.equal(chars.length, 8_000); // "x\n" plus 7998 y characters
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("plain Enter still submits and bare Shift+Enter inserts a newline", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const submitted: string[] = [];
  const instance = renderComposerApp(stdin, stdout, (value) => submitted.push(value));

  try {
    stdin.write("hello");
    await pause();
    stdin.write("\u001b[13;2u");
    await pause();
    stdin.write("world");
    await pause();
    assert.deepEqual(submitted, []);
    assert.match(writes.join(""), /hello/);
    assert.match(writes.join(""), /world/);

    stdin.write("\r");
    await pause();
    assert.deepEqual(submitted, ["hello\nworld"]);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("kitty key-release events are ignored so keys register exactly once", async () => {
  const { stdin, stdout } = createInkTerminal();
  const submitted: string[] = [];
  const instance = renderComposerApp(stdin, stdout, (value) => submitted.push(value));

  try {
    stdin.write("a");
    await pause();
    // Kitty release event for the "a" keypress: same codepoint, event type 3.
    stdin.write("\u001b[97;1:3u");
    await pause();
    stdin.write("\r");
    await pause();
    assert.deepEqual(submitted, ["a"]);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});
