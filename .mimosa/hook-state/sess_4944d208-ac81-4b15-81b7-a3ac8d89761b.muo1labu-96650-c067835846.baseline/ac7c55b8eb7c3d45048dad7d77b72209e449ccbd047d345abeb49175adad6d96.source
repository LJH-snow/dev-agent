import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  InMemoryMemory,
} from "../dist/index.js";

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("the expected approval status was never reported");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createToolCallModel(toolName: string, input: unknown, finalAnswer: string) {
  let calls = 0;
  return {
    id: "openai" as const,
    model: "test-model",
    async chat() {
      calls += 1;
      return calls === 1
        ? { content: "", toolCalls: [{ id: "call-1", name: toolName, input }] }
        : { content: finalAnswer, toolCalls: [] };
    },
  };
}

test("approval waits are reported around the policy decision", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "echo",
    description: "Echoes the input.",
    async execute(input) {
      return { echoed: input };
    },
  });
  const gate = createDeferred<void>();
  const statuses: string[] = [];
  const events: { type: string }[] = [];
  const loop = new AgentLoop({
    model: createToolCallModel("echo", { text: "hello" }, "done"),
    tools,
    maxTurns: 3,
    eventSink: (event) => events.push(event),
    onApprovalStatus: (status) => statuses.push(status),
    approval: {
      async decide() {
        await gate.promise;
        return { decision: "allow" as const };
      },
    },
  } as any);

  const context = createAgentContext("approval-status", new InMemoryMemory());
  const run = loop.run(context, "echo hello");
  await waitFor(() => statuses.length > 0);

  assert.deepEqual(statuses, ["waiting"]);
  assert.ok(
    events.some((event) => event.type === "tool.approval-requested"),
    "the approval request event precedes the resolved status"
  );
  assert.ok(!events.some((event) => event.type === "tool.approval-resolved"));

  gate.resolve();
  const result = await run;

  assert.equal(result.state.status, "done");
  assert.deepEqual(statuses, ["waiting", "resolved"]);
  assert.ok(events.some((event) => event.type === "tool.approval-resolved"));
});

test("sandbox expansion waits are reported as confirmation waits", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "network-tool",
    description: "Needs network access after the first restricted attempt.",
    async execute(_input, context) {
      if (context?.sandbox?.network !== "enabled") {
        throw Object.assign(new Error("network access denied"), {
          code: "SANDBOX_DENIED",
          capability: "network",
        });
      }
      return { ok: true };
    },
  });
  const gate = createDeferred<void>();
  const statuses: string[] = [];
  const loop = new AgentLoop({
    model: createToolCallModel(
      "network-tool",
      { url: "https://example.com" },
      "network request completed"
    ),
    tools,
    maxTurns: 3,
    onApprovalStatus: (status) => statuses.push(status),
    toolSandboxProfile: () => ({
      name: "restricted",
      network: "disabled",
      writablePaths: ["/tmp/work"],
    }),
    onSandboxExpansion: async (request: any) => {
      await gate.promise;
      return {
        decision: "allow",
        profile: { ...request.profile, name: "restricted+network", network: "enabled" },
      };
    },
  } as any);

  const context = createAgentContext("sandbox-approval-status", new InMemoryMemory(), {
    sessionId: "sandbox-approval-session",
    workingDirectory: "/tmp/work",
  });
  const run = loop.run(context, "fetch the page");
  await waitFor(() => statuses.length > 0);
  assert.deepEqual(statuses, ["waiting"]);

  gate.resolve();
  const result = await run;

  assert.equal(result.state.status, "done");
  assert.deepEqual(statuses, ["waiting", "resolved"]);
});

test("tool calls without an approval policy never report a confirmation wait", async () => {
  const tools = new AgentToolRegistry();
  tools.register({
    name: "echo",
    description: "Echoes the input.",
    async execute(input) {
      return { echoed: input };
    },
  });
  const statuses: string[] = [];
  const loop = new AgentLoop({
    model: createToolCallModel("echo", { text: "hello" }, "done"),
    tools,
    maxTurns: 3,
    onApprovalStatus: (status) => statuses.push(status),
  } as any);

  const result = await loop.run(
    createAgentContext("approval-status-none", new InMemoryMemory()),
    "echo hello"
  );

  assert.equal(result.state.status, "done");
  assert.deepEqual(statuses, []);
});
