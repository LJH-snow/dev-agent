import assert from "node:assert/strict";
import test from "node:test";

import { reviewCollaborationTaskToolScopes } from "../dist/collaboration-scope-review.js";
import type { CollaborationTask } from "@dev-agent/agent-core";

const tasks: readonly CollaborationTask[] = [
  {
    id: "first-task",
    title: "Inspect the codebase",
    role: "architect",
    instructions: "Read the repository and identify implementation boundaries.",
  },
  {
    id: "second-task",
    title: "Implement the change",
    role: "coder",
    instructions: "Implement only after the inspection task completes.",
    dependsOn: ["first-task"],
    maxAttempts: 2,
  },
];

const availableToolNames = ["filesystem", "search"];

test("scope review returns immutable ordered scopes bound to the full normalized plan", async () => {
  const prompts: string[] = [];
  const answers = ["all", "none", "yes"];
  const review = await reviewCollaborationTaskToolScopes({
    tasks,
    availableToolNames,
    ask: async (prompt) => {
      prompts.push(prompt);
      return answers.shift() ?? "";
    },
  });

  assert.equal(review.status, "confirmed");
  if (review.status !== "confirmed") return;

  assert.deepEqual(review.tasks.map((task) => task.id), ["first-task", "second-task"]);
  assert.equal(Object.isFrozen(review.tasks), true);
  assert.equal(Object.isFrozen(review.tasks[1]?.dependsOn), true);
  assert.deepEqual(review.reviewedToolScopes.scopesByTaskIndex, [
    ["filesystem", "search"],
    [],
  ]);
  assert.equal(Object.isFrozen(review.reviewedToolScopes.scopesByTaskIndex), true);
  assert.match(review.reviewedToolScopes.planFingerprint, /^[a-f0-9]{64}$/u);
  assert.match(prompts[1] ?? "", /Depends on: slot 1/u);
  assert.match(prompts[2] ?? "", /TEAM PLAN \+ TOOL SCOPE REVIEW \(complete normalized plan\)/u);
  assert.match(prompts[2] ?? "", /Depends on slots: #1/u);
  assert.match(prompts[2] ?? "", /Granted tools: \(no tools\)/u);
  assert.match(prompts[1] ?? "", /Implement only after the inspection task completes\./u);
});

test("scope review retries unknown and duplicate names without accepting them", async () => {
  const prompts: string[] = [];
  const answers = ["shell", "filesystem,filesystem", "filesystem", "search", "yes"];
  const review = await reviewCollaborationTaskToolScopes({
    tasks,
    availableToolNames,
    ask: async (prompt) => {
      prompts.push(prompt);
      return answers.shift() ?? "";
    },
  });

  assert.equal(review.status, "confirmed");
  if (review.status !== "confirmed") return;
  assert.deepEqual(review.reviewedToolScopes.scopesByTaskIndex, [["filesystem"], ["search"]]);
  assert.match(prompts[1] ?? "", /Tool not available in this ceiling/u);
  assert.match(prompts[2] ?? "", /Duplicate tool name/u);
  assert.equal(prompts.length, 5);
});

test("empty input cancels before the complete plan confirmation", async () => {
  let promptCount = 0;
  const review = await reviewCollaborationTaskToolScopes({
    tasks,
    availableToolNames,
    ask: async () => {
      promptCount += 1;
      return "";
    },
  });

  assert.deepEqual(review, { status: "cancelled" });
  assert.equal(promptCount, 1);
});

test("declining the full ordered plan and scope summary cancels", async () => {
  const answers = ["all", "none", "no"];
  const review = await reviewCollaborationTaskToolScopes({
    tasks,
    availableToolNames,
    ask: async () => answers.shift() ?? "",
  });

  assert.deepEqual(review, { status: "cancelled" });
});

test("terminal controls are sanitized, credential-shaped text is redacted, and the normalized plan is shown", async () => {
  const prompts: string[] = [];
  const review = await reviewCollaborationTaskToolScopes({
    tasks: [{
      id: "safe-task",
      title: "Inspect terminal text",
      instructions: "Read this text \u001b]0;spoofed title\u0007 safely; token=super-secret-value.",
      dependsOn: [],
    }],
    availableToolNames,
    ask: async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? "search" : "yes";
    },
  });

  assert.equal(review.status, "confirmed");
  assert.equal(prompts.some((prompt) => prompt.includes("\u001b")), false);
  assert.equal(prompts.some((prompt) => prompt.includes("spoofed title")), false);
  assert.match(prompts[0] ?? "", /Read this text/u);
  assert.match(prompts[0] ?? "", /token=\[redacted\]/u);
  assert.doesNotMatch(prompts.join("\n"), /super-secret-value/u);
  assert.match(prompts[1] ?? "", /Granted tools: "search"/u);
});

test("oversized full-plan reviews fail before asking for any tool grant", async () => {
  let promptCount = 0;
  const oversizedTasks = Array.from({ length: 8 }, (_, index): CollaborationTask => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    instructions: "Inspect a bounded task description.",
  }));
  const oversizedToolNames = Array.from(
    { length: 256 },
    (_, index) => `tool${index}-${"x".repeat(120)}`,
  );

  await assert.rejects(
    reviewCollaborationTaskToolScopes({
      tasks: oversizedTasks,
      availableToolNames: oversizedToolNames,
      ask: async () => {
        promptCount += 1;
        return "none";
      },
    }),
    /exceed the safe review limit/u,
  );
  assert.equal(promptCount, 0);
});

test("long unknown tool names are not echoed into bounded retry prompts", async () => {
  const prompts: string[] = [];
  const answers = ["x".repeat(30_000), "none", "yes"];
  const review = await reviewCollaborationTaskToolScopes({
    tasks: [{ id: "bounded", title: "Bounded retry", instructions: "Choose a safe scope." }],
    availableToolNames,
    ask: async (prompt) => {
      prompts.push(prompt);
      return answers.shift() ?? "";
    },
  });

  assert.equal(review.status, "confirmed");
  assert.equal(prompts.length, 3);
  assert.match(prompts[1] ?? "", /Tool not available in this ceiling/u);
  assert.ok((prompts[1]?.length ?? Infinity) < 2_000);
  assert.doesNotMatch(prompts[1] ?? "", /x{256}/u);
});

test("worst-case retry prompts are included in the total review budget", async () => {
  let promptCount = 0;
  const largeInstructions = Array.from({ length: 8 }, (_, index): CollaborationTask => ({
    id: `bounded-${index}`,
    title: `Task ${index}`,
    instructions: "x".repeat(11_000),
  }));

  await assert.rejects(
    reviewCollaborationTaskToolScopes({
      tasks: largeInstructions,
      availableToolNames,
      ask: async () => {
        promptCount += 1;
        return "none";
      },
    }),
    /exceed the safe review limit/u,
  );
  assert.equal(promptCount, 0);
});

test("abort while waiting for scope input rejects instead of releasing a grant", async () => {
  const controller = new AbortController();
  const review = reviewCollaborationTaskToolScopes({
    tasks,
    availableToolNames,
    signal: controller.signal,
    ask: async (_prompt, signal) => await new Promise<string>((resolve) => {
      signal?.addEventListener("abort", () => resolve("all"), { once: true });
    }),
  });

  controller.abort();
  await assert.rejects(review);
});
