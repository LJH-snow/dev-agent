import assert from "node:assert/strict";
import test from "node:test";

import { createOpenAIProvider } from "@dev-agent/model";

import {
  AgentLoop,
  AgentToolRegistry,
  createAgentContext,
  InMemoryMemory,
} from "../dist/index.js";

const encoder = new TextEncoder();

function sseResponse(payloads) {
  const stream = new ReadableStream({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

// Regression test: streaming used to drop tool calls, so with streaming enabled
// (onToken set) the agent loop saw zero tool calls and ended the turn without
// ever running a tool. This exercises the real provider parser end to end.
test("agent loop runs tools from tool call deltas of a streaming provider", async () => {
  let requestCount = 0;
  const fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return sseResponse([
        { choices: [{ delta: { content: "Reading " } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: { name: "read_file", arguments: '{"path":"a.txt"}' },
                  },
                ],
              },
            },
          ],
        },
      ]);
    }
    return sseResponse([{ choices: [{ delta: { content: "done" } }] }]);
  };

  const provider = createOpenAIProvider({ model: "gpt-4.1", apiKey: "test", fetch });

  const executed = [];
  const tools = new AgentToolRegistry();
  tools.register({
    name: "read_file",
    description: "Reads a file.",
    async execute(input) {
      executed.push(input);
      return `contents of ${input.path}`;
    },
  });

  const tokens = [];
  const memory = new InMemoryMemory();
  const context = createAgentContext("streaming-tools", memory);
  const loop = new AgentLoop({
    model: provider,
    tools,
    maxTurns: 3,
    onToken: (token) => tokens.push(token),
  });

  const result = await loop.run(context, "read a.txt");

  assert.equal(result.state.status, "done");
  assert.equal(executed.length, 1);
  assert.deepEqual(executed[0], { path: "a.txt" });
  assert.deepEqual(tokens, ["Reading ", "done"]);
});
