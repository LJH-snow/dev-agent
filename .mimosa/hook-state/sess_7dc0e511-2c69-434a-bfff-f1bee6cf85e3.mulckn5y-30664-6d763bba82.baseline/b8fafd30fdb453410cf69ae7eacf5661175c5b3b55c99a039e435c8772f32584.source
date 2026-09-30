import assert from "node:assert/strict";
import test from "node:test";

import * as acp from "@agentclientprotocol/sdk";

import {
  createAcpAgent,
  type AcpRuntimeFactory,
  type AcpSessionRuntime,
} from "../dist/index.js";

function createConnectedClient(factory: AcpRuntimeFactory) {
  const agent = createAcpAgent({
    name: "dev-agent-test",
    version: "0.1.0",
    runtime: factory,
  });
  const updates: acp.SessionUpdate[] = [];
  const permissions: acp.RequestPermissionRequest[] = [];
  const client = acp
    .client({ name: "test-client" })
    .onNotification(acp.methods.client.session.update, (ctx) => {
      updates.push(ctx.params.update);
    })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      permissions.push(ctx.params);
      return {
        outcome: {
          outcome: "selected",
          optionId: ctx.params.options[0]?.optionId ?? "allow",
        },
      };
    });

  return { agent, client, updates, permissions };
}

test("ACP initializes, creates a session, and streams agent updates", async () => {
  const runtime: AcpRuntimeFactory = {
    createSession: async ({ sessionId, emit }) => ({
      sessionId,
      async prompt(_prompt, { signal }) {
        await emit({
          sessionUpdate: "agent_message_chunk",
          messageId: "answer-1",
          content: { type: "text", text: "hello from ACP" },
        });
        await emit({
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Inspect workspace",
          name: "filesystem",
          kind: "read",
          status: "completed",
        });
        return {
          stopReason: signal.aborted ? "cancelled" : "end_turn",
        };
      },
      cancel() {},
      close() {},
    }),
  };
  const connected = createConnectedClient(runtime);

  const response = await connected.client.connectWith(connected.agent, async (ctx) => {
    const init = await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
    });
    assert.equal(init.protocolVersion, acp.PROTOCOL_VERSION);
    assert.equal(init.agentInfo?.name, "dev-agent-test");

    const session = await ctx.buildSession("/tmp/dev-agent-acp-test").start();
    const result = await session.prompt("hello");
    session.dispose();
    return result;
  });

  assert.equal(response.stopReason, "end_turn");
  assert.equal(connected.updates[0]?.sessionUpdate, "agent_message_chunk");
  assert.equal(connected.updates[1]?.sessionUpdate, "tool_call");
  assert.equal(connected.updates[0]?.content.type, "text");
});

test("ACP forwards permission requests through the client", async () => {
  let permissionResult: acp.RequestPermissionResponse | undefined;
  const runtime: AcpRuntimeFactory = {
    createSession: async ({ sessionId, requestPermission }) => ({
      sessionId,
      async prompt() {
        permissionResult = await requestPermission({
          sessionId,
          toolCall: {
            toolCallId: "tool-1",
            title: "Run command",
            name: "shell",
            kind: "execute",
            status: "pending",
          },
          options: [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
        });
        return { stopReason: "end_turn" };
      },
      cancel() {},
      close() {},
    }),
  };
  const connected = createConnectedClient(runtime);

  await connected.client.connectWith(connected.agent, async (ctx) => {
    await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
    });
    const session = await ctx.buildSession("/tmp/dev-agent-acp-test").start();
    await session.prompt("approve");
    session.dispose();
  });

  assert.equal(connected.permissions.length, 1);
  assert.deepEqual(permissionResult?.outcome, {
    outcome: "selected",
    optionId: "allow",
  });
});

test("ACP cancellation aborts an active runtime and returns cancelled", async () => {
  let cancelled = false;
  let release!: () => void;
  const runtime: AcpRuntimeFactory = {
    createSession: async ({ sessionId }) => ({
      sessionId,
      async prompt(_prompt, { signal }) {
        await new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener("abort", () => {
            cancelled = true;
            resolve();
          }, { once: true });
        });
        return { stopReason: signal.aborted ? "cancelled" : "end_turn" };
      },
      cancel() {
        release?.();
      },
      close() {},
    }),
  };
  const connected = createConnectedClient(runtime);

  const result = await connected.client.connectWith(connected.agent, async (ctx) => {
    await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
    });
    const session = await ctx.buildSession("/tmp/dev-agent-acp-test").start();
    const prompt = session.prompt("cancel me");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
    const response = await prompt;
    session.dispose();
    return response;
  });

  assert.equal(cancelled, true);
  assert.equal(result.stopReason, "cancelled");
});

test("ACP connection cleanup cancels active sessions before closing them", async () => {
  let cancelCalled = false;
  let closeCalled = false;
  let promptStarted!: () => void;
  let releasePrompt!: () => void;
  const started = new Promise<void>((resolve) => {
    promptStarted = resolve;
  });
  const runtime: AcpRuntimeFactory = {
    createSession: async ({ sessionId }) => ({
      sessionId,
      async prompt() {
        promptStarted();
        await new Promise<void>((resolve) => {
          releasePrompt = resolve;
        });
        return { stopReason: "cancelled" };
      },
      cancel() {
        cancelCalled = true;
        releasePrompt?.();
      },
      close() {
        closeCalled = true;
      },
    }),
  };
  const connected = createConnectedClient(runtime);

  await connected.client.connectWith(connected.agent, async (ctx) => {
    await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
    });
    const session = await ctx.buildSession("/tmp/dev-agent-acp-test").start();
    void session.prompt("disconnect me");
    await started;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelCalled, true);
  assert.equal(closeCalled, true);
});

test("ACP rejects prompt content that the runtime cannot represent", async () => {
  const runtime: AcpRuntimeFactory = {
    createSession: async ({ sessionId }) => ({
      sessionId,
      async prompt() {
        return { stopReason: "end_turn" };
      },
      cancel() {},
      close() {},
    }),
  };
  const connected = createConnectedClient(runtime);

  await assert.rejects(
    connected.client.connectWith(connected.agent, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      const session = await ctx.buildSession("/tmp/dev-agent-acp-test").start();
      await ctx.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "image", data: "not-supported", mimeType: "image/png" }],
      });
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "data" in error &&
      typeof error.data === "object" &&
      error.data !== null &&
      "details" in error.data &&
      error.data.details === "Unsupported ACP prompt content: image",
  );
});
