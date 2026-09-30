import assert from "node:assert/strict";
import test from "node:test";

import { AgentToolRegistry } from "@dev-agent/agent-core";
import { createWorkerMcpTaskToolLeaseFactory } from "../dist/collaboration-mcp.js";

function fakeSessionFactory(configs: unknown[]) {
  return (config: any) => {
    configs.push(config);
    let closed = false;
    return {
      async connect() {
        return {
          tools: [{
            name: "hello",
            description: "hello",
            parameters: { type: "object" },
            async execute() { return "hello"; },
          }],
          resources: [],
          prompts: [],
        };
      },
      getClient() {
        return {
          async readResourceContents() { return []; },
          async getPrompt() { return { messages: [] }; },
        };
      },
      async close() { closed = true; },
      wasClosed() { return closed; },
    };
  };
}

test("worker MCP lease roots sessions at the task workspace and exposes only reviewed names", async () => {
  const configs: unknown[] = [];
  const sessions: Array<{ wasClosed(): boolean }> = [];
  const createSession = (config: any) => {
    const factory = fakeSessionFactory(configs);
    const session = factory(config);
    sessions.push(session);
    return session;
  };
  const tools = new AgentToolRegistry();
  tools.register({
    name: "filesystem",
    description: "filesystem",
    async execute() { return "file"; },
  });
  tools.register({
    name: "mcp:hello",
    description: "main session implementation must be replaced",
    async execute() { return "wrong"; },
  });

  const createLease = createWorkerMcpTaskToolLeaseFactory({
    servers: [{ command: "fake-mcp", env: { CUSTOM: "yes" } }],
    prefixes: ["mcp"],
    sessionId: "main-session",
    createSession,
  });
  const lease = await createLease(
    { id: "worker", title: "Worker", instructions: "run" },
    0,
    { id: "workspace", path: "/tmp/task-worktree", mode: "worktree" },
    tools,
    new AbortController().signal,
  );

  assert.deepEqual(lease.tools.list().map((tool) => tool.name), ["filesystem", "mcp:hello"]);
  const config = configs[0] as any;
  assert.equal(config.rootDirectory, "/tmp/task-worktree");
  assert.equal(config.env.DEV_AGENT_SESSION_ID, "main-session-worker-0");
  assert.equal(config.env.DEV_AGENT_WORKING_DIRECTORY, "/tmp/task-worktree");
  assert.equal(config.env.CUSTOM, "yes");

  await lease.dispose?.();
  assert.equal(sessions[0]?.wasClosed(), true);
});
