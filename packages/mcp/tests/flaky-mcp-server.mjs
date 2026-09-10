import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";

const stateFile = process.env.FLAKY_STATE_FILE;
const rl = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function failOnce() {
  if (!stateFile) return false;
  try {
    const count = parseInt(readFileSync(stateFile, "utf8").trim() || "0", 10);
    if (count === 0) {
      writeFileSync(stateFile, "1", "utf8");
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  if (request.method === "initialize") {
    if (failOnce()) {
      process.exit(1);
    }
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "flaky", version: "0.0.1" },
      },
    });
    return;
  }

  if (request.id === undefined) return;

  if (request.method === "notifications/initialized") return;

  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          { name: "ping", description: "Return pong", inputSchema: { type: "object" } },
        ],
      },
    });
    return;
  }

  if (request.method === "tools/call") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: "pong" }] },
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

  if (request.method === "ping") {
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }

  send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } });
});
