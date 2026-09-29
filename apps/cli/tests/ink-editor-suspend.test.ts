import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MAX_EDITOR_CHARS,
  createGatedWriteOutput,
  editorTokensAreSafe,
  normalizeEditorContent,
  resolveEditorCommand,
  runExternalEditor,
} from "../dist/ink/editor-suspend.js";
import { InkRuntimeStore } from "../dist/ink/runtime-store.js";
import { DEFAULT_COMMAND_HINTS } from "../dist/tui-renderer.js";

interface FakeStdin {
  isTTY: boolean;
  isRaw: boolean | undefined;
  setRawMode: (raw: boolean) => FakeStdin;
}

function createFakeStdin(
  isRaw: boolean | undefined,
  record?: string[],
): FakeStdin & { rawStates: (boolean | undefined)[] } {
  const rawStates: (boolean | undefined)[] = [];
  const stdin: FakeStdin = {
    isTTY: true,
    isRaw,
    setRawMode(raw: boolean) {
      rawStates.push(raw);
      record?.push(raw ? "raw-on" : "raw-off");
      stdin.isRaw = raw;
      return stdin;
    },
  };
  return { ...stdin, rawStates, setRawMode: stdin.setRawMode };
}

test("editor resolution prefers VISUAL over EDITOR and defaults to vi", () => {
  assert.deepEqual(resolveEditorCommand({ VISUAL: "nano", EDITOR: "vim" }), {
    command: "nano",
    extraTokens: [],
  });
  assert.deepEqual(resolveEditorCommand({ EDITOR: "vim" }), { command: "vim", extraTokens: [] });
  assert.deepEqual(resolveEditorCommand({}), { command: "vi", extraTokens: [] });
  assert.deepEqual(resolveEditorCommand({ VISUAL: "   ", EDITOR: "" }), {
    command: "vi",
    extraTokens: [],
  });
  assert.deepEqual(resolveEditorCommand({ EDITOR: "code -w" }), {
    command: "code",
    extraTokens: ["-w"],
  });
});

test("editor token safety rejects shell metacharacters", () => {
  assert.equal(editorTokensAreSafe(["vi", "/usr/bin/vim"]), true);
  assert.equal(editorTokensAreSafe(["vi; rm"]), false);
  assert.equal(editorTokensAreSafe(["vi`id`"]), false);
  assert.equal(editorTokensAreSafe(["vi$(id)"]), false);
  assert.equal(editorTokensAreSafe(["vi|x"]), false);
  assert.equal(editorTokensAreSafe(["a\nb"]), false);
});

test("editor content normalizes newlines, strips one trailing newline, and caps length", () => {
  assert.deepEqual(normalizeEditorContent("hello\r\nworld\n"), {
    value: "hello\nworld",
    truncated: false,
  });
  assert.deepEqual(normalizeEditorContent("\n"), { value: "", truncated: false });
  assert.deepEqual(normalizeEditorContent("keep\n\n"), { value: "keep\n", truncated: false });

  const oversized = Array.from(
    { length: MAX_EDITOR_CHARS + 7 },
    (_, index) => String.fromCharCode(0x61 + (index % 26)),
  ).join("");
  const normalized = normalizeEditorContent(`${oversized}\n`);
  assert.equal(normalized.truncated, true);
  assert.equal(Array.from(normalized.value).length, MAX_EDITOR_CHARS);
});

test("gated output drops Ink frame writes while paused and forwards the rest", () => {
  const writes: string[] = [];
  const fake = {
    columns: 80,
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  const gate = createGatedWriteOutput(fake);

  gate.output.write("frame-1");
  assert.deepEqual(writes, ["frame-1"]);

  gate.setWritesPaused(true);
  assert.equal(gate.output.write("frame-2"), true);
  assert.deepEqual(writes, ["frame-1"], "suspended frames must not reach the terminal");

  gate.setWritesPaused(false);
  gate.output.write("frame-3");
  assert.deepEqual(writes, ["frame-1", "frame-3"]);
  assert.equal((gate.output as unknown as { columns?: number }).columns, 80);
});

test("runExternalEditor spawns the resolved editor behind `--`, returns content, and cleans up", () => {
  const calls: string[] = [];
  const stdin = createFakeStdin(true, calls);
  const tempDirs: string[] = [];
  let spawnedCommand: string | undefined;
  let spawnedArgs: readonly string[] | undefined;

  const outcome = runExternalEditor({
    env: { EDITOR: "my-editor" },
    platform: "darwin" as const,
    stdin,
    setInkWritesPaused: (paused) => calls.push(paused ? "pause" : "resume"),
    alternateScreen: {
      enter: () => calls.push("alt-enter"),
      exit: () => calls.push("alt-exit"),
    },
    spawnRunner: (command, args) => {
      spawnedCommand = command;
      spawnedArgs = [...args];
      calls.push("spawn");
      const file = args[args.length - 1];
      assert.equal(typeof file, "string");
      writeFileSync(file, "from the editor\n");
      return { status: 0, signal: null, error: undefined };
    },
    createTempDir: (prefix) => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      tempDirs.push(dir);
      return dir;
    },
  });

  assert.deepEqual(outcome, { status: "completed", value: "from the editor", truncated: false });
  assert.equal(spawnedCommand, "my-editor");
  assert.equal(spawnedArgs?.[0], "--", "the temp file must follow an option terminator");
  assert.equal(typeof spawnedArgs?.[1], "string");
  assert.deepEqual(calls, [
    "pause",
    "alt-exit",
    "raw-off",
    "spawn",
    "raw-on",
    "alt-enter",
    "resume",
  ]);
  assert.deepEqual(stdin.rawStates, [false, true]);
  assert.equal(existsSync(tempDirs[0]), false, "the temporary editor directory must be removed");
});

test("runExternalEditor refuses multi-token or unsafe editor values without spawning", () => {
  let spawnCalls = 0;
  const base = {
    platform: "darwin" as const,
    stdin: createFakeStdin(false),
    setInkWritesPaused: () => undefined,
    spawnRunner: () => {
      spawnCalls += 1;
      return { status: 0, signal: null, error: undefined };
    },
  };

  const flags = runExternalEditor({ ...base, env: { EDITOR: "code -w" } });
  assert.deepEqual(flags, { status: "refused", reason: "unsupported-editor-value" });

  const injected = runExternalEditor({ ...base, env: { EDITOR: "vi; rm -rf /" } });
  assert.deepEqual(injected, { status: "refused", reason: "unsupported-editor-value" });

  assert.equal(spawnCalls, 0, "refusals must never spawn an editor");
});

test("runExternalEditor reports failures with bounded detail and no content", () => {
  const base = {
    platform: "darwin" as const,
    stdin: createFakeStdin(false),
    setInkWritesPaused: () => undefined,
    createTempDir: (prefix: string) => mkdtempSync(join(tmpdir(), prefix)),
  };

  const signalled = runExternalEditor({
    ...base,
    spawnRunner: () => ({ status: null, signal: "SIGINT", error: undefined }),
  });
  assert.deepEqual(signalled, { status: "failed", detail: "editor terminated by SIGINT" });

  const exited = runExternalEditor({
    ...base,
    spawnRunner: () => ({ status: 1, signal: null, error: undefined }),
  });
  assert.deepEqual(exited, { status: "failed", detail: "editor exited with code 1" });

  const missing = runExternalEditor({
    ...base,
    env: { EDITOR: "definitely-missing-editor" },
    spawnRunner: () => ({
      status: null,
      signal: null,
      error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    }),
  });
  assert.deepEqual(missing, { status: "failed", detail: "editor failed to start: ENOENT" });
});

test("runExternalEditor treats empty or deleted buffers as empty outcomes", () => {
  const base = {
    platform: "darwin" as const,
    stdin: createFakeStdin(false),
    setInkWritesPaused: () => undefined,
    createTempDir: (prefix: string) => mkdtempSync(join(tmpdir(), prefix)),
  };

  const untouched = runExternalEditor({
    ...base,
    spawnRunner: () => ({ status: 0, signal: null, error: undefined }),
  });
  assert.deepEqual(untouched, { status: "empty" });

  const blank = runExternalEditor({
    ...base,
    spawnRunner: (_command, args) => {
      writeFileSync(args[args.length - 1] as string, "  \n\n");
      return { status: 0, signal: null, error: undefined };
    },
  });
  assert.deepEqual(blank, { status: "empty" });

  const deleted = runExternalEditor({
    ...base,
    spawnRunner: (_command, args) => {
      rmSync(args[args.length - 1] as string);
      return { status: 0, signal: null, error: undefined };
    },
  });
  assert.deepEqual(deleted, { status: "empty" });
});

test("runExternalEditor refuses without a TTY or on Windows without spawning", () => {
  let spawnCalls = 0;
  const spawnRunner = () => {
    spawnCalls += 1;
    return { status: 0, signal: null, error: undefined };
  };

  const notATty = runExternalEditor({
    platform: "darwin" as const,
    stdin: { isTTY: false, isRaw: false, setRawMode: () => undefined as never },
    spawnRunner,
  });
  assert.deepEqual(notATty, { status: "refused", reason: "not-a-tty" });

  const windows = runExternalEditor({
    platform: "win32" as const,
    stdin: createFakeStdin(false),
    spawnRunner,
  });
  assert.deepEqual(windows, { status: "refused", reason: "unsupported-platform" });

  assert.equal(spawnCalls, 0, "refusals must never spawn an editor");
});

test("runExternalEditor truncates oversized editor buffers to the bounded cap", () => {
  const oversized = Array.from(
    { length: MAX_EDITOR_CHARS * 2 },
    (_, index) => String.fromCharCode(0x61 + (index % 26)),
  ).join("");
  const outcome = runExternalEditor({
    platform: "darwin" as const,
    stdin: createFakeStdin(false),
    setInkWritesPaused: () => undefined,
    createTempDir: (prefix: string) => mkdtempSync(join(tmpdir(), prefix)),
    spawnRunner: (_command, args) => {
      writeFileSync(args[args.length - 1] as string, `${oversized}\n`);
      return { status: 0, signal: null, error: undefined };
    },
  });

  assert.equal(outcome.status, "completed");
  if (outcome.status === "completed") {
    assert.equal(outcome.truncated, true);
    assert.equal(Array.from(outcome.value).length, MAX_EDITOR_CHARS);
  }
});

test("composer inserts are exposed on the runtime snapshot with monotonic ids", () => {
  const store = new InkRuntimeStore();
  assert.equal(store.getSnapshot().composerInsert, undefined);

  store.setComposerInsert("first draft", false);
  const first = store.getSnapshot().composerInsert;
  assert.equal(first?.value, "first draft");
  assert.equal(first?.truncated, false);

  store.setComposerInsert("second draft", true);
  const second = store.getSnapshot().composerInsert;
  assert.ok(first !== undefined && second !== undefined);
  assert.ok(second.id > first.id, "each insert must carry a fresh id");
  assert.equal(second.value, "second draft");
  assert.equal(second.truncated, true);
});

test("the command palette and help advertise :editor", () => {
  assert.ok(
    DEFAULT_COMMAND_HINTS.some((hint) => hint.command === ":editor"),
    ":editor must be part of the default command hints",
  );
});
