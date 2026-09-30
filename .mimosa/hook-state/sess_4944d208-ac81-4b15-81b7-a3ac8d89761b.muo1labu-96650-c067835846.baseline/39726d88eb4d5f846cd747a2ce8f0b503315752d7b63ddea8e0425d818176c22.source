import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeEventSequence } from "@dev-agent/agent-core";
import {
  projectRuntimeEvent,
  type StreamEvent,
} from "../dist/chat-session.js";

test("projects every shared event as one transport event with its run id", () => {
  const sequence = new RuntimeEventSequence("desktop-adapter-session");
  const shared = [
    sequence.create("run.started", { prompt: "hello" }, { runId: "run-1" }),
    sequence.create(
      "assistant.delta",
      { text: "hi", channel: "answer" },
      { runId: "run-1" },
    ),
    sequence.create("run.completed", { turns: 1 }, { runId: "run-1" }),
  ];

  const projected: StreamEvent[] = shared.map(projectRuntimeEvent);

  assert.deepEqual(projected.map((event) => event.type), ["runtime", "runtime", "runtime"]);
  assert.deepEqual(
    projected.map((event) => (event.data.event as { runId?: string }).runId),
    ["run-1", "run-1", "run-1"],
  );
  assert.deepEqual(
    projected.map((event) => (event.data.event as { sequence: number }).sequence),
    [1, 2, 3],
  );
});
