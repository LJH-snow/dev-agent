import assert from "node:assert/strict";
import test from "node:test";

import { AgentTaskScheduler } from "@dev-agent/agent-core";
import {
  executeTaskCommand,
  formatTaskCommandResult,
  type TaskCommandResult,
} from "../dist/task-command.js";

async function createScheduler(): Promise<AgentTaskScheduler> {
  const scheduler = new AgentTaskScheduler({
    now: (() => {
      let tick = 0;
      return () => `2026-09-21T00:00:0${tick++}.000Z`;
    })(),
  });
  await scheduler.schedule({
    id: "run-1",
    run: async () => "secret model output",
  });
  return scheduler;
}

function handled(result: TaskCommandResult): Extract<TaskCommandResult, { handled: true }> {
  assert.equal(result.handled, true);
  if (!result.handled) {
    throw new Error("expected handled task command");
  }
  return result;
}

test("task command lists safe lifecycle metadata without prompt or runner output", async () => {
  const scheduler = await createScheduler();
  const result = handled(executeTaskCommand(":tasks", scheduler));
  assert.equal(result.kind, "list");
  const output = formatTaskCommandResult(result);
  assert.match(output, /run-1/);
  assert.match(output, /completed/);
  assert.doesNotMatch(output, /secret model output|\/Users\/|prompt text/i);
});

test("task command inspects one task and accepts slash aliases", async () => {
  const scheduler = await createScheduler();
  const result = handled(executeTaskCommand("/task run-1", scheduler));
  assert.equal(result.kind, "inspect");
  const output = formatTaskCommandResult(result);
  assert.match(output, /Task: run-1/);
  assert.match(output, /Status: completed/);
  assert.match(output, /Created:/);
});

test("task command reports usage and unknown ids", async () => {
  const scheduler = await createScheduler();
  const usage = handled(executeTaskCommand(":task", scheduler));
  assert.equal(usage.kind, "usage");
  assert.match(formatTaskCommandResult(usage), /:task <id>/);

  const unknown = handled(executeTaskCommand(":task missing", scheduler));
  assert.equal(unknown.kind, "unknown");
  assert.match(formatTaskCommandResult(unknown), /Unknown task: missing/);
});

test("ordinary prompts are not treated as task commands", async () => {
  const scheduler = await createScheduler();
  assert.deepEqual(executeTaskCommand("run tests", scheduler), { handled: false });
});
