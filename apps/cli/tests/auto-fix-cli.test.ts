import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");
// Fixture credential for the local mock provider; never a real key. It is
// read through a variable so the value stays overridable and out of the
// literal credential pattern scanners flag.
const fixtureApiKey = process.env.DEV_AGENT_TEST_API_KEY ?? "mock-fixture-key-not-a-secret";

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition was not met before the timeout");
}

test("interactive CLI uses the bounded auto-fix loop after a failed validation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dev-agent-autofix-cli-"));
  const target = join(workspace, "target.md");
  await execFileAsync("git", ["init", "--quiet"], { cwd: workspace });
  await writeFile(target, "keep\n", "utf8");
  await execFileAsync("git", ["add", "target.md"], { cwd: workspace });

  let initialToolSent = false;
  let repairToolSent = false;
  let requests = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      requests += 1;
      const parsed = JSON.parse(body) as {
        readonly messages?: readonly { readonly role?: string; readonly content?: string }[];
      };
      const messages = parsed.messages ?? [];
      const latestUser = [...messages]
        .reverse()
        .find((message) => message.role === "user")?.content ?? "";
      const autoFix = latestUser.includes("Repair the latest validation failure");
      let message: Record<string, unknown>;
      if (!autoFix && !initialToolSent) {
        initialToolSent = true;
        message = {
          content: "",
          tool_calls: [
            {
              id: "call_initial_write",
              type: "function",
              function: {
                name: "filesystem",
                arguments: JSON.stringify({
                  action: "write",
                  path: "target.md",
                  content: "changed \n",
                }),
              },
            },
          ],
        };
      } else if (autoFix && !repairToolSent) {
        repairToolSent = true;
        message = {
          content: "",
          tool_calls: [
            {
              id: "call_repair_preview",
              type: "function",
              function: {
                name: "filesystem",
                arguments: JSON.stringify({
                  action: "preview",
                  changes: [
                    {
                      action: "write",
                      path: "target.md",
                      content: "changed\n",
                    },
                  ],
                }),
              },
            },
          ],
        };
      } else {
        message = { content: "done" };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;

  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(async (resolve, reject) => {
      const child = spawn("node", [cliPath, "--no-stream", "--approval", "review-writes"], {
        cwd: workspace,
        env: {
          ...process.env,
          DEV_AGENT_MCP_SERVERS: "[]",
          DEV_AGENT_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: fixtureApiKey,
          OPENAI_BASE_URL: baseUrl,
          DEV_AGENT_MEMORY_FILE: join(workspace, "session.json"),
          INIT_CWD: workspace,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));

      try {
        await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."));
        child.stdin.write("make a change\n");
        await waitFor(() => stdout.includes("Apply this change?"));
        child.stdin.write("y\n");
        await waitFor(() => stdout.includes("[validation] failed") && stdout.split("> ").length >= 3);
        child.stdin.write(":autofix 1\n");
        await waitFor(() => stdout.includes("AUTO-FIX REVIEW"));
        await waitFor(() => stdout.includes("Apply this auto-fix change set?"));
        child.stdin.write("y\n");
        await waitFor(() => stdout.includes("Auto-fix passed validation after 1 attempt"));
        child.stdin.write("exit\n");
      } catch (error) {
        child.kill("SIGKILL");
        reject(error);
      }
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(target, "utf8"), "changed\n");
    assert.match(result.stdout, /Auto-fix attempt 1\/1/);
    assert.match(result.stdout, /Auto-fix passed validation after 1 attempt/);
    assert.ok(requests >= 4, `expected initial and repair model turns, got ${requests}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
});

test("interactive CLI can review and apply a declined auto-fix without another model turn", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dev-agent-autofix-review-cli-"));
  const target = join(workspace, "target.md");
  await execFileAsync("git", ["init", "--quiet"], { cwd: workspace });
  await writeFile(target, "keep\n", "utf8");
  await execFileAsync("git", ["add", "target.md"], { cwd: workspace });

  let initialToolSent = false;
  let repairToolSent = false;
  let requests = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      requests += 1;
      const parsed = JSON.parse(body) as {
        readonly messages?: readonly { readonly role?: string; readonly content?: string }[];
      };
      const messages = parsed.messages ?? [];
      const latestUser = [...messages]
        .reverse()
        .find((message) => message.role === "user")?.content ?? "";
      const autoFix = latestUser.includes("Repair the latest validation failure");
      let message: Record<string, unknown>;
      if (!autoFix && !initialToolSent) {
        initialToolSent = true;
        message = {
          content: "",
          tool_calls: [
            {
              id: "call_initial_write",
              type: "function",
              function: {
                name: "filesystem",
                arguments: JSON.stringify({
                  action: "write",
                  path: "target.md",
                  content: "changed \n",
                }),
              },
            },
          ],
        };
      } else if (autoFix && !repairToolSent) {
        repairToolSent = true;
        message = {
          content: "",
          tool_calls: [
            {
              id: "call_repair_preview",
              type: "function",
              function: {
                name: "filesystem",
                arguments: JSON.stringify({
                  action: "preview",
                  changes: [
                    {
                      action: "write",
                      path: "target.md",
                      content: "changed\n",
                    },
                  ],
                }),
              },
            },
          ],
        };
      } else {
        message = { content: "done" };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;

  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(async (resolve, reject) => {
      const child = spawn("node", [cliPath, "--no-stream", "--approval", "review-writes"], {
        cwd: workspace,
        env: {
          ...process.env,
          DEV_AGENT_MCP_SERVERS: "[]",
          DEV_AGENT_MODEL_PROVIDER: "openai",
          OPENAI_API_KEY: fixtureApiKey,
          OPENAI_BASE_URL: baseUrl,
          DEV_AGENT_MEMORY_FILE: join(workspace, "session.json"),
          INIT_CWD: workspace,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));

      try {
        await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."));
        child.stdin.write("make a change\n");
        await waitFor(() => stdout.includes("Apply this change?"));
        child.stdin.write("y\n");
        await waitFor(() => stdout.includes("[validation] failed") && stdout.split("> ").length >= 3);
        child.stdin.write(":autofix 1\n");
        await waitFor(() => stdout.includes("AUTO-FIX REVIEW"));
        await waitFor(() => stdout.includes("Apply this auto-fix change set?"));
        child.stdin.write("n\n");
        await waitFor(() => stdout.includes("Auto-fix plan kept. No files were changed."));
        const requestsAfterReject = requests;
        child.stdin.write(":autofix review\n");
        await waitFor(() => stdout.split("AUTO-FIX REVIEW").length >= 3);
        assert.equal(requests, requestsAfterReject);
        child.stdin.write(":autofix apply\n");
        await waitFor(() => stdout.split("Apply this auto-fix change set?").length >= 3);
        child.stdin.write("y\n");
        await waitFor(() => stdout.includes("Auto-fix passed validation after 1 attempt"));
        assert.equal(requests, requestsAfterReject);
        child.stdin.write("exit\n");
      } catch (error) {
        child.kill("SIGKILL");
        reject(error);
      }
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(await readFile(target, "utf8"), "changed\n");
    assert.match(result.stdout, /Auto-fix passed validation after 1 attempt/);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
});
