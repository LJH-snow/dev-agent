import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

async function startStubProvider(target: string, content: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let requests = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests += 1;
      const parsed = JSON.parse(body);
      const hasToolResult = parsed.messages.some((message: any) => message.role === "tool");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message:
                requests === 1 && !hasToolResult
                  ? {
                      content: "",
                      tool_calls: [
                        {
                          id: "call_validation_write",
                          type: "function",
                          function: {
                            name: "filesystem",
                            arguments: JSON.stringify({
                              action: "write",
                              path: target,
                              content,
                            }),
                          },
                        },
                      ],
                    }
                  : { content: "done" },
            },
          ],
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as any;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(input);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function createGitWorkspace(): Promise<{ dir: string; target: string }> {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-validation-cli-"));
  const target = join(dir, "target.md");
  await execFileAsync("git", ["init", "--quiet"], { cwd: dir });
  await writeFile(target, "keep\n", "utf8");
  await execFileAsync("git", ["add", "target.md"], { cwd: dir });
  return { dir, target };
}

function environment(dir: string, providerBaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    INIT_CWD: dir,
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: providerBaseUrl,
    DEV_AGENT_MEMORY_FILE: join(dir, "session.json"),
  };
}

test("CLI reports a passed validation after an approved apply", async () => {
  const workspace = await createGitWorkspace();
  const provider = await startStubProvider(workspace.target, "changed\n");
  try {
    const result = await runCli(
      ["--once", "change and verify", "--no-stream", "--json", "--approval", "review-writes"],
      environment(workspace.dir, provider.baseUrl),
      "y\n"
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(workspace.target, "utf8"), "changed\n");
    const payload = JSON.parse(result.stdout);
    assert.ok(Array.isArray(payload.validations));
    assert.equal(payload.validations.length, 1);
    assert.equal(payload.validations[0].changeSetId, payload.reviews[0].changeSetId);
    assert.equal(payload.validations[0].status, "passed");
    assert.equal(payload.validations[0].checks[0].id, "workspace:diff-check");
    assert.match(result.stdout.trim(), /^\{.*\}$/s);
  } finally {
    await provider.close();
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

test("CLI JSON includes validation evidence persisted by an earlier run", async () => {
  const workspace = await createGitWorkspace();
  const provider = await startStubProvider(workspace.target, "changed\n");
  try {
    const env = environment(workspace.dir, provider.baseUrl);
    const first = await runCli(
      ["--once", "change and verify", "--no-stream", "--json", "--approval", "review-writes"],
      env,
      "y\n"
    );
    assert.equal(first.code, 0, first.stderr);
    const firstPayload = JSON.parse(first.stdout);
    const expectedChangeSetId = firstPayload.reviews[0].changeSetId;

    const second = await runCli(
      ["--once", "show the saved validation", "--no-stream", "--json"],
      env,
      ""
    );
    assert.equal(second.code, 0, second.stderr);
    const payload = JSON.parse(second.stdout);
    assert.equal(payload.validations.length, 1);
    assert.equal(payload.validations[0].changeSetId, expectedChangeSetId);
    assert.equal(payload.validations[0].status, "passed");
    assert.equal(typeof payload.validations[0].recordedAt, "string");
  } finally {
    await provider.close();
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

test("CLI human output includes validation status, check id, and command summary", async () => {
  const workspace = await createGitWorkspace();
  const provider = await startStubProvider(workspace.target, "changed\n");
  try {
    const result = await runCli(
      ["--once", "change and verify", "--no-stream", "--approval", "review-writes"],
      environment(workspace.dir, provider.baseUrl),
      "y\n"
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\[validation\] passed/);
    assert.match(result.stdout, /workspace:diff-check/);
    assert.match(result.stdout, /git diff --check/);
  } finally {
    await provider.close();
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

test("CLI reports validation failure without undoing the applied change", async () => {
  const workspace = await createGitWorkspace();
  const provider = await startStubProvider(workspace.target, "changed \n");
  try {
    const result = await runCli(
      ["--once", "change and verify", "--no-stream", "--json", "--approval", "review-writes"],
      environment(workspace.dir, provider.baseUrl),
      "y\n"
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(workspace.target, "utf8"), "changed \n");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validations.length, 1);
    assert.equal(payload.validations[0].status, "failed");
    assert.match(payload.validations[0].checks[0].reason, /exited with code|whitespace/i);
    assert.match(payload.validations[0].checks[0].output, /whitespace/i);
  } finally {
    await provider.close();
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

test("CLI keeps a non-git workspace safe by returning a skipped validation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-validation-non-git-"));
  const target = join(dir, "target.bin");
  await writeFile(target, "keep\n", "utf8");
  const provider = await startStubProvider(target, "changed\n");
  try {
    const result = await runCli(
      ["--once", "change and verify", "--no-stream", "--json", "--approval", "review-writes"],
      environment(dir, provider.baseUrl),
      "y\n"
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(target, "utf8"), "changed\n");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validations.length, 1);
    assert.equal(payload.validations[0].status, "skipped");
    assert.match(payload.validations[0].reason, /safe validation/i);
  } finally {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  }
});
