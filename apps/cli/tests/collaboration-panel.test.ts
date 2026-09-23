import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import type {
  CollaborationExecutionEvent,
  CollaborationTaskResult,
} from "@dev-agent/agent-core";
import { InkRuntimeStore } from "../dist/ink/runtime-store.js";
import { CollaborationPanel } from "../dist/ink/collaboration-panel.js";

const tasks = [
  {
    id: "architecture",
    title: "Architecture",
    role: "architect",
    instructions: "Define the implementation boundary.",
  },
  {
    id: "coding",
    title: "Coding",
    role: "coder",
    instructions: "Implement the requested change.",
    dependsOn: ["architecture"],
  },
  {
    id: "testing",
    title: "Testing",
    role: "tester",
    instructions: "Verify the change.",
    dependsOn: ["architecture"],
  },
  {
    id: "review",
    title: "Review",
    role: "reviewer",
    instructions: "Review the combined result.",
    dependsOn: ["coding", "testing"],
  },
] as const;

function apply(store: InkRuntimeStore, event: CollaborationExecutionEvent): void {
  store.applyCollaborationEvent(event);
}

function result(
  taskId: string,
  status: CollaborationTaskResult["status"],
  overrides: Partial<CollaborationTaskResult> = {},
): CollaborationTaskResult {
  return {
    id: taskId,
    title: taskId,
    role: taskId,
    dependsOn: [],
    status,
    attempts: 1,
    durationMs: 1200,
    text: "bounded result",
    ...overrides,
  };
}

test("Ink runtime store projects collaboration task events without workspace paths", () => {
  const store = new InkRuntimeStore();

  apply(store, {
    type: "plan.ready",
    taskIds: tasks.map((task) => task.id),
    tasks,
  });
  apply(store, {
    type: "task.started",
    taskId: "coding",
    attempt: 1,
    workspace: {
      id: "workspace-coding",
      path: "/private/tmp/secret-worktree",
      mode: "worktree",
    },
  });
  apply(store, {
    type: "task.retrying",
    taskId: "coding",
    attempt: 1,
    error: "temporary provider failure",
  });

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.collaboration?.status, "running");
  assert.deepEqual(
    snapshot.collaboration?.tasks.map((task) => [task.id, task.status]),
    [
      ["architecture", "queued"],
      ["coding", "retrying"],
      ["testing", "queued"],
      ["review", "queued"],
    ],
  );
  assert.equal(snapshot.collaboration?.tasks.find((task) => task.id === "coding")?.attempts, 1);
  assert.equal(JSON.stringify(snapshot).includes("/private/tmp/secret-worktree"), false);
});

test("Ink runtime store projects a mergeable review and completion status", () => {
  const store = new InkRuntimeStore();
  apply(store, { type: "plan.ready", taskIds: tasks.map((task) => task.id), tasks });
  apply(store, {
    type: "task.completed",
    taskId: "architecture",
    result: result("architecture", "completed", {
      diff: { changedFiles: ["src/architecture.ts"], additions: 4, deletions: 0 },
    }),
  });
  apply(store, {
    type: "review.ready",
    review: {
      status: "ready",
      mergeable: true,
      tasks: [result("architecture", "completed")],
      changedFiles: ["src/architecture.ts"],
      additions: 4,
      deletions: 0,
      conflicts: [],
    },
  });
  apply(store, { type: "execution.completed", status: "review" });

  const collaboration = store.getSnapshot().collaboration;
  assert.equal(collaboration?.status, "review");
  assert.equal(collaboration?.review?.mergeable, true);
  assert.deepEqual(collaboration?.review?.changedFiles, ["src/architecture.ts"]);
  assert.equal(collaboration?.review?.additions, 4);
});

test("collaboration panel shows review and retry actions but not private workspace paths", () => {
  const store = new InkRuntimeStore();
  apply(store, { type: "plan.ready", taskIds: tasks.map((task) => task.id), tasks });
  apply(store, {
    type: "task.failed",
    taskId: "coding",
    result: result("coding", "failed", {
      error: "model failed in /private/tmp/secret-worktree",
    }),
  });
  apply(store, {
    type: "review.ready",
    review: {
      status: "blocked",
      mergeable: false,
      tasks: [result("coding", "failed")],
      changedFiles: [],
      additions: 0,
      deletions: 0,
      conflicts: ["coding"],
    },
  });
  apply(store, { type: "execution.completed", status: "failed" });

  const output = renderToString(
    createElement(CollaborationPanel, {
      collaboration: store.getSnapshot().collaboration,
      columns: 100,
    }),
    { columns: 100 },
  );

  assert.match(output, /TEAM EXECUTION/);
  assert.match(output, /ARCHITECTURE/);
  assert.match(output, /CODING/);
  assert.match(output, /:team retry coding/);
  assert.match(output, /conflict/i);
  assert.equal(output.includes("/private/tmp/secret-worktree"), false);
});
