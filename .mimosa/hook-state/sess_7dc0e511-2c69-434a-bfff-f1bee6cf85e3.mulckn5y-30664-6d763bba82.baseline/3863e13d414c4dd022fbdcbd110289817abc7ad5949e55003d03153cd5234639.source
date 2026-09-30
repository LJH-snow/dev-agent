import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  AgentToolRegistry,
  type AgentTool,
  type ApprovalPolicy,
} from "@dev-agent/agent-core";
import {
  createClaudeAgentSdkContext,
  fromClaudeAgentSdkToolName,
  runClaudeAgentSdk,
  toClaudeAgentSdkToolName,
  type ClaudeAgentSdkContext,
  type ClaudeAgentSdkQueryFactory,
} from "../dist/index.js";

function createTool(
  name: string,
  execute: AgentTool["execute"],
  metadata: AgentTool["metadata"] = { risk: "read-only", confirmation: "never" },
): AgentTool {
  return {
    name,
    description: `${name} test tool`,
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    metadata,
    execute,
  };
}

async function callMcpTool(
  context: ClaudeAgentSdkContext,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "dev-agent-test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    context.bridge.mcpServer.instance.connect(serverTransport),
  ]);
  try {
    return await client.callTool(
      { name, arguments: args },
      undefined,
      signal === undefined ? undefined : { signal },
    ) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
  } finally {
    await client.close();
    await context.bridge.mcpServer.instance.close();
  }
}

test("names project tools in a stable MCP namespace", () => {
  assert.equal(toClaudeAgentSdkToolName("code-search"), "mcp__dev_agent__code-search");
  assert.equal(fromClaudeAgentSdkToolName("mcp__dev_agent__code-search"), "code-search");
  assert.equal(fromClaudeAgentSdkToolName("mcp__other__code-search"), undefined);
  assert.throws(() => toClaudeAgentSdkToolName("shell/tool"), /unsupported characters/);
});

test("builds an isolated context with only allowlisted project tools", () => {
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async () => "ok"));
  tools.register(createTool("shell", async () => "not selected", { risk: "dangerous", confirmation: "always" }));

  const context = createClaudeAgentSdkContext({
    tools,
    toolAllowlist: ["filesystem"],
    sessionId: "session-1",
    workingDirectory: "/tmp/project",
  });

  assert.deepEqual(context.queryOptions.tools, []);
  assert.equal(context.queryOptions.strictMcpConfig, true);
  assert.deepEqual(context.queryOptions.settingSources, []);
  assert.equal(context.queryOptions.permissionMode, "default");
  assert.equal(context.queryOptions.permissionPrompts, "host");
  assert.deepEqual(Object.keys(context.queryOptions.mcpServers ?? {}), ["dev_agent"]);
  assert.deepEqual(context.bridge.sdkToolNames, ["mcp__dev_agent__filesystem"]);
});

test("forwards project execution context and bounds tool output", async () => {
  let receivedContext: unknown;
  const tools = new AgentToolRegistry();
  tools.register({
    ...createTool("filesystem", async (_input, context) => {
      receivedContext = context;
      context?.onProgress?.({ progress: 1, total: 1 });
      return { answer: "a".repeat(100) };
    }),
  });
  const progress: unknown[] = [];
  const context = createClaudeAgentSdkContext({
    tools,
    approval: { decide: () => "allow" },
    sessionId: "session-2",
    workingDirectory: "/tmp/project",
    sandbox: { name: "test", network: "disabled" },
    maxToolResultChars: 40,
    onToolProgress: (_name, value) => progress.push(value),
  });

  const result = await context.bridge.execute(
    "mcp__dev_agent__filesystem",
    { value: "x" },
  );

  assert.equal(result.isError, false);
  assert.match(String((result.content[0] as { text?: string } | undefined)?.text), /truncated/);
  assert.deepEqual(progress, [{ progress: 1, total: 1 }]);
  assert.equal((receivedContext as { sessionId: string }).sessionId, "session-2");
  assert.equal((receivedContext as { workingDirectory: string }).workingDirectory, "/tmp/project");
  assert.deepEqual((receivedContext as { sandbox: unknown }).sandbox, {
    name: "test",
    network: "disabled",
  });
});

test("enforces approval inside the real MCP handler", async () => {
  let executed = 0;
  let decisions = 0;
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async () => {
    executed += 1;
    return "must not run";
  }));
  const context = createClaudeAgentSdkContext({
    tools,
    approval: {
      decide: () => {
        decisions += 1;
        return { decision: "deny", reason: "host denied this call" };
      },
    },
    sessionId: "session-mcp-deny",
    workingDirectory: "/tmp/project",
  });

  const permission = await context.queryOptions.canUseTool?.(
    "mcp__dev_agent__filesystem",
    { value: "x" },
    { signal: new AbortController().signal, toolUseID: "tool-use-mcp-deny", requestId: "request-mcp-deny" },
  );
  assert.equal(permission?.behavior, "deny");

  // Invoke the MCP handler anyway to model a future/alternate SDK path. The
  // cached denial must not be replaced by a second policy decision.
  const result = await callMcpTool(
    context,
    "mcp__dev_agent__filesystem",
    { value: "x" },
  );

  assert.equal(result.isError, true);
  assert.match(String(result.content[0]?.text), /host denied this call/);
  assert.equal(executed, 0);
  assert.equal(decisions, 1);
});

test("executes an allowlisted MCP handler once and preserves reviewed input", async () => {
  let decisions = 0;
  let receivedInput: unknown;
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async (input) => {
    receivedInput = input;
    return input;
  }));
  const context = createClaudeAgentSdkContext({
    tools,
    approval: {
      prepare: (request) => ({
        executeInput: { ...(request.input as Record<string, unknown>), value: "reviewed" },
      }),
      decide: () => {
        decisions += 1;
        return "allow";
      },
    },
    sessionId: "session-mcp-allow",
    workingDirectory: "/tmp/project",
  });

  const permission = await context.queryOptions.canUseTool?.(
    "mcp__dev_agent__filesystem",
    { value: "original" },
    {
      signal: new AbortController().signal,
      toolUseID: "tool-use-mcp-1",
      requestId: "request-mcp-1",
    },
  );
  assert.equal(permission?.behavior, "allow");
  assert.deepEqual(permission && "updatedInput" in permission ? permission.updatedInput : undefined, { value: "reviewed" });

  const result = await callMcpTool(
    context,
    "mcp__dev_agent__filesystem",
    { value: "original" },
  );

  assert.equal(result.isError, false);
  assert.deepEqual(receivedInput, { value: "reviewed" });
  assert.equal(decisions, 1);
});

test("clears unused preflight decisions at the host lifecycle boundary", async () => {
  let decisions = 0;
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async (input) => input));
  const context = createClaudeAgentSdkContext({
    tools,
    approval: {
      decide: () => {
        decisions += 1;
        return "allow";
      },
    },
    sessionId: "session-mcp-clear",
    workingDirectory: "/tmp/project",
  });

  await context.queryOptions.canUseTool?.(
    "mcp__dev_agent__filesystem",
    { value: "stale" },
    { signal: new AbortController().signal, toolUseID: "tool-use-mcp-clear", requestId: "request-mcp-clear" },
  );
  context.bridge.clearPendingAuthorizations();
  const result = await context.bridge.execute(
    "mcp__dev_agent__filesystem",
    { value: "stale" },
  );

  assert.equal(result.isError, false);
  assert.equal(decisions, 2);
});

test("runs the project approval when a handler is invoked without canUseTool", async () => {
  let decisions = 0;
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async (input) => input));
  const context = createClaudeAgentSdkContext({
    tools,
    approval: {
      decide: () => {
        decisions += 1;
        return "allow";
      },
    },
    sessionId: "session-mcp-direct",
    workingDirectory: "/tmp/project",
  });

  const result = await callMcpTool(
    context,
    "mcp__dev_agent__filesystem",
    { value: "direct" },
  );

  assert.equal(result.isError, false);
  assert.deepEqual(result.content[0], { type: "text", text: '{"value":"direct"}' });
  assert.equal(decisions, 1);
});

test("bounds MCP handler failures and rejects tools outside the allowlist", async () => {
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async () => {
    throw new Error("e".repeat(200));
  }));
  const context = createClaudeAgentSdkContext({
    tools,
    approval: { decide: () => "allow" },
    toolAllowlist: ["filesystem"],
    maxToolResultChars: 40,
    sessionId: "session-mcp-bounds",
    workingDirectory: "/tmp/project",
  });

  const failure = await callMcpTool(
    context,
    "mcp__dev_agent__filesystem",
    { value: "x" },
  );
  const unknown = await callMcpTool(
    context,
    "mcp__dev_agent__shell",
    { value: "x" },
  );

  assert.equal(failure.isError, true);
  assert.match(String(failure.content[0]?.text), /truncated/);
  assert.equal(unknown.isError, true);
  assert.match(String(unknown.content[0]?.text), /not found/);
});

test("forwards MCP cancellation to the project tool context", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async (_input, toolContext) => {
    receivedSignal = toolContext?.signal;
    started();
    return await new Promise<string>((resolve) => {
      if (toolContext?.signal?.aborted) {
        resolve("aborted");
        return;
      }
      toolContext?.signal?.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
  }));
  const context = createClaudeAgentSdkContext({
    tools,
    approval: { decide: () => "allow" },
    sessionId: "session-mcp-abort",
    workingDirectory: "/tmp/project",
  });

  const running = context.bridge.execute(
    "mcp__dev_agent__filesystem",
    { value: "x" },
    { signal: controller.signal },
  );
  await startedPromise;
  controller.abort();
  const result = await running;

  assert.equal(receivedSignal?.aborted, true);
  assert.equal(result.isError, true);
  assert.match(String((result.content[0] as { text?: string } | undefined)?.text), /aborted/);
});

test("routes approval through the existing policy and preserves reviewed input", async () => {
  let approvalRequest: unknown;
  const approval: ApprovalPolicy = {
    prepare: (request) => ({ executeInput: { ...(request.input as Record<string, unknown>), value: "reviewed" } }),
    decide: (request) => {
      approvalRequest = request;
      return "allow";
    },
  };
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async (input) => input));
  const context = createClaudeAgentSdkContext({
    tools,
    approval,
    sessionId: "session-3",
    workingDirectory: "/tmp/project",
  });

  const permission = await context.bridge.checkPermission(
    "mcp__dev_agent__filesystem",
    { value: "original" },
    new AbortController().signal,
    "tool-use-1",
  );

  assert.equal(permission.behavior, "allow");
  assert.equal(permission.toolUseID, "tool-use-1");
  assert.deepEqual(permission.updatedInput, { value: "reviewed" });
  assert.equal((approvalRequest as { toolName: string }).toolName, "filesystem");
  assert.equal((approvalRequest as { sessionId: string }).sessionId, "session-3");
  assert.equal((approvalRequest as { workingDirectory: string }).workingDirectory, "/tmp/project");
});

test("denies tool calls without an approval policy", async () => {
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async () => "must not run"));
  const context = createClaudeAgentSdkContext({
    tools,
    sessionId: "session-4",
    workingDirectory: "/tmp/project",
  });

  const permission = await context.bridge.checkPermission(
    "mcp__dev_agent__filesystem",
    { value: "x" },
    new AbortController().signal,
  );

  assert.equal(permission.behavior, "deny");
  assert.match(permission.message, /no dev-agent approval policy/);
});

test("runs through an injected query and forwards final text", async () => {
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async () => "ok"));
  let capturedOptions: Record<string, unknown> | undefined;
  let closed = false;
  const queryFactory: ClaudeAgentSdkQueryFactory = ({ options }) => {
    capturedOptions = options as Record<string, unknown>;
    return {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "hello" }] },
        };
        yield {
          type: "result",
          subtype: "success",
          result: "hello",
        };
      },
      close() {
        closed = true;
      },
    } as never;
  };
  const text: string[] = [];

  const result = await runClaudeAgentSdk("say hello", {
    tools,
    sessionId: "session-5",
    workingDirectory: "/tmp/project",
    query: queryFactory,
    onText: (value) => text.push(value),
  });

  assert.equal(result.text, "hello");
  assert.deepEqual(text, ["hello"]);
  assert.equal(closed, true);
  assert.deepEqual(capturedOptions?.tools, []);
  assert.equal(capturedOptions?.strictMcpConfig, true);
});

test("closes an injected query when the host aborts", async () => {
  const controller = new AbortController();
  const tools = new AgentToolRegistry();
  tools.register(createTool("filesystem", async () => "ok"));
  let closed = false;
  let release!: () => void;
  const queryFactory: ClaudeAgentSdkQueryFactory = () => ({
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<never>>((resolve) => {
          release = () => resolve({ done: true, value: undefined as never });
        }),
      };
    },
    close() {
      closed = true;
      release?.();
    },
  } as never);

  const running = runClaudeAgentSdk("wait", {
    tools,
    sessionId: "session-6",
    workingDirectory: "/tmp/project",
    signal: controller.signal,
    query: queryFactory,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(running, /aborted/);
  assert.equal(closed, true);
});
