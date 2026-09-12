// Answers every request after MOCK_MCP_DELAY_MS (default 300ms).
import { createInterface } from "node:readline";

const delay = Number.parseInt(process.env.MOCK_MCP_DELAY_MS ?? "300", 10);
const rl = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  setTimeout(() => {
    if (request.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "slow", version: "0.0.1" },
        },
      });
      return;
    }
    if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "slow-tool" }] } });
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
    if (request.id !== undefined) {
      send({ jsonrpc: "2.0", id: request.id, result: {} });
    }
  }, delay);
});
