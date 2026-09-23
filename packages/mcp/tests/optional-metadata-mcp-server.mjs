import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
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
        capabilities: {
          tools: {},
          // Some servers advertise the capability but do not implement the
          // optional metadata list request. This mirrors shadcn's behavior.
          resources: {},
          prompts: {},
        },
        serverInfo: { name: "optional-metadata", version: "0.0.1" },
      },
    });
    return;
  }

  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          {
            name: "hello",
            description: "Say hello",
            inputSchema: { type: "object" },
          },
        ],
      },
    });
    return;
  }

  send({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: "Method not found" },
  });
});
