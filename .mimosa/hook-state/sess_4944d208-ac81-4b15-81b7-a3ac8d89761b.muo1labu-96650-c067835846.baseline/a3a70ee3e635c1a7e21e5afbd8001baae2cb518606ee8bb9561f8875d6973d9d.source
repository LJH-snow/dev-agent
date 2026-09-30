import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = join(cliRoot, "dist", "index.js");

function runAcpCli(
  cwd: string,
  messages: readonly Record<string, unknown>[],
  env: Record<string, string> = {},
  onFrame?: (
    frame: Record<string, unknown>,
    child: ReturnType<typeof spawn>
  ) => void
): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly frames: readonly Record<string, unknown>[];
}> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry, "--acp", "--cwd", cwd], {
      cwd: cliRoot,
      env: {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_CONFIG_FILE: join(cwd, "missing-config.json"),
        DEV_AGENT_MEMORY_FILE: join(cwd, "memory.json"),
        ...env,
      },
    });
    let stdout = "";
    let pending = "";
    let stderr = "";
    const frames: Record<string, unknown>[] = [];
    let ended = false;

    const finish = (code: number) => {
      if (ended) return;
      ended = true;
      resolve({ code, stdout, stderr, frames });
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const frame = JSON.parse(line) as Record<string, unknown>;
          frames.push(frame);
          onFrame?.(frame, child);
        } catch {
          // The assertion below reports protocol pollution with the raw output.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => finish(1));
    child.on("exit", (code) => finish(code ?? 0));

    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    if (onFrame === undefined) {
      child.stdin.end();
    }
  });
}

test("CLI --acp serves initialize and session/new as stdout-only ACP frames", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-agent-acp-cli-"));
  try {
    const result = await runAcpCli(cwd, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: { name: "acp-cli-test", version: "0.1.0" },
          clientCapabilities: {},
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd, mcpServers: [] },
      },
    ], {}, (frame, child) => {
      if (frame.id === 2) {
        child.stdin.end();
      }
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.trim(), "ACP mode should emit protocol frames");
    assert.ok(
      result.stdout.split("\n").filter(Boolean).every((line) => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      }),
      `stdout contained a non-JSON-RPC line: ${result.stdout}`
    );
    assert.equal(result.frames.length, 2);
    assert.equal(result.frames[0]?.id, 1);
    assert.equal(result.frames[1]?.id, 2);
    assert.equal(result.frames[1]?.result !== undefined, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("CLI --acp streams provider turns with refreshed project instructions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "dev-agent-acp-cli-"));
  await mkdir(join(cwd, ".git"));
  await writeFile(join(cwd, "AGENTS.md"), "ACP project instruction", "utf8");
  let providerMessages: readonly { readonly role?: string; readonly content?: string }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body) as {
        readonly messages?: readonly { readonly role?: string; readonly content?: string }[];
      };
      providerMessages = parsed.messages ?? [];
      response.statusCode = 200;
      response.setHeader("content-type", "application/x-ndjson");
      response.write(
        `${JSON.stringify({ message: { thinking: "checking" } })}\n`
      );
      response.write(
        `${JSON.stringify({ message: { content: "hello from provider" } })}\n`
      );
      response.end(
        `${JSON.stringify({
          done: true,
          prompt_eval_count: 2,
          eval_count: 3,
        })}\n`
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await runAcpCli(
      cwd,
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientInfo: { name: "acp-cli-test", version: "0.1.0" },
            clientCapabilities: {},
          },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "session/new",
          params: { cwd, mcpServers: [] },
        },
      ],
      {
        DEV_AGENT_OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}`,
      },
      (frame, child) => {
        if (frame.id === 2) {
          const sessionId = (frame.result as { sessionId: string }).sessionId;
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              method: "session/prompt",
              params: {
                sessionId,
                prompt: [{ type: "text", text: "say hello" }],
              },
            })}\n`
          );
        } else if (frame.id === 3) {
          child.stdin.end();
        }
      }
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const sessionResponse = result.frames.find((frame) => frame.id === 2);
    assert.ok(sessionResponse);
    const sessionResult = sessionResponse.result as { sessionId: string };
    assert.equal(typeof sessionResult.sessionId, "string");

    const promptFrame = result.frames.find((frame) => frame.id === 3);
    assert.ok(promptFrame);
    const promptResult = promptFrame.result as { stopReason: string; usage?: unknown };
    assert.equal(promptResult.stopReason, "end_turn");
    assert.deepEqual(promptResult.usage, {
      totalTokens: 5,
      inputTokens: 2,
      outputTokens: 3,
    });

    const updates = result.frames
      .filter((frame) => frame.method === "session/update")
      .map((frame) => frame.params as { update: Record<string, unknown> });
    assert.ok(
      updates.some((frame) => frame.update.sessionUpdate === "user_message_chunk")
    );
    assert.ok(
      updates.some(
        (frame) =>
          frame.update.sessionUpdate === "agent_message_chunk" &&
          JSON.stringify(frame.update).includes("hello from provider")
      )
    );
    assert.ok(
      updates.some((frame) => frame.update.sessionUpdate === "usage_update")
    );
    const system = providerMessages.filter((message) => message.role === "system")
      .map((message) => message.content ?? "").join("\n");
    assert.match(system, /ACP project instruction/);
    assert.match(system, /Active project root:/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(cwd, { recursive: true, force: true });
  }
});
