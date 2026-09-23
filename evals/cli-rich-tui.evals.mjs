import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expectAvailable, runExpect, runNode } from "./helpers/pty.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const cliPath = join(repositoryRoot, "apps", "cli", "dist", "index.js");

async function listen(server) {
  await new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function withTempDir(callback) {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-eval-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function startQueueProvider() {
  const requests = [];
  let requestIndex = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      requests.push(body);
      const answer = requestIndex === 0 ? "FIRST_RESPONSE" : "SECOND_RESPONSE";
      const delay = requestIndex === 0 ? 280 : 10;
      requestIndex += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      setTimeout(() => {
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })}\n\n`,
        );
        response.end("data: [DONE]\n\n");
      }, delay);
    });
  });
  return {
    baseUrl: await listen(server),
    requests,
    close: () => closeServer(server),
  };
}

async function startViewportProvider() {
  let requestIndex = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      void body;
      const answer = `LONG_RESPONSE_${requestIndex}`;
      requestIndex += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
  });
  return {
    baseUrl: await listen(server),
    close: () => closeServer(server),
  };
}

async function startJsonCaptureProvider() {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      requests.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: "capture-ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  return {
    baseUrl: await listen(server),
    requests,
    close: () => closeServer(server),
  };
}

async function startToolProvider(target) {
  const requests = [];
  let requestCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      requests.push(body);
      requestCount += 1;
      const parsed = JSON.parse(body);
      response.writeHead(200, {
        "content-type": parsed.stream === true
          ? "text/event-stream"
          : "application/json",
      });
      const toolCall = {
        id: "eval_tool_call",
        type: "function",
        function: {
          name: "shell",
          arguments: JSON.stringify({
            command: "chmod",
            args: ["777", target],
          }),
        },
      };
      if (requestCount === 1) {
        if (parsed.stream === true) {
          response.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { tool_calls: [{ index: 0, ...toolCall }] } }],
            })}\n\n`,
          );
          response.write(
            `data: ${JSON.stringify({
              choices: [],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            })}\n\n`,
          );
          response.end("data: [DONE]\n\n");
        } else {
          response.end(JSON.stringify({
            choices: [{ message: { content: "", tool_calls: [toolCall] } }],
          }));
        }
        return;
      }

      const answer = "tool-loop-finished";
      if (parsed.stream === true) {
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
        );
        response.write(
          `data: ${JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })}\n\n`,
        );
        response.end("data: [DONE]\n\n");
      } else {
        response.end(JSON.stringify({
          choices: [{ message: { content: answer } }],
        }));
      }
    });
  });
  return {
    baseUrl: await listen(server),
    requests,
    close: () => closeServer(server),
  };
}

function openAiEnv(provider, memoryFile, extra = {}) {
  return {
    DEV_AGENT_TUI: "ink",
    DEV_AGENT_MCP_SERVERS: "[]",
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "eval-key",
    OPENAI_BASE_URL: provider,
    DEV_AGENT_MEMORY_FILE: memoryFile,
    ...extra,
  };
}

function assertExpectPassed(result, name) {
  if (result.skipped) return;
  assert.equal(
    result.code,
    0,
    `${name} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

async function waitForText(getOutput, needle, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getOutput().includes(needle)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`output did not contain ${JSON.stringify(needle)}\n${getOutput()}`);
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectExit(new Error(`child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function evaluateInkQueue() {
  const provider = await startQueueProvider();
  try {
    await withTempDir(async (directory) => {
      const result = await runExpect({
        env: openAiEnv(provider.baseUrl, join(directory, "memory.json")),
        timeoutMs: 15000,
        script: `
          log_user 1
          spawn {${process.execPath}} {${cliPath}}
          expect "SIGNAL LOOM"
          expect "Type your message"
          sleep 1
          send "first-prompt\\r"
          expect "Working"
          send "second-prompt\\r"
          expect "WAITING QUEUE"
          expect "FIRST_RESPONSE"
          expect "SECOND_RESPONSE"
          expect "\\[state=done turns=2\\]"
          puts "PRE_EXIT_MARKER"
          send "exit\\r"
          expect eof
        `,
      });
      assertExpectPassed(result, "Ink queue");
      if (!result.skipped) {
        const liveOutput = result.stdout.split("PRE_EXIT_MARKER", 1)[0] ?? result.stdout;
        assert.equal(
          (liveOutput.match(/\u001b\[2J\u001b\[3J\u001b\[H/g) ?? []).length,
          0,
          "Ink should not clear terminal scrollback when the PTY reports zero dimensions at startup",
        );
        assert.equal(provider.requests.length, 2);
        assert.match(provider.requests[0], /first-prompt/);
        assert.match(provider.requests[1], /second-prompt/);
      }
    });
  } finally {
    await provider.close();
  }
}

async function evaluateInkViewportNavigation() {
  const provider = await startViewportProvider();
  try {
    await withTempDir(async (directory) => {
      const turns = Array.from({ length: 8 }, (_, index) => [
        `send "viewport-${index}\\r"`,
        `expect "LONG_RESPONSE_${index}"`,
      ]).join("\n");
      const result = await runExpect({
        env: openAiEnv(provider.baseUrl, join(directory, "memory.json")),
        timeoutMs: 20000,
        script: `
          log_user 1
          spawn {${process.execPath}} {${cliPath}}
          stty rows 24 columns 80
          expect "SIGNAL LOOM"
          expect "Type your message"
          sleep 1
          ${turns}
          stty rows 18 columns 64
          sleep 1
          expect "~/Desktop/dev-agent"
          send "\\033[5~"
          expect "rows above"
          send "\\033[H"
          expect "viewport-0"
          expect "rows below"
          send "\\033[F"
          expect "viewport-7"
          send "exit\\r"
          expect eof
        `,
      });
      assertExpectPassed(result, "Ink viewport navigation");
    });
  } finally {
    await provider.close();
  }
}

async function evaluateInkResizeViewport() {
  const provider = await startViewportProvider();
  try {
    await withTempDir(async (directory) => {
      const turns = Array.from({ length: 8 }, (_, index) => [
        `send "resize-${index}\\r"`,
        `expect "LONG_RESPONSE_${index}"`,
      ]).join("\n");
      const result = await runExpect({
        env: openAiEnv(provider.baseUrl, join(directory, "memory.json")),
        timeoutMs: 20000,
        script: `
          log_user 1
          spawn {${process.execPath}} {${cliPath}}
          stty rows 24 columns 80
          expect "SIGNAL LOOM"
          expect "Type your message"
          sleep 1
          ${turns}
          stty rows 12 columns 52
          expect "rows above"
          stty rows 30 columns 100
          expect "rows above"
          send "exit\\r"
          expect eof
        `,
      });
      assertExpectPassed(result, "Ink viewport resize");
    });
  } finally {
    await provider.close();
  }
}

async function evaluateInkIdleCtrlC() {
  await withTempDir(async (directory) => {
    const result = await runExpect({
      env: {
        DEV_AGENT_TUI: "ink",
        DEV_AGENT_MCP_SERVERS: "[]",
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_MEMORY_FILE: join(directory, "memory.json"),
      },
      timeoutMs: 10000,
      script: `
        log_user 1
        spawn {${process.execPath}} {${cliPath}}
        expect "Type your message"
        sleep 1
        send "\\003"
        expect eof
        puts "CHILD_STATUS=[wait]"
      `,
    });
    assertExpectPassed(result, "Ink idle Ctrl-C");
    if (!result.skipped) {
      assert.match(result.stdout, /CHILD_STATUS=.*\b0 0\b/);
    }
  });
}

async function evaluateApprovalAndToolLoop() {
  await withTempDir(async (directory) => {
    const provider = await startToolProvider(join(directory, "approval-target"));
    try {
      const result = await runExpect({
        env: openAiEnv(provider.baseUrl, join(directory, "memory.json")),
        timeoutMs: 15000,
        script: `
          log_user 1
          spawn {${process.execPath}} {${cliPath}} {--approval} {ask}
          expect "SIGNAL LOOM"
          send "run tool\\r"
          expect "y / n"
          send "n\\r"
          expect "tool-loop-finished"
          expect "\\[state=done turns=1\\]"
          send "exit\\r"
          expect eof
        `,
      });
      assertExpectPassed(result, "Ink approval");
      if (!result.skipped) {
        assert.equal(provider.requests.length, 2);
      }
    } finally {
      await provider.close();
    }
  });
}

async function evaluateInkCommandPalette() {
  await withTempDir(async (directory) => {
    const result = await runExpect({
      env: {
        DEV_AGENT_TUI: "ink",
        DEV_AGENT_MCP_SERVERS: "[]",
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_MEMORY_FILE: join(directory, "memory.json"),
      },
      timeoutMs: 10000,
      script: `
        log_user 1
        spawn {${process.execPath}} {${cliPath}}
        stty rows 30 columns 64
        expect "SIGNAL LOOM"
        send "/h"
        expect "COMMANDS // DECK"
        send "\\003"
        expect eof
      `,
    });
    assertExpectPassed(result, "Ink command palette");
  });
}

async function evaluateEof() {
  await withTempDir(async (directory) => {
    const result = await runNode({
      executable: process.execPath,
      args: [cliPath],
      env: {
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_MCP_SERVERS: "[]",
        DEV_AGENT_MEMORY_FILE: join(directory, "memory.json"),
      },
      input: "",
      timeoutMs: 10000,
    });
    assert.equal(result.code, 0, `EOF exited with ${result.code}\n${result.stderr}`);
    assert.equal(result.signal, null);
  });
}

async function evaluateSkills() {
  const provider = await startJsonCaptureProvider();
  try {
    await withTempDir(async (directory) => {
      await mkdir(join(directory, ".dev-agent", "skills", "review"), { recursive: true });
      await writeFile(
        join(directory, ".dev-agent", "skills", "review", "SKILL.md"),
        [
          "---",
          "name: review",
          "description: Review changed files",
          "---",
          "When active, inspect changed files and cite exact path and line evidence.",
        ].join("\n"),
      );

      const child = spawn(
        process.execPath,
        [cliPath, "--no-stream", "--cwd", directory],
        {
          env: openAiEnv(provider.baseUrl, join(directory, "memory.json")),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      try {
        await waitForText(() => stdout, "dev-agent CLI.");
        child.stdin.write(":skills\n");
        await waitForText(() => stdout, "Available skills");
        child.stdin.write(":skill review\n");
        await waitForText(() => stdout, "Skill activated: review");
        child.stdin.write("inspect\n");
        await waitForText(() => stdout, "[state=done turns=1]");
        child.stdin.write(":skill off\n");
        await waitForText(() => stdout, "Skill deactivated.");
        child.stdin.write("inspect again\n");
        await waitForText(() => stdout, "[state=done turns=2]");
        child.stdin.write("exit\n");
        const result = await waitForChildExit(child, 5000);
        assert.equal(result.code, 0, `${stdout}\n${stderr}`);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
      assert.match(stdout, /Available skills/);
      assert.match(stdout, /Skill activated: review/);
      assert.match(stdout, /Skill deactivated\./);
      assert.equal(provider.requests.length, 2);
      assert.match(provider.requests[0], /Active skill: review/);
      assert.match(provider.requests[0], /exact path and line evidence/);
      assert.doesNotMatch(provider.requests[1], /Active skill: review/);
    });
  } finally {
    await provider.close();
  }
}

const cases = [
  ["Ink queue and streaming", evaluateInkQueue],
  ["Ink viewport navigation", evaluateInkViewportNavigation],
  ["Ink viewport resize", evaluateInkResizeViewport],
  ["Ink idle Ctrl-C", evaluateInkIdleCtrlC],
  ["Ink approval", evaluateApprovalAndToolLoop],
  ["Ink command palette", evaluateInkCommandPalette],
  ["EOF", evaluateEof],
  ["Skills activation and deactivation", evaluateSkills],
];
const requestedCases = process.env.DEV_AGENT_EVAL_ONLY
  ?.split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const selectedCases = requestedCases === undefined
  ? cases
  : cases.filter(([name]) => requestedCases.includes(name));

if (!expectAvailable) {
  console.log("SKIP PTY evaluations: expect is unavailable");
}

for (const [name, evaluate] of selectedCases) {
  await evaluate();
  console.log(`PASS ${name}`);
}

console.log(`CLI behavior evaluations passed (${selectedCases.length} cases)`);
