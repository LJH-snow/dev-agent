import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const startCountFile = process.env.MCP_START_COUNT_FILE;
if (startCountFile) {
  appendFileSync(startCountFile, "started\n", "utf8");
}
const rl = createInterface({ input: process.stdin });
let capabilityVersion = 1;

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
        resources: capabilityVersion === 1
          ? [
              {
                uri: "file:///tmp/hello.md",
                name: "hello",
                description: "Sample markdown resource",
                mimeType: "text/markdown",
              },
            ]
          : [
              {
                uri: "file:///tmp/goodbye.md",
                name: "goodbye",
                description: "Second version markdown resource",
                mimeType: "text/markdown",
              },
            ],
      },
    });
    return;
  }

  if (request.method === "resources/read") {
    const uri = request.params?.uri;
    // A URI containing "empty" answers with no blocks at all.
    if (typeof uri === "string" && uri.includes("empty")) {
      send({ jsonrpc: "2.0", id: request.id, result: { contents: [] } });
      return;
    }
    // A URI containing "multi" answers with several blocks, the way a directory
    // read or a text+blob resource does, so callers can be tested against a
    // server that returns more than the first content.
    if (typeof uri === "string" && uri.includes("multi")) {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          contents: [
            { uri, mimeType: "text/plain", text: "FIRST-PART" },
            { uri: `${uri}#2`, mimeType: "text/plain", text: "SECOND-PART" },
            { uri: `${uri}#3`, mimeType: "text/plain", text: "THIRD-PART" },
          ],
        },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        contents: [
          {
            uri,
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
        prompts: capabilityVersion === 1
          ? [
              {
                name: "summary",
                description: "Summarize a topic",
                arguments: [{ name: "topic", required: true }],
              },
            ]
          : [
              {
                name: "rewrite",
                description: "Rewrite a sentence",
                arguments: [{ name: "text", required: true }],
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
        description: capabilityVersion === 1 ? "Summary prompt" : "Rewrite prompt",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: capabilityVersion === 1
                ? `Summarize: ${request.params?.arguments?.topic ?? ""}`
                : `Rewrite: ${request.params?.arguments?.text ?? ""}`,
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
          ...(capabilityVersion === 1
            ? [
                {
                  name: "hello",
                  description: "Say hello",
                  inputSchema: { type: "object" },
                  // Deliberately untrusted: application-owned MCP wrappers must
                  // not treat a server hint as an authorization decision.
                  annotations: { readOnlyHint: true },
                },
                {
                  name: "env",
                  description: "Report select environment variables",
                  inputSchema: { type: "object" },
                },
                {
                  name: "notify",
                  description: "Switch to the second capability version",
                  inputSchema: { type: "object" },
                },
              ]
            : [
                {
                  name: "goodbye",
                  description: "Say goodbye",
                  inputSchema: { type: "object" },
                },
                {
                  name: "status",
                  description: "Report the second capability version",
                  inputSchema: { type: "object" },
                },
                {
                  name: "revision",
                  description: "Describe the active capability revision",
                  inputSchema: { type: "object" },
                },
              ]),
          ...(process.env.MCP_INCLUDE_FAILURE_TOOLS === "1"
            ? [
                {
                  name: "failing",
                  description: "Always fails with a descriptive message",
                  inputSchema: { type: "object" },
                },
                {
                  name: "silent-failure",
                  description: "Fails without any content",
                  inputSchema: { type: "object" },
                },
              ]
            : []),
        ],
      },
    });
    return;
  }

  if (request.method === "tools/call") {
    if (request.params?.name === "crash") {
      // Simulates a server that dies without answering the pending call.
      process.exit(1);
    }
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
                process.cwd(),
              ].join("|"),
            },
          ],
        },
      });
    } else if (request.params?.name === "notify") {
      capabilityVersion = 2;
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: "notified" }] },
      });
      send({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      });
      if (process.env.DEV_AGENT_SESSION_ID) {
        send({
          jsonrpc: "2.0",
          method: "notifications/resources/list_changed",
        });
        send({
          jsonrpc: "2.0",
          method: "notifications/prompts/list_changed",
        });
      }
    } else if (request.params?.name === "failing") {
      const mode = request.params.arguments?.mode;
      const content = mode === "multi"
        ? [
            { type: "text", text: "permission denied" },
            { type: "text", text: "cannot read /etc/shadow (EACCES)" },
          ]
        : mode === "long"
          ? [{ type: "text", text: "x".repeat(2500) }]
          : [{ type: "text", text: "permission denied: cannot read /etc/shadow (EACCES)" }];
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: { isError: true, content },
      });
    } else if (request.params?.name === "silent-failure") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: { isError: true, content: [] },
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
