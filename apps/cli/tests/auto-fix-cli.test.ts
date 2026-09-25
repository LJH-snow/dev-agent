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
              id: "call_repair_write",
              type: "function",
              function: {
                name: "filesystem",
                arguments: JSON.stringify({
                  action: "write",
                  path: "target.md",
                  content: "changed\n",
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
          OPENAI_API_KEY: "test-key",
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
        await waitFor(() => stdout.includes("[validation] failed"));
        child.stdin.write(":autofix 1\n");
        await waitFor(() => (stdout.match(/Apply this change\?/g) ?? []).length >= 2);
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
