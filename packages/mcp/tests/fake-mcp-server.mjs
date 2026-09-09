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
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
        serverInfo: { name: "fake", version: "0.0.1" },
      },
    });
    return;
  }

  if (request.method === "roots/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        roots: [
          { uri: "file:///tmp/work", name: "workspace" },
        ],
      },
    });
    return;
  }

  if (request.method === "ping") {
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }

  if (request.method === "resources/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        resources: [
          {
            uri: "file:///tmp/hello.md",
            name: "hello",
            description: "Sample markdown resource",
            mimeType: "text/markdown",
          },
        ],
      },
    });
    return;
  }

  if (request.method === "resources/read") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        contents: [
          {
            uri: request.params?.uri,
            mimeType: "text/markdown",
            text: "# Hello from resources",
          },
        ],
      },
    });
    return;
  }

  if (request.method === "prompts/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        prompts: [
          {
            name: "summary",
            description: "Summarize a topic",
            arguments: [{ name: "topic", required: true }],
          },
        ],
      },
    });
    return;
  }

  if (request.method === "prompts/get") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        description: "Summary prompt",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Summarize: ${request.params?.arguments?.topic ?? ""}`,
            },
          },
        ],
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
          {
            name: "env",
            description: "Report select environment variables",
            inputSchema: { type: "object" },
          },
          {
            name: "notify",
            description: "Trigger a tools/list_changed notification",
            inputSchema: { type: "object" },
          },
        ],
      },
    });
    return;
  }

  if (request.method === "tools/call") {
    if (request.params?.name === "hello") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: `hello ${JSON.stringify(request.params.arguments ?? {})}`,
            },
          ],
        },
      });
    } else if (request.params?.name === "env") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: [
                process.env.DEV_AGENT_WORKING_DIRECTORY ?? "",
                process.env.DEV_AGENT_SESSION_ID ?? "",
                process.env.MCP_TEST_ENV ?? "",
              ].join("|"),
            },
          ],
        },
      });
    } else if (request.params?.name === "notify") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: "notified" }] },
      });
      send({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      });
    } else {
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `Unknown tool: ${request.params?.name}` },
      });
    }
    return;
  }

  send({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: "Method not found" },
  });
});
