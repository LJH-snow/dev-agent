import assert from "node:assert/strict";
import test from "node:test";

import { McpStdioClient, createMcpServer } from "../dist/index.js";

class FakeInput {
  private readonly dataListeners: Array<(chunk: string | Buffer) => void> = [];
  private readonly endListeners: Array<() => void> = [];
  private readonly errorListeners: Array<(error: unknown) => void> = [];

  on(event: "data" | "end" | "error", listener: (...args: any[]) => void): unknown {
    if (event === "data") this.dataListeners.push(listener);
    if (event === "end") this.endListeners.push(listener);
    if (event === "error") this.errorListeners.push(listener);
    return this;
  }

  emitData(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  end(): void {
    for (const listener of this.endListeners) listener();
  }
}

class FakeOutput {
  readonly chunks: string[] = [];

  write(chunk: string): void {
    this.chunks.push(chunk);
  }
}

function echoTool() {
  return {
    name: "echo",
    description: "Echo",
    async execute(input: any) {
      return input;
    },
  };
}

test("MCP server rejects an unterminated frame once it exceeds maxFrameBytes", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const server = createMcpServer({
    tools: [echoTool()],
    input,
    output,
    maxFrameBytes: 64,
  } as any);

  const started = server.start();
  input.emitData('{"jsonrpc":"2.0","id":1,"method":"tools/list","params:' + "x".repeat(11));
  input.end();

  await assert.rejects(started, /MCP frame exceeds maximum of 64 bytes/);
  assert.deepEqual(output.chunks, []);
});

test("MCP client rejects an oversized incoming frame and closes the child", async () => {
  const script = [
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', () => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'x',version:'" + "v".repeat(300) + "'}}})+'\\n'));",
  ].join(" ");
  const client = new McpStdioClient();

  await assert.rejects(
    client.connect({
      command: process.execPath,
      args: ["-e", script],
      maxFrameBytes: 256,
      timeoutMs: 1000,
    } as any),
    /MCP frame exceeds maximum of 256 bytes/
  );
  assert.equal(client.isConnected(), false);
});

test("MCP client rejects an oversized outgoing frame before writing it", async () => {
  const script = [
    "const rl = require('node:readline').createInterface({input: process.stdin});",
    "rl.on('line', line => { const request = JSON.parse(line); if (request.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'x',version:'1'}}})+'\\n'); });",
  ].join(" ");
  const client = new McpStdioClient();

  try {
    await client.connect({
      command: process.execPath,
      args: ["-e", script],
      maxFrameBytes: 256,
      timeoutMs: 1000,
    } as any);
    await assert.rejects(
      client.callTool("echo", { text: "x".repeat(1000) }),
      /MCP frame exceeds maximum of 256 bytes/
    );
  } finally {
    await client.close();
  }
});
