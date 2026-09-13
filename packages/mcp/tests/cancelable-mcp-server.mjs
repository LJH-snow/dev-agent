import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
const marker = process.env.MCP_CANCEL_MARKER;
const responseDelayMs = Number(process.env.MCP_RESPONSE_DELAY_MS ?? 160);

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function scheduleProgress(id, token) {
  [1, 2, 3].forEach((progress, index) => {
    setTimeout(() => {
      send({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: token, progress, total: 3 },
      });
    }, 15 * (index + 1));
  });

  setTimeout(() => {
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: "progressive complete" }] },
    });
  }, responseDelayMs);
}

rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  if (request.method === "notifications/cancelled") {
    if (marker) {
      void appendFile(
        marker,
        `${JSON.stringify({ requestId: request.params?.requestId, reason: request.params?.reason })}\n`,
        "utf8"
      );
    }
    return;
  }

  if (request.id === undefined) {
    return;
  }

  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "cancelable", version: "0.0.1" },
      },
    });
    return;
  }

  if (request.method === "ping") {
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }

  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "progressive",
            description: "Reports progress and eventually completes",
            inputSchema: { type: "object" },
          },
        ],
      },
    });
    return;
  }

  if (request.method === "resources/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { resources: [] } });
    return;
  }

  if (request.method === "prompts/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { prompts: [] } });
    return;
  }

  if (request.method === "tools/call") {
    if (request.params?.name === "progressive") {
      scheduleProgress(request.id, request.params?._meta?.progressToken ?? request.id);
      return;
    }
    send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32602, message: `Unknown tool: ${request.params?.name}` },
    });
    return;
  }

  send({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: "Method not found" },
  });
});
