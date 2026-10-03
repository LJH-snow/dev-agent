import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  InMemoryMemory,
  createAgentContext,
} from "../dist/index.js";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function context(sessionId: string) {
  return createAgentContext(sessionId, new InMemoryMemory(), {
    workingDirectory: "/workspace",
  });
}

test("an attached context block reaches the model without changing the visible prompt", async () => {
  const calls: Array<readonly { readonly role: string; readonly content: string }[]> = [];
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat(messages) {
        calls.push(messages);
        return { content: "done", toolCalls: [] };
      },
    },
  });

  await loop.run(context("attached-context"), "explain @src.ts", {
    runId: "run-attached-context",
    attachedContext: "<attachment path=\"src.ts\">const answer = 42;</attachment>",
  } as any);

  assert.equal(calls[0]?.at(-1)?.content, "explain @src.ts");
  assert.ok(calls[0]?.some((message) => message.content.includes("const answer = 42;")));
});

test("plan mode denies mutating tools while allowing the model to finish", async () => {
  const tools = new AgentToolRegistry();
  let executions = 0;
  tools.register({
    name: "filesystem",
    description: "Changes files.",
    metadata: {
      risk: "mutating",
      confirmation: "on-risk",
      resultFormat: "json",
      supportsProgress: false,
    },
    async execute() {
      executions += 1;
      return "mutated";
    },
  });

  let calls = 0;
  const messages: Array<readonly { readonly role: string; readonly content: string }[]> = [];
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat(input) {
        messages.push(input);
        calls += 1;
        return calls === 1
          ? {
              content: "",
              toolCalls: [{
                id: "write-1",
                name: "filesystem",
                input: { action: "write", path: "src.ts", content: "changed" },
              }],
            }
          : { content: "plan complete", toolCalls: [] };
      },
    },
    tools,
  });

  const result = await loop.run(context("plan-mode"), "plan a change", {
    runId: "run-plan-mode",
    mode: "plan",
  } as any);

  assert.equal(result.state.status, "done");
  assert.equal(executions, 0);
  assert.match(messages[1]?.map((message) => message.content).join("\n") ?? "", /plan mode/i);
});

test("plan mode blocks tools without an explicit risk classification", async () => {
  const tools = new AgentToolRegistry();
  let executions = 0;
  tools.register({
    name: "remote:publish",
    description: "Publishes an external artifact.",
    async execute() {
      executions += 1;
      return "published";
    },
  });

  let calls = 0;
  const messages: Array<readonly { readonly role: string; readonly content: string }[]> = [];
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat(input) {
        messages.push(input);
        calls += 1;
        return calls === 1
          ? {
              content: "",
              toolCalls: [{ id: "publish-1", name: "remote:publish", input: {} }],
            }
          : { content: "plan complete", toolCalls: [] };
      },
    },
    tools,
  });

  const result = await loop.run(context("plan-unclassified-tool"), "publish it", {
    mode: "plan",
  } as any);

  assert.equal(result.state.status, "done");
  assert.equal(executions, 0);
  assert.match(messages[1]?.map((message) => message.content).join("\n") ?? "", /plan mode/i);
});

test("approval requests receive trusted metadata from the tool registry", async () => {
  const tools = new AgentToolRegistry();
  let executions = 0;
  tools.register({
    name: "remote:publish",
    description: "Publishes an external artifact.",
    metadata: { risk: "dangerous", confirmation: "always" },
    async execute() {
      executions += 1;
      return "published";
    },
  });

  let calls = 0;
  let observedMetadata: unknown;
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat() {
        calls += 1;
        return calls === 1
          ? {
              content: "",
              toolCalls: [{ id: "publish-1", name: "remote:publish", input: {} }],
            }
          : { content: "done", toolCalls: [] };
      },
    },
    tools,
    approval: {
      decide(request) {
        observedMetadata = request.metadata;
        return { decision: "deny", reason: "test denial" };
      },
    },
  });

  const result = await loop.run(context("approval-metadata"), "publish it");

  assert.equal(result.state.status, "done");
  assert.deepEqual(observedMetadata, {
    risk: "dangerous",
    confirmation: "always",
  });
  assert.equal(executions, 0);
});

test("plan mode permits explicitly classified read-only external tools", async () => {
  const tools = new AgentToolRegistry();
  let executions = 0;
  tools.register({
    name: "remote:status",
    description: "Reads external status.",
    metadata: { risk: "read-only", confirmation: "never" },
    async execute() {
      executions += 1;
      return "ready";
    },
  });

  let calls = 0;
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat() {
        calls += 1;
        return calls === 1
          ? {
              content: "",
              toolCalls: [{ id: "status-1", name: "remote:status", input: {} }],
            }
          : { content: "plan complete", toolCalls: [] };
      },
    },
    tools,
  });

  const result = await loop.run(context("plan-readonly-tool"), "inspect it", {
    mode: "plan",
  } as any);

  assert.equal(result.state.status, "done");
  assert.equal(executions, 1);
});

test("plan mode allows read-only git inspection even when git is conservatively classified", async () => {
  const tools = new AgentToolRegistry();
  let executions = 0;
  tools.register({
    name: "git",
    description: "Runs git commands.",
    metadata: {
      risk: "mutating",
      confirmation: "on-risk",
      resultFormat: "text",
      supportsProgress: false,
    },
    async execute() {
      executions += 1;
      return "diff --stat";
    },
  });

  let calls = 0;
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat() {
        calls += 1;
        return calls === 1
          ? {
              content: "",
              toolCalls: [{
                id: "git-read-1",
                name: "git",
                input: { args: ["diff", "--stat"] },
              }],
            }
          : { content: "plan complete", toolCalls: [] };
      },
    },
    tools,
  });

  const result = await loop.run(context("plan-git-read"), "inspect changes", {
    mode: "plan",
  } as any);

  assert.equal(result.state.status, "done");
  assert.equal(executions, 1);
});

test("plan mode reports a filesystem preview without mutating the workspace", async () => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "dev-agent-plan-preview-"));
  const review = {
    changeSetId: "plan-preview-change-set",
    files: [{
      path: "hello.txt",
      kind: "file" as const,
      afterHash: "a".repeat(64),
      diff: "--- a/hello.txt\n+++ b/hello.txt\n@@ -0,0 +1,1 @@\n+hello\n",
      additions: 1,
      deletions: 0,
      beforeExists: false,
      afterExists: true,
    }],
    additions: 1,
    deletions: 0,
    createdAt: "2026-09-22T00:00:00.000Z",
  };
  const filesystem = {
    name: "filesystem",
    description: "test filesystem",
    metadata: {
      risk: "mutating" as const,
      confirmation: "on-risk" as const,
      resultFormat: "json" as const,
      supportsProgress: false,
    },
    async execute(input: unknown) {
      const action = (input as { action?: string }).action;
      if (action === "preview") {
        return { ok: true, review, executeInput: { action: "apply", changeSetId: review.changeSetId } };
      }
      throw new Error(`unexpected filesystem action: ${action}`);
    },
  };
  const tools = new AgentToolRegistry().register(filesystem);
  let calls = 0;
  let captured:
    | {
        readonly changeSetId: string;
        readonly files: readonly { readonly path: string; readonly diff: string }[];
      }
    | undefined;
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat() {
        calls += 1;
        return calls === 1
          ? {
              content: "",
              toolCalls: [{
                id: "preview-1",
                name: "filesystem",
                input: {
                  action: "preview",
                  changes: [{
                    action: "write",
                    path: "hello.txt",
                    content: "hello\n",
                  }],
                },
              }],
            }
          : { content: "Plan: create hello.txt with a greeting.", toolCalls: [] };
      },
    },
    tools,
    onPlanReview: (review) => {
      captured = review;
    },
  });

  const result = await loop.run(
    createAgentContext("plan-preview", new InMemoryMemory(), {
      workingDirectory,
    }),
    "add a greeting file",
    { mode: "plan" },
  );

  assert.equal(result.state.status, "done");
  assert.equal(calls, 2);
  assert.ok(captured);
  assert.equal(captured?.changeSetId.length > 0, true);
  assert.equal(captured?.files[0]?.path, "hello.txt");
  assert.match(captured?.files[0]?.diff ?? "", /\+hello/);
  await assert.rejects(() => stat(join(workingDirectory, "hello.txt")));
});

test("applying a prepared plan changes files without starting another model turn", async () => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "dev-agent-plan-apply-"));
  const review = {
    changeSetId: "plan-apply-change-set",
    files: [{
      path: "applied.txt",
      kind: "file" as const,
      afterHash: "b".repeat(64),
      diff: "--- a/applied.txt\n+++ b/applied.txt\n@@ -0,0 +1,1 @@\n+applied\n",
      additions: 1,
      deletions: 0,
      beforeExists: false,
      afterExists: true,
    }],
    additions: 1,
    deletions: 0,
    createdAt: "2026-09-22T00:00:00.000Z",
  };
  const filesystem = {
    name: "filesystem",
    description: "test filesystem",
    metadata: {
      risk: "mutating" as const,
      confirmation: "on-risk" as const,
      resultFormat: "json" as const,
      supportsProgress: false,
    },
    async execute(input: unknown, context?: { workingDirectory: string }) {
      const action = (input as { action?: string }).action;
      if (action === "apply") {
        await writeFile(join(context?.workingDirectory ?? workingDirectory, "applied.txt"), "applied\n");
        return {
          ok: true,
          changeSetId: review.changeSetId,
          files: review.files,
          additions: review.additions,
          deletions: review.deletions,
        };
      }
      throw new Error(`unexpected filesystem action: ${action}`);
    },
  };
  const tools = new AgentToolRegistry().register(filesystem);
  let modelCalls = 0;
  const memory = new InMemoryMemory();
  const loop = new AgentLoop({
    model: {
      id: "openai",
      model: "test-model",
      async chat() {
        modelCalls += 1;
        return { content: "unexpected", toolCalls: [] };
      },
    },
    tools,
  });

  const result = await loop.applyPlannedChangeSet(
    createAgentContext("plan-apply", memory, {
      workingDirectory,
    }),
    {
      prompt: "create applied.txt",
      review,
    },
  );

  assert.equal(result.state.status, "done");
  assert.equal(modelCalls, 0);
  assert.equal(await readFile(join(workingDirectory, "applied.txt"), "utf8"), "applied\n");
  const entries = await memory.entries();
  assert.equal(entries[0]?.role, "user");
  assert.equal(entries[0]?.content, "create applied.txt");
  assert.equal(entries.at(-1)?.role, "tool");
  assert.match(entries.at(-1)?.content ?? "", /changeSetId/);
});
