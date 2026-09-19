import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createInputEditorState,
  RichInputController,
  reduceInputKey,
  type RichInputControllerOptions,
  type InputKey,
} from "../dist/tui-input.js";

function key(value: string): InputKey {
  if (value === "shift+enter") return { type: "enter", shift: true };
  if (value === "enter") return { type: "enter", shift: false };
  if (value === "tab") return { type: "tab" };
  if (value === "escape") return { type: "escape" };
  return { type: "text", value };
}

class FakeInput extends EventEmitter {
  readonly rawModeCalls: boolean[] = [];
  pauseCount = 0;
  resumeCount = 0;

  setRawMode(enabled: boolean): void {
    this.rawModeCalls.push(enabled);
  }

  pause(): void {
    this.pauseCount += 1;
  }

  resume(): void {
    this.resumeCount += 1;
  }
}

class FakeOutput extends EventEmitter {
  readonly writes: string[] = [];

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }
}

class VirtualTerminal {
  readonly rows: string[][];
  x = 0;
  y = 0;
  private savedCursor: { x: number; y: number } | undefined;
  private pendingWrap = false;

  constructor(
    private readonly width = 80,
    height = 40
  ) {
    this.rows = Array.from({ length: height }, () => Array(width).fill(" "));
  }

  write(chunk: string): boolean {
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] === "\u001b") {
        if (chunk[index + 1] === "7") {
          this.savedCursor = { x: this.x, y: this.y };
          index += 1;
          continue;
        }
        if (chunk[index + 1] === "8") {
          if (this.savedCursor) {
            this.x = this.savedCursor.x;
            this.y = this.savedCursor.y;
          }
          this.pendingWrap = false;
          index += 1;
          continue;
        }
        if (chunk[index + 1] === "[") {
          let end = index + 2;
          while (end < chunk.length && !/[A-Za-z]/.test(chunk[end] ?? "")) end += 1;
          this.applyCsi(chunk.slice(index + 2, end), chunk[end] ?? "");
          index = end;
          continue;
        }
        continue;
      }

      const character = chunk[index] ?? "";
      if (character === "\r") {
        this.x = 0;
        this.pendingWrap = false;
      } else if (character === "\n") {
        if (this.pendingWrap) {
          this.y += 1;
        }
        this.y += 1;
        this.x = 0;
        this.pendingWrap = false;
      } else {
        this.writeCharacter(character);
      }
    }
    return true;
  }

  text(): string {
    return this.rows.map((row) => row.join("").trimEnd()).join("\n");
  }

  private writeCharacter(character: string): void {
    if (this.pendingWrap) {
      this.y += 1;
      this.x = 0;
      this.pendingWrap = false;
    }
    if (this.x >= this.width) {
      this.y += 1;
      this.x = 0;
    }
    this.rows[this.y]![this.x] = character;
    if (this.x === this.width - 1) {
      this.pendingWrap = true;
    } else {
      this.x += 1;
    }
  }

  private applyCsi(parameters: string, command: string): void {
    const value = Number(parameters || 1);
    if (command === "A") this.y = Math.max(0, this.y - value);
    if (command === "B") this.y = Math.min(this.rows.length - 1, this.y + value);
    if (command === "C") this.x = Math.min(this.width - 1, this.x + value);
    if (command === "D") this.x = Math.max(0, this.x - value);
    if (command === "H") {
      this.x = 0;
      this.y = 0;
    }
    if (command === "J" && parameters === "2") {
      for (const row of this.rows) row.fill(" ");
      this.x = 0;
      this.y = 0;
    }
    if (command === "K" && parameters === "2") {
      this.rows[this.y]?.fill(" ");
    }
    this.pendingWrap = false;
  }
}

function createTestInputController(): {
  readonly controller: RichInputController;
  readonly input: FakeInput;
  readonly output: FakeOutput;
} {
  const input = new FakeInput();
  const output = new FakeOutput();
  const options: RichInputControllerOptions = {
    input: input as unknown as RichInputControllerOptions["input"],
    output: output as unknown as RichInputControllerOptions["output"],
    width: () => 80,
    commands: [{ command: ":help", description: "Show help" }],
  };
  return { controller: new RichInputController(options), input, output };
}

function createTestInputControllerWithFooter(): {
  readonly controller: RichInputController;
  readonly input: FakeInput;
  readonly output: FakeOutput;
} {
  const input = new FakeInput();
  const output = new FakeOutput();
  const options = {
    input: input as unknown as RichInputControllerOptions["input"],
    output: output as unknown as RichInputControllerOptions["output"],
    width: () => 80,
    commands: [{ command: ":help", description: "Show help" }],
    footer: () => "  /workspace/project                                  default · local",
  } as unknown as RichInputControllerOptions;
  return { controller: new RichInputController(options), input, output };
}

async function expectReadToCancel(
  read: Promise<string | null>,
  message: string
): Promise<void> {
  const result = await Promise.race([
    read,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), 250);
    }),
  ]);
  assert.equal(result, null);
}

test("input reducer supports multiline editing and command palette filtering", () => {
  let state = createInputEditorState();
  state = reduceInputKey(state, key("h"));
  state = reduceInputKey(state, key("i"));
  state = reduceInputKey(state, key("shift+enter"));
  state = reduceInputKey(state, key("/"));

  assert.equal(state.value, "hi\n/");
  assert.equal(state.palette.open, true);
  assert.ok(state.palette.matches.some((item) => item.command === "/help"));
});

test("input reducer treats slash and colon as aliases for the same command palette", () => {
  const slash = reduceInputKey(
    createInputEditorState(),
    { type: "text", value: "/" },
    [{ command: ":help", description: "Show help" }]
  );
  const colon = reduceInputKey(
    createInputEditorState(),
    { type: "text", value: ":" },
    [{ command: ":help", description: "Show help" }]
  );

  assert.deepEqual(
    slash.palette.matches.map((item) => item.command.replace(/^[:/]/, "")),
    colon.palette.matches.map((item) => item.command.replace(/^[:/]/, ""))
  );
});

test("input reducer uses tab to complete a matching command without submitting", () => {
  let state = createInputEditorState();
  state = reduceInputKey(state, { type: "text", value: "/" });
  state = reduceInputKey(state, { type: "tab" }, [
    { command: "/help", description: "Show help" },
  ]);

  assert.equal(state.value, "/help");
  assert.equal(state.submitted, false);
});

test("input reducer submits an exact command match on the first Enter", () => {
  let state = createInputEditorState();
  state = reduceInputKey(state, { type: "text", value: "/" });
  state = reduceInputKey(state, { type: "text", value: "help" });
  state = reduceInputKey(state, { type: "enter", shift: false });

  assert.equal(state.submitted, true);
  assert.equal(state.submittedValue, "/help");
});

test("rich input fully cleans up when it receives Ctrl-C", async () => {
  const { controller, input } = createTestInputController();
  const read = controller.read();

  input.emit("data", "\u0003");

  await expectReadToCancel(read, "Ctrl-C should cancel the pending read");
  assert.deepEqual(input.rawModeCalls, [true, false]);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(input.listenerCount("end"), 0);
  assert.equal(input.pauseCount, 1);
});

test("rich input uses Escape to cancel an idle prompt", async () => {
  const { controller, input } = createTestInputController();
  const read = controller.read();

  input.emit("data", "\u001b");

  await expectReadToCancel(read, "Escape should cancel the pending read");
});

test("rich input treats visible caret notation as Ctrl-C", async () => {
  const { controller, input } = createTestInputController();
  const read = controller.read();

  input.emit("data", "^C");

  await expectReadToCancel(read, "visible ^C should cancel the pending read");
});

test("rich input positions the terminal cursor inside the editor", async () => {
  const { controller, output } = createTestInputController();

  const read = controller.read();
  const initialRender = output.writes.at(-1) ?? "";

  assert.match(initialRender, /\u001b7\u001b\[2A\r\u001b\[4C$/);
  controller.close();
  await read;
});

test("rich input renders the session footer below the editor", async () => {
  const { controller, output } = createTestInputControllerWithFooter();

  const read = controller.read();

  assert.match(output.writes.join(""), /\/workspace\/project/);
  assert.match(output.writes.join(""), /default · local/);
  controller.close();
  await read;
});

test("rich input restores the cursor below the editor when submitting", async () => {
  const { controller, input, output } = createTestInputController();
  const read = controller.read();

  input.emit("data", "\r");

  assert.equal(await read, "");
  assert.match(output.writes.join(""), /\u001b8/);
});

test("rich input can show the next composer before the next read starts", async () => {
  const { controller, input, output } = createTestInputController();
  const read = controller.read();

  input.emit("data", "hi\r");

  assert.equal(await read, "hi");
  const writesBefore = output.writes.length;

  controller.renderPendingPrompt();

  assert.ok(output.writes.length > writesBefore);
  assert.match(
    output.writes.slice(writesBefore).join(""),
    /\u001b7\u001b\[2A\r\u001b\[4C$/
  );
  assert.equal(input.listenerCount("data"), 0);
  assert.deepEqual(input.rawModeCalls, [true, false]);

  controller.hidePendingPrompt();
  controller.close();
});

test("rich input defers redraws while the composer is temporarily hidden", async () => {
  const { controller, input, output } = createTestInputController();
  const read = controller.read();

  controller.hidePendingPrompt();
  const writesBeforeInput = output.writes.length;

  input.emit("data", "queued");

  assert.equal(output.writes.length, writesBeforeInput);
  controller.renderPendingPrompt();
  assert.match(output.writes.at(-2) ?? "", /queued/);

  input.emit("data", "\u0003");
  await read;
});

test("rich input can suspend and resume without losing a draft", async () => {
  const { controller, input, output } = createTestInputController();
  const read = controller.read();

  input.emit("data", "draft");
  controller.suspend();
  input.emit("data", "lost-while-suspended");
  controller.resume();

  assert.match(output.writes.at(-2) ?? "", /draft/);
  assert.doesNotMatch(output.writes.at(-2) ?? "", /lost-while-suspended/);

  input.emit("data", "\u0003");
  await read;
  assert.deepEqual(input.rawModeCalls, [true, false, true, false]);
});

test("rich prompt queue re-arms the composer and preserves submission order", async () => {
  const { controller, input } = createTestInputController();
  const module = await import("../dist/tui-input.js") as unknown as {
    RichPromptQueue: new (controller: RichInputController) => {
      start(): void;
      next(): Promise<{ value: string; queued: boolean } | null>;
      close(): Promise<void>;
    };
  };
  const queue = new module.RichPromptQueue(controller);
  queue.start();

  const first = queue.next();
  input.emit("data", "first\r");
  assert.deepEqual(await first, { value: "first", queued: false });

  const second = queue.next();
  input.emit("data", "second\r");
  assert.deepEqual(await second, { value: "second", queued: false });

  const third = queue.next();
  input.emit("data", "third\r");
  assert.deepEqual(await third, { value: "third", queued: false });

  await queue.close();
  assert.deepEqual(input.rawModeCalls.slice(0, 6), [true, false, true, false, true, false]);
  assert.equal(input.rawModeCalls.at(-1), false);
});

test("rich prompt queue marks prompts that arrived during an active run", async () => {
  const { controller, input } = createTestInputController();
  const module = await import("../dist/tui-input.js") as unknown as {
    RichPromptQueue: new (controller: RichInputController) => {
      start(): void;
      next(): Promise<{ value: string; queued: boolean } | null>;
      close(): Promise<void>;
    };
  };
  const queue = new module.RichPromptQueue(controller);
  queue.start();

  const first = queue.next();
  input.emit("data", "first\r");
  assert.deepEqual(await first, { value: "first", queued: false });

  input.emit("data", "second\r");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(await queue.next(), { value: "second", queued: true });
  await queue.close();
});

test("rich input uses a blue truecolor frame", () => {
  const modulePath = fileURLToPath(new URL("../dist/tui-input.js", import.meta.url));
  const script = `import { createInputEditorState, renderInputEditor } from ${JSON.stringify(modulePath)};\nprocess.stdout.write(renderInputEditor(createInputEditorState(), 80).join("\\n"));`;
  const env = { ...process.env };
  delete env.NO_COLOR;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout;

  assert.match(output, /\u001b\[38;2;\d+;\d+;\d+m/);
  assert.match(output, /\u001b\[38;2;\d+;\d+;\d+m╭/);
});

test("rich input keeps its frame and footer inside the terminal width", async () => {
  const { renderInputEditor } = await import("../dist/tui-input.js");
  const lines = renderInputEditor(createInputEditorState(), 80);

  assert.ok(lines.every((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").length < 80));
});

test("rich input redraw replaces the old block instead of duplicating its footer", async () => {
  const input = new FakeInput();
  const terminal = new VirtualTerminal();
  const output = {
    on: () => undefined,
    off: () => undefined,
    write: (chunk: string): boolean => terminal.write(chunk),
  };
  const controller = new RichInputController({
    input: input as unknown as RichInputControllerOptions["input"],
    output: output as unknown as RichInputControllerOptions["output"],
    width: () => 80,
    commands: [],
    footer: () => "  ~/Desktop/dev-agent                         default · local",
  });
  const read = controller.read();

  input.emit("data", "h");
  input.emit("data", "i");

  const rendered = terminal.text();
  assert.equal(rendered.match(/default · local/g)?.length ?? 0, 1);
  assert.equal(rendered.match(/╭/g)?.length ?? 0, 1);

  input.emit("data", "\u0003");
  await read;
});
