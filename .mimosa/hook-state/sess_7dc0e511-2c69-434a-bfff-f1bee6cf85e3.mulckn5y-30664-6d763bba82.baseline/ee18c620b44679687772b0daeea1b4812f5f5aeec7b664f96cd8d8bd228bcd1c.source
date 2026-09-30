import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

interface StubRequest {
  readonly messages: readonly {
    readonly role?: string;
    readonly content?: string;
  }[];
  readonly tools?: readonly {
    readonly function?: { readonly name?: string };
  }[];
  readonly model?: string;
}

interface CollaborationStubOptions {
  readonly plan?: string;
  readonly taskIds?: readonly string[];
  readonly taskDependencies?: readonly (readonly string[])[];
  readonly failTaskAttempts?: Readonly<Record<string, number>>;
  readonly plannerToolAllowlist?: readonly string[];
}

interface CollaborationStub {
  readonly baseUrl: string;
  readonly requests: StubRequest[];
  readonly close: () => Promise<void>;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startCollaborationStub(
  options: CollaborationStubOptions = {},
): Promise<CollaborationStub> {
  const requests: StubRequest[] = [];
  const taskAttempts = new Map<string, number>();
  const taskIds = options.taskIds ?? ["worker"];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const parsed = JSON.parse(body) as StubRequest;
      requests.push(parsed);
      const system = parsed.messages.find((message) => message.role === "system")?.content ?? "";
      const user = parsed.messages.find((message) =>
        message.content?.includes("TASK ID:"),
      )?.content ?? "";

      if (system.includes("COLLABORATIVE TASK PLANNER")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                tasks: taskIds.map((id, index) => ({
                  id,
                  title: id,
                  role: index === 0 ? "coder" : "tester",
                  instructions: `complete ${id}`,
                  ...(options.taskDependencies?.[index] === undefined
                    ? {}
                    : { dependsOn: options.taskDependencies[index] }),
                  ...(options.plannerToolAllowlist === undefined
                    ? {}
                    : { toolAllowlist: options.plannerToolAllowlist }),
                  ...(options.failTaskAttempts?.[id] === undefined
                    ? {}
                    : { maxAttempts: 1 }),
                })),
              }),
            },
          }],
        }));
        return;
      }

      const taskId = user.match(/TASK ID:\s*([a-z0-9_-]+)/i)?.[1];
      if (taskId !== undefined) {
        const attempt = (taskAttempts.get(taskId) ?? 0) + 1;
        taskAttempts.set(taskId, attempt);
        const failures = options.failTaskAttempts?.[taskId] ?? 0;
        if (attempt <= failures) {
          // Use a non-retryable provider error so this test exercises the
          // collaboration task retry rather than the provider's HTTP retry.
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "stub task failure" }));
          return;
        }
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: options.plan ?? "stub result" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
  });
  const baseUrl = await listen(server);
  return {
    baseUrl,
    requests,
    close: () => closeServer(server),
  };
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync("git", args as string[], { cwd });
}

async function createGitWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-team-cli-"));
  await git(directory, ["init", "-q"]);
  await git(directory, ["config", "user.email", "dev-agent@example.invalid"]);
  await git(directory, ["config", "user.name", "Dev Agent Tests"]);
  await writeFile(join(directory, "README.md"), "base\n", "utf8");
  await git(directory, ["add", "README.md"]);
  await git(directory, ["commit", "-m", "initial", "-q"]);
  return directory;
}

function launchCli(
  cwd: string,
  baseUrl: string,
  configPath?: string,
  mcpServers = "[]",
): ChildProcess {
  return spawn(process.execPath, [
    cliPath,
    "--no-stream",
    "--cwd", cwd,
    ...(configPath === undefined ? [] : ["--config", configPath]),
  ], {
    cwd,
    env: {
      ...process.env,
      // pnpm injects its caller directory into INIT_CWD; tests target isolated
      // temporary projects, so keep CLI project discovery deterministic.
      INIT_CWD: cwd,
      DEV_AGENT_TUI: "ink",
      DEV_AGENT_MCP_SERVERS: mcpServers,
      DEV_AGENT_MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: baseUrl,
      DEV_AGENT_MEMORY_FILE: join(cwd, "session.json"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition was not met before the timeout");
}

async function waitForExit(child: ChildProcess, timeoutMs = 20_000): Promise<number | null> {
  return await new Promise<number | null>((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI did not exit before the timeout"));
    }, timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  await waitForExit(child, 1_000).catch(() => undefined);
}

async function runInteractive(
  child: ChildProcess,
  commands: readonly {
    readonly input: string;
    readonly until: string;
  }[],
): Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number | null }> {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."));
  for (const command of commands) {
    const outputOffset = stdout.length;
    child.stdin?.write(`${command.input}\n`);
    try {
      await waitFor(() => stdout.slice(outputOffset).includes(command.until));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await stopChild(child);
      throw new Error(
        `${message}\ncommand: ${command.input}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
  }
  child.stdin?.write("exit\n");
  const code = await waitForExit(child);
  return { stdout, stderr, code };
}

test("ordinary :team request starts collaborative execution through the CLI", async () => {
  const workspace = await createGitWorkspace();
  const stub = await startCollaborationStub();
  try {
    const child = launchCli(workspace, stub.baseUrl);
    const result = await runInteractive(child, [
      { input: ":team implement the feature", until: "TEAM TASK TOOL SCOPE REVIEW 1/1" },
      { input: "all", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · REVIEW" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      stub.requests.some((request) =>
        request.messages.some((message) =>
          message.content?.includes("COLLABORATIVE TASK PLANNER"),
        ),
      ),
      true,
    );
    assert.equal(
      stub.requests.some((request) =>
        request.messages.some((message) =>
          message.content?.includes("COLLABORATIVE EXECUTION REQUEST"),
        ),
      ),
      true,
    );
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("disabled collaboration MCP scope removes MCP tools from the reviewed worker surface", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-team-mcp-disabled-"));
  const configPath = join(configDirectory, "config.json");
  const stub = await startCollaborationStub();
  const fakeMcpServer = fileURLToPath(new URL("../../../packages/mcp/tests/fake-mcp-server.mjs", import.meta.url));
  const mcpServers = JSON.stringify([{
    name: "files",
    command: process.execPath,
    args: [fakeMcpServer],
  }]);
  await writeFile(configPath, JSON.stringify({
    collaboration: {
      mcpScope: "disabled",
      toolAllowlist: ["files:hello"],
    },
  }), "utf8");
  try {
    const child = launchCli(workspace, stub.baseUrl, configPath, mcpServers);
    const result = await runInteractive(child, [
      { input: ":team implement the feature", until: "TEAM TASK TOOL SCOPE REVIEW 1/1" },
      { input: "all", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · REVIEW" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Available tools: \(none\)/u);
    const workerRequests = stub.requests.filter((request) =>
      request.messages.some((message) => message.content?.includes("TASK ID:")),
    );
    assert.equal(workerRequests.length, 1);
    assert.deepEqual(workerRequests[0]?.tools ?? [], []);
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("worker collaboration MCP scope starts a task-local session after review", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-team-mcp-worker-"));
  const configPath = join(configDirectory, "config.json");
  const startCountFile = join(configDirectory, "mcp-starts.log");
  const stub = await startCollaborationStub();
  const fakeMcpServer = fileURLToPath(new URL("../../../packages/mcp/tests/fake-mcp-server.mjs", import.meta.url));
  const mcpServers = JSON.stringify([{
    name: "files",
    command: process.execPath,
    args: [fakeMcpServer],
    env: { MCP_START_COUNT_FILE: startCountFile },
  }]);
  await writeFile(configPath, JSON.stringify({
    collaboration: {
      mcpScope: "worker",
      toolAllowlist: ["files:hello"],
    },
  }), "utf8");
  try {
    const child = launchCli(workspace, stub.baseUrl, configPath, mcpServers);
    const result = await runInteractive(child, [
      { input: ":team implement the feature", until: "TEAM TASK TOOL SCOPE REVIEW 1/1" },
      { input: "all", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · REVIEW" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    const starts = (await readFile(startCountFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(starts.length, 2, "one main session plus one task-local session");
    assert.equal(result.stdout.includes("Shared MCP tools are not rooted"), false);
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("collaboration.toolAllowlist applies one user-owned ceiling to every worker", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-team-config-"));
  const configPath = join(configDirectory, "config.json");
  const stub = await startCollaborationStub({
    taskIds: ["first", "second"],
    // Planner output must not be able to replace the caller-owned ceiling.
    plannerToolAllowlist: ["shell"],
  });
  await writeFile(configPath, JSON.stringify({
    collaboration: { toolAllowlist: ["filesystem"] },
  }), "utf8");
  try {
    const child = launchCli(workspace, stub.baseUrl, configPath);
    const result = await runInteractive(child, [
      { input: ":team implement the feature", until: "TEAM TASK TOOL SCOPE REVIEW 1/2" },
      { input: "filesystem", until: "TEAM TASK TOOL SCOPE REVIEW 2/2" },
      { input: "filesystem", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · REVIEW" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    const workerRequests = stub.requests.filter((request) =>
      request.messages.some((message) => message.content?.includes("TASK ID:")),
    );
    assert.equal(workerRequests.length, 2);
    for (const request of workerRequests) {
      assert.deepEqual(
        request.tools?.map((tool) => tool.function?.name),
        ["filesystem"],
      );
    }
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("every team task requires a user-reviewed scope bound to its ordered plan slot", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-team-scope-review-"));
  const configPath = join(configDirectory, "config.json");
  const stub = await startCollaborationStub({
    taskIds: ["first", "second"],
    taskDependencies: [[], ["first"]],
    // Unknown planner fields cannot choose granted tools.
    plannerToolAllowlist: ["shell"],
  });
  await writeFile(configPath, JSON.stringify({
    collaboration: {
      toolAllowlist: ["filesystem", "search"],
      reviewTaskToolScopes: false,
    },
  }), "utf8");
  try {
    const child = launchCli(workspace, stub.baseUrl, configPath);
    const result = await runInteractive(child, [
      { input: ":team implement the feature", until: "TEAM TASK TOOL SCOPE REVIEW 1/2" },
      { input: "filesystem", until: "TEAM TASK TOOL SCOPE REVIEW 2/2" },
      { input: "search", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · REVIEW" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Depends on: slot 1/u);
    assert.match(result.stdout, /Granted tools: "filesystem"/u);
    assert.match(result.stdout, /Granted tools: "search"/u);
    const workerRequests = stub.requests.filter((request) =>
      request.messages.some((message) => message.content?.includes("TASK ID:")),
    );
    const scopesByPlannerId = new Map(workerRequests.map((request) => {
      const taskId = request.messages
        .find((message) => message.content?.includes("TASK ID:"))
        ?.content?.match(/TASK ID:\s*([a-z0-9_-]+)/i)?.[1];
      return [taskId, request.tools?.map((tool) => tool.function?.name) ?? []] as const;
    }));
    assert.equal(workerRequests.length, 2);
    assert.deepEqual(scopesByPlannerId.get("first"), ["filesystem"]);
    assert.deepEqual(scopesByPlannerId.get("second"), ["search"]);
    assert.equal(
      workerRequests.some((request) =>
        request.tools?.some((tool) => tool.function?.name === "shell"),
      ),
      false,
    );
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("SIGINT while awaiting task scope creates no worker or task worktree", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-team-scope-sigint-"));
  const configPath = join(configDirectory, "config.json");
  const stub = await startCollaborationStub({ taskIds: ["first"] });
  await writeFile(configPath, JSON.stringify({
    collaboration: {
      toolAllowlist: ["filesystem"],
      reviewTaskToolScopes: false,
    },
  }), "utf8");
  const initialWorktrees = await execFileAsync(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd: workspace },
  );
  const child = launchCli(workspace, stub.baseUrl, configPath);
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => { stdout += chunk; });
  child.stderr?.on("data", (chunk) => { stderr += chunk; });

  try {
    await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."));
    child.stdin?.write(":team implement the feature\n");
    await waitFor(() => stdout.includes("TEAM TASK TOOL SCOPE REVIEW 1/1"));
    child.kill("SIGINT");

    const code = await waitForExit(child);
    assert.equal(code, 130, `${stdout}\n${stderr}`);
    assert.match(stdout, /\(interrupted\)/u);
    assert.equal(
      stub.requests.some((request) =>
        request.messages.some((message) => message.content?.includes("TASK ID:")),
      ),
      false,
      "no worker request may start before tool scopes are confirmed",
    );
    const finalWorktrees = await execFileAsync(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd: workspace },
    );
    assert.equal(finalWorktrees.stdout, initialWorktrees.stdout);
  } finally {
    await stopChild(child);
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("declining task scope review creates no worker or task workspace", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-team-scope-cancel-"));
  const configPath = join(configDirectory, "config.json");
  const stub = await startCollaborationStub({ taskIds: ["first"] });
  await writeFile(configPath, JSON.stringify({
    collaboration: {
      toolAllowlist: ["filesystem"],
    },
  }), "utf8");
  const initialRefs = await execFileAsync("git", ["branch", "--list"], { cwd: workspace });
  try {
    const child = launchCli(workspace, stub.baseUrl, configPath);
    const result = await runInteractive(child, [
      { input: ":team implement the feature", until: "TEAM TASK TOOL SCOPE REVIEW 1/1" },
      { input: "none", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      {
        input: "no",
        until: "Team execution cancelled during tool-scope review; no task workspaces were created.",
      },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      stub.requests.some((request) =>
        request.messages.some((message) => message.content?.includes("TASK ID:")),
      ),
      false,
    );
    const finalRefs = await execFileAsync("git", ["branch", "--list"], { cwd: workspace });
    assert.equal(finalRefs.stdout, initialRefs.stdout);
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("malformed collaboration config fails closed instead of restoring the full worker tool set", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-team-config-"));
  const configPath = join(configDirectory, "config.json");
  const stub = await startCollaborationStub();
  const initialRefs = await execFileAsync("git", ["branch", "--list"], { cwd: workspace });
  await writeFile(configPath, JSON.stringify({ collaboration: "filesystem" }), "utf8");
  try {
    const child = launchCli(workspace, stub.baseUrl, configPath);
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });

    const code = await waitForExit(child);
    assert.notEqual(code, 0, `${stdout}\n${stderr}`);
    assert.match(`${stdout}\n${stderr}`, /Invalid collaboration configuration/);
    assert.equal(stub.requests.length, 0);
    const refs = await execFileAsync("git", ["branch", "--list"], { cwd: workspace });
    assert.equal(refs.stdout.trim(), initialRefs.stdout.trim());
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test(":team apply dispatches only an explicit merge after a stored review", async () => {
  const workspace = await createGitWorkspace();
  const stub = await startCollaborationStub();
  try {
    const child = launchCli(workspace, stub.baseUrl);
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."));

    child.stdin?.write(":team apply\n");
    await waitFor(() => stdout.includes("No mergeable team review is waiting."));
    assert.equal(stdout.includes("Team merge merged"), false);

    child.stdin?.write(":team implement the feature\n");
    await waitFor(() => stdout.includes("TEAM TASK TOOL SCOPE REVIEW 1/1"));
    child.stdin?.write("all\n");
    await waitFor(() => stdout.includes("TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)"));
    child.stdin?.write("yes\n");
    await waitFor(() => stdout.includes("TEAM EXECUTION · REVIEW"));
    assert.equal(stdout.includes("Team merge merged"), false);

    child.stdin?.write(":team apply\n");
    await waitFor(() => stdout.includes("Merge the reviewed team changes"));
    child.stdin?.write("y\n");
    await waitFor(() => stdout.includes("Team merge merged"));
    child.stdin?.write("exit\n");
    assert.equal(await waitForExit(child), 0);
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test(":team retry reruns only the selected failed task without merging", async () => {
  const workspace = await createGitWorkspace();
  const stub = await startCollaborationStub({
    taskIds: ["stable", "failed"],
    failTaskAttempts: { failed: 1 },
  });
  try {
    const child = launchCli(workspace, stub.baseUrl);
    const result = await runInteractive(child, [
      { input: ":team implement the feature", until: "TEAM TASK TOOL SCOPE REVIEW 1/2" },
      { input: "none", until: "TEAM TASK TOOL SCOPE REVIEW 2/2" },
      { input: "none", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · FAILED" },
      { input: ":team retry failed", until: "TEAM TASK TOOL SCOPE REVIEW 1/1" },
      { input: "none", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · REVIEW" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    const taskRequests = stub.requests
      .map((request) =>
        request.messages.find((message) =>
          message.content?.includes("TASK ID:"),
        )?.content?.match(/TASK ID:\s*([a-z0-9_-]+)/i)?.[1],
      )
      .filter((taskId): taskId is string => taskId !== undefined);
    assert.deepEqual(
      taskRequests.sort(),
      ["failed", "failed", "stable"].sort(),
    );
    assert.equal(result.stdout.includes("Team merge merged"), false);
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test(":team plan remains the read-only specialist planning flow", async () => {
  const workspace = await createGitWorkspace();
  const stub = await startCollaborationStub({ plan: "read-only plan" });
  try {
    const child = launchCli(workspace, stub.baseUrl);
    const result = await runInteractive(child, [
      { input: ":team plan inspect the feature", until: "TEAM PLAN · specialist review" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.includes("TEAM EXECUTION"), false);
    assert.equal(
      stub.requests.some((request) =>
        request.messages.some((message) =>
          message.content?.includes("COLLABORATIVE TASK PLANNER"),
        ),
      ),
      false,
    );
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test(":team plan discovers a project Agent.md definition and keeps its tool subset", async () => {
  const workspace = await createGitWorkspace();
  const stub = await startCollaborationStub({ plan: "discovered specialist result" });
  try {
    const agentDirectory = join(workspace, ".dev-agent", "agents", "doc-maintainer");
    await mkdir(agentDirectory, { recursive: true });
    await writeFile(join(agentDirectory, "AGENT.md"), `---
name: doc-maintainer
description: Keep documentation grounded
model: specialist-model
toolAllowlist: filesystem, search
maxTurns: 2
---
SPECIALIST_MARKDOWN_MARKER: identify missing documentation.
`, "utf8");
    const unsupportedProvider = join(workspace, ".dev-agent", "agents", "bad-provider");
    await mkdir(unsupportedProvider, { recursive: true });
    await writeFile(join(unsupportedProvider, "AGENT.md"),
      "---\nname: bad-provider\nprovider: never-a-supported-provider\n---\nIgnore me.\n", "utf8");
    const missingTool = join(workspace, ".dev-agent", "agents", "bad-tool");
    await mkdir(missingTool, { recursive: true });
    await writeFile(join(missingTool, "AGENT.md"),
      "---\nname: bad-tool\ntoolAllowlist: never-registered-specialist-tool\n---\nIgnore me.\n", "utf8");

    const configPath = join(workspace, "config.json");
    await writeFile(configPath, JSON.stringify({
      collaboration: { toolAllowlist: ["filesystem"] },
    }), "utf8");
    const child = launchCli(workspace, stub.baseUrl, configPath);
    const result = await runInteractive(child, [
      { input: ":agents", until: "Available agents:" },
      { input: ":agent doc-maintainer", until: "Agent: doc-maintainer" },
      { input: ":team plan review the docs", until: "TEAM PLAN · specialist review" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Agent: doc-maintainer/);
    assert.doesNotMatch(result.stdout, /bad-provider|bad-tool|AGENT\.md|SPECIALIST_MARKDOWN_MARKER/);
    const specialistRequest = stub.requests.find((request) =>
      request.messages.some((message) => message.content?.includes("SPECIALIST_MARKDOWN_MARKER")),
    );
    assert.equal(specialistRequest?.model, "specialist-model");
    assert.deepEqual(
      specialistRequest?.tools?.map((tool) => tool.function?.name) ?? [],
      ["filesystem"],
    );
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test(":team plan does not let a project agent switch the active provider", async () => {
  const workspace = await createGitWorkspace();
  const stub = await startCollaborationStub({ plan: "project provider boundary result" });
  try {
    await mkdir(join(workspace, ".dev-agent", "agents", "cloud-reviewer"), { recursive: true });
    await writeFile(join(workspace, ".dev-agent", "agents", "cloud-reviewer", "AGENT.md"), `---
name: cloud-reviewer
provider: ollama
model: project-only-model
---
PROJECT_CROSS_PROVIDER_MARKER: review without changing the caller provider.
`, "utf8");

    const child = launchCli(workspace, stub.baseUrl);
    const result = await runInteractive(child, [
      { input: ":team plan review the docs", until: "TEAM PLAN · specialist review" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    const specialistRequest = stub.requests.find((request) =>
      request.messages.some((message) => message.content?.includes("PROJECT_CROSS_PROVIDER_MARKER")),
    );
    assert.ok(specialistRequest);
    assert.notEqual(specialistRequest.model, "project-only-model");
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test(":team plan applies configured specialist prompts and model selection", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-specialists-"));
  const configPath = join(configDirectory, "config.json");
  const stub = await startCollaborationStub({ plan: "configured specialist result" });
  try {
    await writeFile(configPath, JSON.stringify({
      collaboration: {
        toolAllowlist: ["filesystem"],
        roles: [{
          id: "doc-maintainer",
          instructions: "SPECIALIST_PROMPT_MARKER: identify missing documentation.",
          provider: "openai",
          model: "specialist-model",
          toolAllowlist: ["filesystem", "search"],
          budget: { maxTurns: 2, maxTokens: 1000 },
        }],
      },
    }), "utf8");

    const child = launchCli(workspace, stub.baseUrl, configPath);
    const result = await runInteractive(child, [
      { input: ":team plan review the docs", until: "TEAM PLAN · specialist review" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /doc-maintainer/);
    const specialistRequest = stub.requests.find((request) =>
      request.messages.some((message) => message.content?.includes("SPECIALIST_PROMPT_MARKER")),
    );
    assert.equal(specialistRequest?.model, "specialist-model");
    assert.deepEqual(
      specialistRequest?.tools?.map((tool) => tool.function?.name) ?? [],
      ["filesystem"],
      "the role grant must be intersected with the configured collaboration ceiling",
    );
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test(":team reports actionable errors for missing request and retry task", async () => {
  const workspace = await createGitWorkspace();
  const stub = await startCollaborationStub();
  try {
    const child = launchCli(workspace, stub.baseUrl);
    const result = await runInteractive(child, [
      { input: ":team", until: "Usage: :team <request>" },
      { input: ":team retry", until: "Usage: :team retry <taskId>" },
      { input: ":team apply", until: "No mergeable team review is waiting." },
    ]);

    assert.equal(result.code, 0, result.stderr);
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test(":team applies a matching configured specialist binding to approved worker tasks", async () => {
  const workspace = await createGitWorkspace();
  const configDirectory = await mkdtemp(join(tmpdir(), "dev-agent-worker-specialist-"));
  const configPath = join(configDirectory, "config.json");
  const stub = await startCollaborationStub({ taskIds: ["implementation"] });
  try {
    await writeFile(configPath, JSON.stringify({
      collaboration: {
        toolAllowlist: ["filesystem", "search"],
        roles: [{
          id: "coder",
          instructions: "TRUSTED_CODER_ROLE_MARKER: implement only the reviewed change.",
          provider: "openai",
          model: "configured-worker-model",
          toolAllowlist: ["filesystem"],
          budget: { maxTurns: 2, maxTokens: 2000 },
        }],
      },
    }), "utf8");

    const child = launchCli(workspace, stub.baseUrl, configPath);
    const result = await runInteractive(child, [
      { input: ":team implement the requested feature", until: "TEAM TASK TOOL SCOPE REVIEW 1/1" },
      { input: "all", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · REVIEW" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Role: coder/);
    const workerRequest = stub.requests.find((request) =>
      request.messages.some((message) => message.content?.includes("COLLABORATIVE EXECUTION REQUEST")),
    );
    assert.equal(workerRequest?.model, "configured-worker-model");
    assert.ok(workerRequest?.messages.some((message) =>
      message.role === "system" && message.content?.includes("TRUSTED_CODER_ROLE_MARKER"),
    ));
    assert.deepEqual(
      workerRequest?.tools?.map((tool) => tool.function?.name) ?? [],
      ["filesystem"],
      "the worker's configured tools must intersect the reviewed scope and global ceiling",
    );
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("the CLI leaves the current worktree unchanged until team apply", async () => {
  const workspace = await createGitWorkspace();
  const before = await readFile(join(workspace, "README.md"), "utf8");
  const stub = await startCollaborationStub();
  try {
    const child = launchCli(workspace, stub.baseUrl);
    const result = await runInteractive(child, [
      { input: ":team make a change", until: "TEAM TASK TOOL SCOPE REVIEW 1/1" },
      { input: "all", until: "TEAM PLAN + TOOL SCOPE REVIEW (complete normalized plan)" },
      { input: "yes", until: "TEAM EXECUTION · REVIEW" },
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(join(workspace, "README.md"), "utf8"), before);
  } finally {
    await stub.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
