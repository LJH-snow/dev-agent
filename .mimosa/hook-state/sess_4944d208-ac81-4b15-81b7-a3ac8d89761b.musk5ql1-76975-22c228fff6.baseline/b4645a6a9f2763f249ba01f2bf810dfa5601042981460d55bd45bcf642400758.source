import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimeEventSequence,
} from "@dev-agent/agent-core";
import { TuiSessionModel } from "../dist/tui-session.js";

test("projects one shared run into one prompt, assistant block, and tool card", () => {
  const sequence = new RuntimeEventSequence("adapter-session");
  const session = new TuiSessionModel();

  session.applyRuntimeEvent(
    sequence.create("run.started", { prompt: "inspect the project" }, { runId: "run-1" }),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "tool.started",
      { tool: "shell", input: { command: "pwd" } },
      { runId: "run-1" },
    ),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "tool.completed",
      { tool: "shell", output: "/workspace" },
      { runId: "run-1" },
    ),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "assistant.delta",
      { text: "The workspace is ready.", channel: "answer" },
      { runId: "run-1" },
    ),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "assistant.completed",
      { text: "The workspace is ready." },
      { runId: "run-1" },
    ),
  );
  session.applyRuntimeEvent(
    sequence.create("run.completed", { turns: 1 }, { runId: "run-1" }),
  );

  const snapshot = session.snapshot();
  assert.deepEqual(
    snapshot.transcript.map((entry) => [entry.role, entry.text]),
    [
      ["user", "inspect the project"],
      ["assistant", "The workspace is ready."],
    ],
  );
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.cards[0]?.name, "shell");
  assert.equal(snapshot.cards[0]?.status, "completed");
  assert.equal(snapshot.activeRunId, undefined);
});

test("projects provider reasoning into a separate transcript entry", () => {
  const sequence = new RuntimeEventSequence("reasoning-session");
  const session = new TuiSessionModel();

  session.applyRuntimeEvent(
    sequence.create("run.started", { prompt: "explain this" }, { runId: "run-1" }),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "assistant.delta",
      { text: "先分析输入。", channel: "reasoning" },
      { runId: "run-1" },
    ),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "assistant.delta",
      { text: "这是答案。", channel: "answer" },
      { runId: "run-1" },
    ),
  );

  assert.deepEqual(
    session.snapshot().transcript.map((entry) => [entry.role, entry.text]),
    [
      ["user", "explain this"],
      ["assistant", "这是答案。"],
      ["reasoning", "先分析输入。"],
    ],
  );
  assert.equal(session.snapshot().state, "streaming");
});

test("queued input is represented without starting a second run", () => {
  const sequence = new RuntimeEventSequence("queue-session");
  const session = new TuiSessionModel();

  session.applyRuntimeEvent(
    sequence.create("run.started", { prompt: "first" }, { runId: "run-1" }),
  );
  session.applyRuntimeEvent(
    sequence.create(
      "input.queued",
      { input: "second", position: 1, queueSize: 1 },
      { runId: "run-2" },
    ),
  );

  const snapshot = session.snapshot();
  assert.equal(snapshot.activeRunId, "run-1");
  assert.deepEqual(snapshot.queuedPrompts, ["second"]);
  assert.equal(snapshot.transcript.filter((entry) => entry.role === "user").length, 1);
});

test("replaying an already projected runtime sequence does not duplicate visible frames", () => {
  const sequence = new RuntimeEventSequence("replay-session");
  const session = new TuiSessionModel();
  const started = sequence.create(
    "run.started",
    { prompt: "first" },
    { runId: "run-1" },
  );

  session.applyRuntimeEvent(started);
  session.applyRuntimeEvent(started);

  const snapshot = session.snapshot();
  assert.deepEqual(
    snapshot.transcript.map((entry) => [entry.role, entry.text]),
    [
      ["user", "first"],
      ["assistant", ""],
    ],
  );
});
