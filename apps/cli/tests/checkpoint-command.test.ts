import assert from "node:assert/strict";
import test from "node:test";

import { executeCheckpointCommand } from "../dist/checkpoint-command.js";

test("checkpoint command creates and lists bounded session anchors", async () => {
  let nextId = 0;
  const checkpoints = [];
  const store = {
    async create() {
      const checkpoint = {
        id: `checkpoint-${++nextId}`,
        sessionId: "test-session",
        createdAt: "2026-09-20T00:00:00.000Z",
        entryCount: nextId,
        changeSetIds: [],
      };
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    async list() {
      return checkpoints;
    },
    async inspect(id: string) {
      return checkpoints.find((checkpoint) => checkpoint.id === id);
    },
    async restore(id: string) {
      throw new Error(`unused restore ${id}`);
    },
    async rewind(id: string) {
      const checkpoint = checkpoints.find((candidate) => candidate.id === id);
      if (!checkpoint) throw new Error(`unknown checkpoint: ${id}`);
      return {
        checkpoint,
        removedEntryCount: 2,
        remainingEntryCount: checkpoint.entryCount,
        retainedCheckpointIds: [checkpoint.id],
        changeSetIds: [],
        workspaceChanged: false as const,
      };
    },
  };

  const created = await executeCheckpointCommand(":checkpoint", store);
  assert.equal(created.handled, true);
  assert.match(created.message ?? "", /Checkpoint created: checkpoint-1/);
  assert.match(created.message ?? "", /conversation history only/i);

  const listed = await executeCheckpointCommand("/checkpoints", store);
  assert.equal(listed.handled, true);
  assert.match(listed.message ?? "", /checkpoint-1/);
  assert.match(listed.message ?? "", /1 entr/);

  const rewound = await executeCheckpointCommand(":rewind checkpoint-1", store);
  assert.equal(rewound.handled, true);
  assert.match(rewound.message ?? "", /removed 2 entries/);
  assert.match(rewound.message ?? "", /workspace unchanged/);
});

test("unknown input is left for the prompt runner", async () => {
  const result = await executeCheckpointCommand(":model", {} as never);
  assert.deepEqual(result, { handled: false });
});
