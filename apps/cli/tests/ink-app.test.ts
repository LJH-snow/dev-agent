import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createElement } from "react";
import { render, renderToString } from "ink";
import { RuntimeEventSequence } from "@dev-agent/agent-core";

import { InkCliApp } from "../dist/ink/app.js";
import { InkRuntimeStore } from "../dist/ink/runtime-store.js";
import {
  createInkRenderOutput,
  normalizeInkTerminalSize,
} from "../dist/ink/terminal-size.js";
import { InkUiController } from "../dist/ink-ui.js";
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

function renderInkApp(
  stdin: PassThrough & NodeJS.ReadStream,
  stdout: Writable & NodeJS.WriteStream,
  onSubmit: (value: string) => void = () => undefined,
  store = new InkRuntimeStore(),
  debug = true,
  commands: readonly CommandHint[] = [],
) {
  return render(
    createElement(InkCliApp, {
      store,
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
      debug,
      incrementalRendering: false,
      exitOnCtrlC: false,
    },
  );
}

test("Ink displays run timings and the selected speed mode", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  store.setSpeedMode("fast");
  store.setSummary({
    status: "done",
    turns: 1,
    firstTokenMs: 1_234,
    totalMs: 4_000,
    queueMs: 120,
    modelMs: 3_000,
    toolMs: 500,
  });
  const instance = renderInkApp(stdin, stdout, () => undefined, store);
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const output = writes.join("");
    assert.match(output, /first-token=1234ms/);
    assert.match(output, /queue=120ms/);
    assert.match(output, /model=3000ms/);
    assert.match(output, /tool=500ms/);
    assert.match(output, /total=4000ms/);
    assert.match(output, /mode=fast/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink launch surface renders the Signal Loom mark, blue composer, footer, and tips", () => {
  const store = new InkRuntimeStore();
  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      mcpCount: 0,
      commands: [
        { command: ":help", description: "Show available commands" },
        { command: ":quit", description: "Exit the session" },
      ],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 100 },
  );

  assert.match(output, /SIGNAL LOOM/);
  assert.match(output, /Tips/);
  assert.match(output, /After a turn, wheel\/PageUp\/PageDown browse/);
  assert.match(output, /Type your message/);
  assert.match(output, /Desktop\/dev-agent/);
  assert.match(output, /default/);
  assert.match(output, /local/);
});

test("Ink command palette advertises the MCP capability center", () => {
  const output = renderToString(
    createElement(InkCliApp, {
      store: new InkRuntimeStore(),
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [
        { command: ":mcp status", description: "Inspect MCP health" },
      ],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 100 },
  );
  assert.match(output, /Type your message/);
});

test("Ink command palette advertises plan and apply workflow commands", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const instance = renderInkApp(stdin, stdout, () => undefined, undefined, true, DEFAULT_COMMAND_HINTS);

  try {
    stdin.write(":");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = writes.join("");
    assert.match(output, /:plan <request>/);
    assert.match(output, /:apply/);
    assert.match(output, /:history \[count\]/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink app renders the live collaboration panel from projected task events", () => {
  const store = new InkRuntimeStore();
  store.applyCollaborationEvent({
    type: "plan.ready",
    taskIds: ["coding"],
    tasks: [{
      id: "coding",
      title: "Coding",
      role: "coder",
      instructions: "Implement the requested change.",
    }],
  });
  store.applyCollaborationEvent({
    type: "task.started",
    taskId: "coding",
    attempt: 1,
    workspace: {
      id: "coding-workspace",
      path: "/private/tmp/coding-worktree",
      mode: "worktree",
    },
  });

  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: DEFAULT_COMMAND_HINTS,
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 100 },
  );

  assert.match(output, /TEAM EXECUTION · RUNNING/);
  assert.match(output, /CODING/);
  assert.equal(output.includes("/private/tmp/coding-worktree"), false);
});

test("Ink path completion shows workspace matches and Tab inserts the selected path", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const workingDirectory = await mkdtemp(join(tmpdir(), "dev-agent-ink-path-"));
  await mkdir(join(workingDirectory, "apps", "cli"), { recursive: true });
  const instance = render(
    createElement(InkCliApp, {
      store: new InkRuntimeStore(),
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory,
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
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

  try {
    stdin.write("@apps/");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.match(writes.join(""), /PATH COMPLETION/);
    assert.match(writes.join(""), /apps\/cli\//);

    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const output = writes.join("");
    assert.match(output, /› @apps\/cli\//);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
    await rm(workingDirectory, { recursive: true, force: true });
  }
});

test("Ink retry panel exposes r and Escape actions without re-adding the prompt", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  store.setRetry({ prompt: "fix tests", error: "provider unavailable" });
  let retries = 0;
  let dismissed = 0;
  const instance = render(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: process.cwd(),
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
      onRetry: () => {
        retries += 1;
      },
      onDismissRetry: () => {
        dismissed += 1;
        store.setRetry(undefined);
      },
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

  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.match(writes.join(""), /RUN FAILED/);
    assert.match(writes.join(""), /provider unavailable/);
    stdin.write("r");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(retries, 1);

    stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(dismissed, 1);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink composer keeps a visible cursor before an empty prompt", () => {
  const store = new InkRuntimeStore();
  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 52 },
  );

  assert.match(output, /› █Type your message/);
});

test("Ink puts an animated thinking marker beside the thinking status", () => {
  const store = new InkRuntimeStore();
  store.apply({
    version: 1,
    sequence: 1,
    emittedAt: new Date().toISOString(),
    sessionId: "default",
    runId: "run-thinking",
    type: "run.started",
    data: { prompt: "think", model: "qwen3:4b-instruct" },
  });
  store.apply({
    version: 1,
    sequence: 2,
    emittedAt: new Date().toISOString(),
    sessionId: "default",
    runId: "run-thinking",
    type: "run.status",
    data: { status: "thinking" },
  });

  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 80 },
  );

  assert.match(output, /Working · THINKING/);
  assert.match(output, /THINKING · 0\.0s/);
  assert.match(output, /✧|✦|✸|✹/);
});

test("Ink renders provider reasoning as a separate thinking transcript", () => {
  const store = new InkRuntimeStore();
  const emittedAt = new Date().toISOString();
  store.apply({
    version: 1,
    sequence: 1,
    emittedAt,
    sessionId: "default",
    runId: "run-reasoning",
    type: "run.started",
    data: { prompt: "explain", model: "qwen3:4b-instruct" },
  });
  store.apply({
    version: 1,
    sequence: 2,
    emittedAt,
    sessionId: "default",
    runId: "run-reasoning",
    type: "assistant.delta",
    data: { text: "先分析输入。", channel: "reasoning" },
  });

  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 80 },
  );

  assert.match(output, /Thinking 先分析输入。/);
});

test("Ink renders streamed assistant answers as Markdown blocks", () => {
  const store = new InkRuntimeStore();
  const emittedAt = new Date().toISOString();
  store.apply({
    version: 1,
    sequence: 1,
    emittedAt,
    sessionId: "default",
    runId: "run-markdown",
    type: "run.started",
    data: { prompt: "show markdown", model: "qwen3:4b-instruct" },
  });
  store.apply({
    version: 1,
    sequence: 2,
    emittedAt,
    sessionId: "default",
    runId: "run-markdown",
    type: "assistant.delta",
    data: {
      channel: "answer",
      text: "# Heading\n\n**bold** and `inline()`\n\n```ts\nconst value = 1;",
    },
  });

  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 80 },
  );

  assert.match(output, /▌ Heading/);
  assert.match(output, /code · ts/);
  assert.match(output, /bold/);
  assert.match(output, /inline\(\)/);
  assert.doesNotMatch(output, /\*\*bold\*\*/);
});

test("Ink advances the thinking marker while a run remains in thinking state", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  const emittedAt = new Date().toISOString();
  store.apply({
    version: 1,
    sequence: 1,
    emittedAt,
    sessionId: "default",
    runId: "run-animation",
    type: "run.started",
    data: { prompt: "think", model: "qwen3:4b-instruct" },
  });
  const instance = renderInkApp(stdin, stdout, () => undefined, store);

  await new Promise((resolve) => setTimeout(resolve, 260));

  assert.ok(
    writes.some((write) => /✧|✦|✸|✹/.test(write) && write.includes("THINKING")),
    "a later Ink frame should contain the next breathing phase",
  );
  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink advances the thought timer without a new runtime event", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  store.apply({
    version: 1,
    sequence: 1,
    emittedAt: new Date().toISOString(),
    sessionId: "default",
    runId: "run-timer",
    type: "run.started",
    data: { prompt: "measure", model: "qwen3:4b-instruct" },
  });
  const instance = renderInkApp(stdin, stdout, () => undefined, store);

  await new Promise((resolve) => setTimeout(resolve, 260));

  assert.ok(
    writes.some((write) => /THINKING · 0\.[2-9]s/.test(write)),
    "the elapsed thought time should update while the run is active",
  );
  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink rotates public status copy while a run remains active", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  const emittedAt = new Date().toISOString();
  store.apply({
    version: 1,
    sequence: 1,
    emittedAt,
    sessionId: "default",
    runId: "run-rotating-status",
    type: "run.started",
    data: { prompt: "inspect", model: "qwen3:4b-instruct" },
  });
  store.apply({
    version: 1,
    sequence: 2,
    emittedAt,
    sessionId: "default",
    runId: "run-rotating-status",
    type: "run.status",
    data: { status: "thinking" },
  });
  const instance = renderInkApp(stdin, stdout, () => undefined, store);

  await new Promise((resolve) => setTimeout(resolve, 420));

  assert.ok(
    writes.some((write) => write.includes("PLANNING NEXT STEP") && write.includes("Working")),
    "the status line should rotate to a second public phrase",
  );
  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink renders tools as a progress timeline and keeps approval input visible", () => {
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("tool-timeline-ui");
  store.apply(sequence.create(
    "run.started",
    { prompt: "inspect and edit", model: "qwen3:4b-instruct" },
    { runId: "run-timeline" },
  ));
  store.apply(sequence.create(
    "tool.started",
    { tool: "code-search", input: { query: "ToolTimeline" } },
    { runId: "run-timeline" },
  ));
  store.apply(sequence.create(
    "tool.progress",
    { tool: "code-search", progress: 1, total: 2, detail: "running 1/2" },
    { runId: "run-timeline" },
  ));
  store.apply(sequence.create(
    "tool.approval-requested",
    {
      tool: "filesystem",
      reason: "review required",
      review: {
        changeSetId: "timeline-review",
        additions: 1,
        deletions: 1,
        files: [
          {
            path: "src/app.ts",
            kind: "file",
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old();\n+next();\n",
            additions: 1,
            deletions: 1,
          },
        ],
      },
    },
    { runId: "run-timeline" },
  ));

  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 80 },
  );

  assert.match(output, /TOOL TIMELINE/);
  assert.match(output, /code-search/);
  assert.match(output, /running 1\/2/);
  assert.match(output, /APPROVAL/);
  assert.match(output, /DIFF PREVIEW/);
  assert.match(output, /next\(\)/);
  assert.match(output, /y \/ n/);
});

test("Ink pulses the approval card while the decision is still pending", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("approval-pulse-ui");
  store.apply(sequence.create(
    "run.started",
    { prompt: "inspect and edit", model: "qwen3:4b-instruct" },
    { runId: "run-approval-pulse" },
  ));
  store.apply(sequence.create(
    "tool.approval-requested",
    { tool: "filesystem", reason: "review required" },
    { runId: "run-approval-pulse" },
  ));

  const instance = renderInkApp(stdin, stdout, () => undefined, store);
  try {
    await new Promise((resolve) => setTimeout(resolve, 420));

    const approvalLines = writes.flatMap((write) =>
      write
        .split("\n")
        .filter((line) => line.includes("APPROVAL / APPROVAL")),
    );
    assert.ok(
      new Set(approvalLines).size >= 2,
      "the pending approval card should repaint through multiple pulse phases",
    );
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink app renders with the interactive controller attached", () => {
  const store = new InkRuntimeStore();
  const controller = new InkUiController();
  const output = renderToString(
    createElement(InkCliApp, {
      store,
      controller,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 80 },
  );

  assert.match(output, /Type your message/);
});

test("Ink app exposes the selected theme in the active footer", () => {
  const controller = new InkUiController();
  controller.setTheme("ember");
  const output = renderToString(
    createElement(InkCliApp, {
      store: new InkRuntimeStore(),
      controller,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 100 },
  );

  assert.match(output, /ember/);
});

test("Ink app renders history results in a dedicated panel", () => {
  const store = new InkRuntimeStore();
  store.setHistoryView({
    title: 'Search: "terminal" · showing 1 of 1 matches',
    rows: ["3. Tool (shell): npm test"],
  });
  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 100 },
  );

  assert.match(output, /Search: "terminal" · showing 1 of 1 matches/);
  assert.match(output, /3\. Tool \(shell\): npm test/);
});

test("Ink app renders the session picker with a selected row", () => {
  const store = new InkRuntimeStore();
  store.setSessionPicker({
    title: "SESSIONS",
    rows: ["default · 2 entries", "work · 4 entries"],
    selectedIndex: 0,
  });
  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 100 },
  );

  assert.match(output, /SESSIONS/);
  assert.match(output, /default · 2 entries/);
  assert.match(output, /Enter resume · esc close/);
});

test("Ink session picker uses arrows, Enter, and Escape without submitting a prompt", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  store.setSessionPicker({
    title: "SESSIONS",
    rows: ["default · 2 entries", "work · 4 entries"],
    selectedIndex: 0,
  });
  const selected: number[] = [];
  let dismissed = 0;
  const instance = render(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => {
        throw new Error("picker input must not submit a normal prompt");
      },
      onCancel: () => undefined,
      onExit: () => undefined,
      onSessionResume: (index) => selected.push(index),
      onDismissSessionPicker: () => {
        dismissed += 1;
        store.setSessionPicker(undefined);
      },
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

  try {
    stdin.write("\u001b[B");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.match(writes.join(""), /work · 4 entries/);

    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(selected, [1]);

    stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(dismissed, 1);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink launch surface shows queued prompts below the active transcript", () => {
  const store = new InkRuntimeStore();
  store.setQueuedPrompts(["second prompt"]);
  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/workspace/project",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 80 },
  );

  assert.match(output, /WAITING QUEUE/);
  assert.match(output, /second prompt/);
});

test("Ink clears the composer after submitting a prompt", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const submitted: string[] = [];
  const instance = renderInkApp(stdin, stdout, (value) => submitted.push(value));

  stdin.write("hi\r");
  await new Promise((resolve) => setTimeout(resolve, 50));

  const latestFrame = [...writes].reverse().find(
    (frame) => frame.includes("Type your message") || frame.includes("› hi"),
  ) ?? "";
  assert.deepEqual(submitted, ["hi"]);
  assert.doesNotMatch(latestFrame, /› hi/);
  assert.match(latestFrame, /Type your message/);
  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink replaces the previous composer frame instead of duplicating it", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const instance = renderInkApp(stdin, stdout);

  stdin.write("hi");
  await new Promise((resolve) => setTimeout(resolve, 50));

  const latestFrame = writes.at(-1) ?? "";
  assert.equal((latestFrame.match(/Type your message/g) ?? []).length, 0);
  assert.equal((latestFrame.match(/› hi/g) ?? []).length, 1);

  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink replaces the previous thought timer line instead of duplicating it", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  store.apply({
    version: 1,
    sequence: 1,
    emittedAt: new Date().toISOString(),
    sessionId: "default",
    runId: "run-single-thought",
    type: "run.started",
    data: { prompt: "think", model: "qwen3:4b-instruct" },
  });
  const instance = renderInkApp(stdin, stdout, () => undefined, store);

  await new Promise((resolve) => setTimeout(resolve, 260));

  const latestFrame = writes.at(-1) ?? "";
  assert.equal((latestFrame.match(/(?:✧|✦|✸|✹) THINKING ·/g) ?? []).length, 1);

  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink keeps the end cursor visible after horizontal navigation and backspace works there", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const instance = renderInkApp(stdin, stdout);

  stdin.write("你好");
  await new Promise((resolve) => setTimeout(resolve, 30));
  stdin.write("\u001b[D");
  await new Promise((resolve) => setTimeout(resolve, 30));
  stdin.write("\u001b[C");
  await new Promise((resolve) => setTimeout(resolve, 30));

  const endFrame = [...writes].reverse().find((frame) => frame.includes("› 你好")) ?? "";
  assert.match(endFrame, /› 你好█/, "the cursor should remain visible after the final character");

  stdin.write("\u007f");
  await new Promise((resolve) => setTimeout(resolve, 30));

  const afterBackspace = [...writes].reverse().find((frame) => frame.includes("› 你")) ?? "";
  assert.match(afterBackspace, /› 你█/, "backspace at the end should remove the final character");

  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink keeps short sessions compact instead of filling the terminal rows", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  const instance = renderInkApp(stdin, stdout, () => undefined, store, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  writes.length = 0;

  store.apply({
    version: 1,
    sequence: 1,
    emittedAt: new Date().toISOString(),
    sessionId: "default",
    runId: "run-1",
    type: "run.started",
    data: { prompt: "hi", model: "qwen3:4b-instruct" },
  });
  store.apply({
    version: 1,
    sequence: 2,
    emittedAt: new Date().toISOString(),
    sessionId: "default",
    runId: "run-1",
    type: "assistant.delta",
    data: { text: "hello", channel: "answer" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const frame = [...writes].reverse().find((write) => write.includes("default · local")) ?? "";
  const lines = frame.split("\n");
  const footerLine = lines.findIndex((line) => line.includes("default · local"));

  assert.ok(footerLine >= 0, "the footer should be rendered");
  assert.ok(footerLine < 20, `short content should not fill row 24, got row ${footerLine + 1}`);
  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink keeps active content compact in tall terminals", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  stdout.rows = 80;
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("tall-terminal-session");
  const instance = renderInkApp(stdin, stdout, () => undefined, store, false);

  await new Promise((resolve) => setTimeout(resolve, 20));
  writes.length = 0;
  store.apply(sequence.create(
    "run.started",
    { prompt: "hi", model: "qwen3:4b-instruct" },
    { runId: "run-tall" },
  ));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const frame = [...writes].reverse().find((write) => write.includes("default · local")) ?? "";
  const lines = frame.split("\n");
  const statusLine = lines.findIndex((line) => line.includes("Working ·"));
  const footerLine = lines.findIndex((line) => line.includes("default · local"));

  assert.ok(statusLine >= 0, "the active status should be rendered");
  assert.ok(footerLine >= 0, "the footer should be rendered");
  assert.ok(
    footerLine < 20,
    `active content should stay near the top in an 80-row terminal, got row ${footerLine + 1}`,
  );
  assert.ok(
    footerLine - statusLine < 8,
    "a tall terminal must not insert a viewport-sized gap before the composer footer",
  );

  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink keeps a sparse active turn adjacent to controls after history grows", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  stdout.rows = 60;
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("history-active-session");
  const instance = renderInkApp(stdin, stdout, () => undefined, store, false);

  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    writes.length = 0;
    for (let index = 0; index < 8; index += 1) {
      const runId = `history-run-${index}`;
      store.apply(sequence.create(
        "run.started",
        { prompt: `history prompt ${index}`, model: "qwen3:4b-instruct" },
        { runId },
      ));
      store.apply(sequence.create(
        "assistant.completed",
        { text: `history response ${index}` },
        { runId },
      ));
      store.apply(sequence.create(
        "run.completed",
        { turns: index + 1 },
        { runId },
      ));
    }
    store.apply(sequence.create(
      "run.started",
      { prompt: "hi", model: "qwen3:4b-instruct" },
      { runId: "history-active-run" },
    ));
    await new Promise((resolve) => setTimeout(resolve, 80));

    const frame = [...writes].reverse().find((write) => write.includes("Working ·")) ?? "";
    const lines = frame.split("\n");
    const promptLine = lines.findIndex((line) => line.trim() === "› hi");
    const statusLine = lines.findIndex((line) => line.includes("Working ·"));

    assert.ok(promptLine >= 0, "the active prompt should be visible");
    assert.ok(statusLine > promptLine, "the status should follow the active prompt");
    assert.ok(
      statusLine - promptLine < 8,
      "history should not leave a viewport-sized blank region before the controls",
    );
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink keeps the launch welcome out of the dynamic viewport", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  stdout.rows = 24;
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("welcome-scrollback-session");
  const instance = render(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      incrementalRendering: false,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
  writes.length = 0;
  store.apply(sequence.create(
    "run.started",
    { prompt: "hi", model: "qwen3:4b-instruct" },
    { runId: "run-welcome" },
  ));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(
    writes.some((write) => write.includes("\u001b[2J\u001b[3J\u001b[H")),
    false,
    "a live prompt should not clear terminal scrollback after the launch frame",
  );

  instance.unmount();
  stdin.destroy();
  stdout.destroy();
});

test("Ink keeps completed transcript in one bounded dynamic viewport", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("scrollback-session");
  const instance = render(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      exitOnCtrlC: false,
      incrementalRendering: false,
    },
  );

  try {
    store.apply(sequence.create(
      "run.started",
      { prompt: "first prompt", model: "qwen3:4b-instruct" },
      { runId: "run-1" },
    ));
    store.apply(sequence.create(
      "assistant.completed",
      { text: "first response" },
      { runId: "run-1" },
    ));
    store.apply(sequence.create(
      "run.completed",
      { turns: 1 },
      { runId: "run-1" },
    ));
    await new Promise((resolve) => setTimeout(resolve, 50));

    store.apply(sequence.create(
      "run.started",
      { prompt: "second prompt", model: "qwen3:4b-instruct" },
      { runId: "run-2" },
    ));
    store.apply(sequence.create(
      "assistant.delta",
      { text: "second response", channel: "answer" },
      { runId: "run-2" },
    ));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const finalOutput = renderToString(
      createElement(InkCliApp, {
        store,
        provider: "ollama",
        model: "qwen3:4b-instruct",
        sessionId: "default",
        workingDirectory: "/Users/Admin/Desktop/dev-agent",
        executor: "local",
        commands: [],
        onSubmit: () => undefined,
        onCancel: () => undefined,
        onExit: () => undefined,
      }),
      { columns: 80 },
    );
    assert.equal(
      (finalOutput.match(/first response/g) ?? []).length,
      1,
      "completed responses should remain visible exactly once in the viewport",
    );
    assert.equal(
      (finalOutput.match(/second response/g) ?? []).length,
      1,
      "the active response should not be duplicated",
    );
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink applies startup dimensions before mounting the incremental renderer", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  Object.assign(stdout, {
    columns: 0,
    rows: 0,
    getWindowSize: () => [0, 0] as const,
  });
  normalizeInkTerminalSize(stdout, {});
  const instance = render(
    createElement(InkCliApp, {
      store: new InkRuntimeStore(),
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      terminalRowsOffset: 1,
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout: createInkRenderOutput(stdout),
      stderr: stdout,
      exitOnCtrlC: false,
      incrementalRendering: true,
    },
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(stdout.columns, 80);
    assert.equal(stdout.rows, 24);
    assert.equal(
      writes.join("").includes("\u001b[2J\u001b[3J\u001b[H"),
      false,
      "the normalized startup frame must not clear terminal scrollback",
    );
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink does not clear terminal scrollback when a dynamic frame reaches the viewport limit", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const inkOutput = createInkRenderOutput(stdout);
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("viewport-fullscreen-session");
  const instance = render(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      terminalRowsOffset: 1,
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout: inkOutput,
      stderr: stdout,
      exitOnCtrlC: false,
      incrementalRendering: true,
    },
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    writes.length = 0;
    for (let index = 0; index < 8; index += 1) {
      const runId = `viewport-fullscreen-run-${index}`;
      store.apply(sequence.create(
        "run.started",
        { prompt: `queued prompt ${index}`, model: "qwen3:4b-instruct" },
        { runId },
      ));
      store.apply(sequence.create(
        "assistant.completed",
        { text: `queued response ${index}` },
        { runId },
      ));
      store.apply(sequence.create(
        "run.completed",
        { turns: index + 1 },
        { runId },
      ));
    }
    store.setQueuedPrompts(["next prompt"]);
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(
      writes.join("").includes("\u001b[2J\u001b[3J\u001b[H"),
      false,
      "a full dynamic frame must not clear terminal scrollback",
    );
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink navigates a long transcript with Home and End", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("viewport-navigation-session");
  const instance = render(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      exitOnCtrlC: false,
      incrementalRendering: false,
    },
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (let index = 0; index < 8; index += 1) {
      const runId = `viewport-run-${index}`;
      store.apply(sequence.create(
        "run.started",
        { prompt: `viewport prompt ${index}`, model: "qwen3:4b-instruct" },
        { runId },
      ));
      store.apply(sequence.create(
        "assistant.completed",
        { text: `viewport response ${index}` },
        { runId },
      ));
      store.apply(sequence.create(
        "run.completed",
        { turns: index + 1 },
        { runId },
      ));
    }
    store.setSummary({
      status: "done",
      turns: 8,
      usage: { promptTokens: 395, completionTokens: 59, totalTokens: 454 },
      totalMs: 4_612,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    writes.length = 0;

    stdin.write("\u001b[5~");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pageUpFrame = writes.join("");
    assert.match(pageUpFrame, /rows above/);
    assert.doesNotMatch(
      pageUpFrame,
      /\[state=done turns=8\]/,
      "the run summary should scroll with the transcript instead of staying pinned",
    );

    writes.length = 0;
    stdin.write("\u001b[H");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const oldestFrame = writes.join("");
    assert.match(oldestFrame, /viewport prompt 0/);
    assert.match(oldestFrame, /rows below/);
    assert.doesNotMatch(oldestFrame, /\[state=done turns=8\]/);

    writes.length = 0;
    store.apply(sequence.create(
      "run.started",
      { prompt: "queued while browsing", model: "qwen3:4b-instruct" },
      { runId: "viewport-run-live" },
    ));
    store.apply(sequence.create(
      "assistant.delta",
      { text: "new streamed output", channel: "answer" },
      { runId: "viewport-run-live" },
    ));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const scrolledStreamingFrame = writes.join("");
    assert.match(scrolledStreamingFrame, /new output below/);

    writes.length = 0;
    const beforeEnd = writes.length;
    stdin.write("\u001b[F");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const newestFrame = writes.slice(beforeEnd).join("");
    assert.match(newestFrame, /new streamed output/);
    assert.match(newestFrame, /\[usage\] prompt=395 completion=59 total=454/);
    assert.doesNotMatch(newestFrame, /rows below/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink navigates a long transcript with terminal mouse wheel events", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("mouse-wheel-session");
  const instance = render(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      exitOnCtrlC: false,
      incrementalRendering: false,
    },
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (let index = 0; index < 8; index += 1) {
      const runId = `mouse-wheel-run-${index}`;
      store.apply(sequence.create(
        "run.started",
        { prompt: `mouse prompt ${index}`, model: "qwen3:4b-instruct" },
        { runId },
      ));
      store.apply(sequence.create(
        "assistant.completed",
        { text: `mouse response ${index}` },
        { runId },
      ));
      store.apply(sequence.create(
        "run.completed",
        { turns: index + 1 },
        { runId },
      ));
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    writes.length = 0;

    stdin.write("\u001b[<64;12;8M");
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.match(writes.join(""), /rows above/);
    assert.equal(
      writes.join("").includes("[<64;12;8M"),
      false,
      "mouse tracking input must not be inserted into the composer",
    );
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink ignores terminal mouse clicks instead of inserting them into the composer", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const submitted: string[] = [];
  const instance = render(
    createElement(InkCliApp, {
      store: new InkRuntimeStore(),
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: (prompt) => submitted.push(prompt),
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout,
      stderr: stdout,
      exitOnCtrlC: false,
      incrementalRendering: false,
    },
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    writes.length = 0;

    stdin.write("\u001b[<0;38;9M\u001b[<0;38;9m");
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.doesNotMatch(writes.join(""), /\[<0;38;9[Mm]/);
    assert.deepEqual(submitted, []);

    stdin.write("h\r");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(submitted, ["h"]);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

test("Ink moves the submitted prompt into scrollback before the answer completes", () => {
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("prompt-scrollback-session");

  store.apply(sequence.create(
    "run.started",
    { prompt: "first prompt", model: "qwen3:4b-instruct" },
    { runId: "run-prompt" },
  ));

  const snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.committedTranscript.map((entry) => ({
      role: entry.role,
      text: entry.text,
      runId: entry.runId,
    })),
    [{ role: "user", text: "first prompt", runId: "run-prompt" }],
  );

  const output = renderToString(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    { columns: 80 },
  );

  assert.equal((output.match(/› first prompt/g) ?? []).length, 1);
  assert.match(output, /Type your message/);
});

test("Ink keeps a submitted prompt in one bounded live frame", async () => {
  const { stdin, stdout, writes } = createInkTerminal();
  const store = new InkRuntimeStore();
  const sequence = new RuntimeEventSequence("prompt-live-frame-session");
  const instance = render(
    createElement(InkCliApp, {
      store,
      provider: "ollama",
      model: "qwen3:4b-instruct",
      sessionId: "default",
      workingDirectory: "/Users/Admin/Desktop/dev-agent",
      executor: "local",
      commands: [],
      onSubmit: () => undefined,
      onCancel: () => undefined,
      onExit: () => undefined,
    }),
    {
      stdin,
      stdout: createInkRenderOutput(stdout),
      stderr: stdout,
      exitOnCtrlC: false,
      incrementalRendering: true,
    },
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    writes.length = 0;
    store.apply(sequence.create(
      "run.started",
      { prompt: "first prompt", model: "qwen3:4b-instruct" },
      { runId: "run-live-frame" },
    ));
    await new Promise((resolve) => setTimeout(resolve, 80));

    const liveFrame = [...writes].reverse().find((write) => write.includes("Working ·")) ?? "";
    assert.equal(
      (liveFrame.match(/› first prompt/g) ?? []).length,
      1,
      "the submitted prompt should be rendered exactly once beside the active run",
    );
    assert.match(liveFrame, /Working ·/);
  } finally {
    instance.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});
