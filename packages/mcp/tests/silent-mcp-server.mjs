// Never answers anything by default, so a request must time out instead of
// hanging the caller. Set MOCK_MCP_ANSWER_INITIALIZE=1 to let `initialize`
// succeed and keep every later request unanswered — that isolates the
// post-connect request timeout from the connect timeout.
import { createInterface } from "node:readline";

const answerInitialize = process.env.MOCK_MCP_ANSWER_INITIALIZE === "1";
const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (!answerInitialize) {
    return;
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.method === "initialize") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "silent", version: "0.0.1" },
        },
      })}\n`
    );
  }
});
