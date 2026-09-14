import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createAgentContext,
  createValidationId,
  EVIDENCE_AUDIT_LIMIT_CAPS,
  FileMemory,
  InMemoryMemory,
  type ValidationAdapter,
  type ValidationPlan,
} from "@dev-agent/agent-core";
import { FilesystemTool } from "@dev-agent/tools";
import { runExplicitValidation } from "../dist/index.js";

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

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition was not met before the timeout");
}

function runCliInteractiveValidation(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  changeSetId: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
        settled = true;
        reject(new Error("the interactive CLI did not finish in time"));
      }
    }, 10000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      clearTimeout(timer);
      settled = true;
      resolve({ code, stdout, stderr });
    });

    void (async () => {
      try {
        await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."), 5000);
        child.stdin.write(`:validate ${changeSetId}\n`);
        await waitFor(() => stdout.includes(`"changeSetId": "${changeSetId}"`), 5000);
        child.stdin.write("exit\n");
      } catch (error) {
        if (settled) {
          return;
        }
        child.kill("SIGKILL");
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

function runCliInteractiveCleanup(
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
        settled = true;
        reject(new Error("the interactive cleanup CLI did not finish in time"));
      }
    }, 10000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({ code, stdout, stderr });
    });
    void (async () => {
      try {
        await waitFor(() => stdout.includes("Type 'exit' or 'quit' to stop."), 5000);
        child.stdin.write(":cleanup --remove-rolled-back\n");
        await waitFor(() => stdout.includes("Evidence cleanup"), 5000);
        child.stdin.write("exit\n");
      } catch (error) {
        if (settled) return;
        child.kill("SIGKILL");
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

function parseFirstJsonObject(output: string): any {
  const start = output.indexOf("{");
  assert.ok(start >= 0, `expected JSON object in output: ${output}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(output.slice(start, index + 1));
      }
    }
  }
  assert.fail(`incomplete JSON object in output: ${output}`);
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

async function seedEvidenceMemory(filePath: string, workingDirectory: string): Promise<void> {
  const memory = new FileMemory({ filePath });
  const record = {
    changeSetId: "cleanup-active",
    sessionId: "default",
    workingDirectory,
    files: [
      {
        path: "target.md",
        kind: "file" as const,
        afterHash: "a".repeat(64),
        additions: 1,
        deletions: 0,
        beforeExists: true,
        afterExists: true,
      },
    ],
    additions: 1,
    deletions: 0,
    createdAt: "2026-09-13T00:00:00.000Z",
    recordedAt: "2026-09-13T00:00:01.000Z",
    state: "applied" as const,
  };
  await memory.recordChangeSet(record);
  await memory.recordChangeSet({ ...record, changeSetId: "cleanup-rolled" });
  await memory.markChangeSetRolledBack("cleanup-rolled");
}

test("CLI cleanup reports protected evidence and removes only rolled-back records", async () => {
  const workspace = await createGitWorkspace();
  const memoryFile = join(workspace.dir, "session.json");
  try {
    await seedEvidenceMemory(memoryFile, workspace.dir);
    const result = await runCli(
      ["--cleanup-evidence", "--remove-rolled-back", "--json"],
      {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_MEMORY_FILE: memoryFile,
      },
      ""
    );

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.changeSetsRemoved, 1);
    assert.equal(payload.protectedChangeSets, 1);
    assert.deepEqual(payload.evidenceSummary, {
      validations: 0,
      changeSets: 1,
      protectedChangeSets: 1,
      rolledBackChangeSets: 0,
      retention: { maxValidations: 100, maxChangeSets: 100 },
      protectedChangeSetsReason: "applied change-set guards are retained for validation",
    });
    assert.equal(await readFile(workspace.target, "utf8"), "keep\n");
    const reopened = new FileMemory({ filePath: memoryFile });
    assert.deepEqual(
      (await reopened.changeSets()).map((record) => record.changeSetId),
      ["cleanup-active"]
    );
  } finally {
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

test("CLI exports a metadata-only audit snapshot without initializing a provider", async () => {
  const workspace = await createGitWorkspace();
  const memoryFile = join(workspace.dir, "audit-session.json");
  try {
    const memory = new FileMemory({ filePath: memoryFile });
    await memory.recordValidation({
      validationId: "validation:audit",
      changeSetId: "audit-change",
      status: "failed",
      checks: [
        {
          id: "workspace:check",
          label: "internal label",
          command: {
            executable: "secret-command",
            args: ["--token", "secret"],
            cwd: workspace.dir,
            timeoutMs: 1000,
          },
          status: "failed",
          durationMs: 8,
          exitCode: 1,
          output: "secret output",
          error: "secret error",
          reason: "secret reason",
        },
      ],
      durationMs: 8,
      summary: "internal validation summary",
      reason: "internal validation reason",
    });
    await memory.recordChangeSet({
      changeSetId: "audit-change",
      sessionId: "audit",
      workingDirectory: workspace.dir,
      files: [
        {
          path: "target.md",
          kind: "file",
          beforeHash: "b".repeat(64),
          afterHash: "a".repeat(64),
          additions: 1,
          deletions: 1,
          beforeExists: true,
          afterExists: true,
        },
      ],
      additions: 1,
      deletions: 1,
      createdAt: "2026-09-13T00:01:00.000Z",
      recordedAt: "2026-09-13T00:01:01.000Z",
      state: "applied",
    });
    const before = await readFile(memoryFile);

    const result = await runCli(
      ["--session", "audit", "--export-evidence", "--status", "failed", "--json"],
      {
        ...process.env,
        INIT_CWD: workspace.dir,
        DEV_AGENT_MODEL_PROVIDER: "provider-that-must-not-be-loaded",
        DEV_AGENT_MEMORY_FILE: memoryFile,
      },
      ""
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.sessionId, "audit");
    assert.equal(payload.validations.length, 1);
    assert.equal(payload.validations[0].validationId, "validation:audit");
    assert.equal(payload.changeSets.length, 1);
    assert.equal(payload.changeSets[0].changeSetId, "audit-change");
    assert.deepEqual(payload.validations[0].checks, [
      { id: "workspace:check", status: "failed", durationMs: 8, exitCode: 1 },
    ]);
    assert.equal(Object.hasOwn(payload.validations[0], "summary"), false);
    assert.equal(Object.hasOwn(payload.validations[0], "reason"), false);
    assert.equal(Object.hasOwn(payload.validations[0].checks[0], "command"), false);
    assert.equal(Object.hasOwn(payload.changeSets[0], "workingDirectory"), false);
    assert.equal(result.stdout.includes("secret-command"), false);
    assert.equal(result.stdout.includes("secret output"), false);
    assert.equal(result.stdout.includes(workspace.dir), false);
    assert.deepEqual(await readFile(memoryFile), before);
  } finally {
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

test("CLI rejects an invalid audit status before loading the provider", async () => {
  const result = await runCli(
    ["--export-evidence", "--status", "not-a-status"],
    { ...process.env, DEV_AGENT_MODEL_PROVIDER: "provider-that-must-not-be-loaded" },
    ""
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /status must be one of/);
  assert.equal(result.stdout, "");
});


test("CLI validates audit limits and returns a metadata-only over-limit error", async () => {
  const workspace = await createGitWorkspace();
  const memoryFile = join(workspace.dir, "audit-limits.json");
  try {
    const memory = new FileMemory({ filePath: memoryFile });
    await memory.recordValidation({
      validationId: "validation:one",
      changeSetId: "change-one",
      status: "passed",
      checks: [],
      durationMs: 1,
      summary: "one",
    });
    await memory.recordValidation({
      validationId: "validation:two",
      changeSetId: "change-two",
      status: "passed",
      checks: [],
      durationMs: 1,
      summary: "two",
    });
    const before = await readFile(memoryFile);
    const env = {
      ...process.env,
      INIT_CWD: workspace.dir,
      DEV_AGENT_MODEL_PROVIDER: "provider-that-must-not-be-loaded",
      DEV_AGENT_MEMORY_FILE: memoryFile,
    };

    for (const rawLimit of [
      "0",
      "-1",
      "not-a-number",
      String(EVIDENCE_AUDIT_LIMIT_CAPS.maxBytes + 1),
    ]) {
      const invalid = await runCli(
        ["--session", "audit-limits", "--export-evidence", "--audit-max-bytes", rawLimit],
        env,
        ""
      );
      assert.equal(invalid.code, 1, rawLimit);
      assert.equal(invalid.stdout, "", rawLimit);
      assert.match(invalid.stderr, /positive integer|maximum|requires a value/, rawLimit);
    }

    const limited = await runCli(
      [
        "--session",
        "audit-limits",
        "--export-evidence",
        "--audit-max-validations",
        "1",
      ],
      env,
      ""
    );
    assert.equal(limited.code, 1, limited.stderr);
    assert.equal(limited.stdout, "");
    const error = JSON.parse(limited.stderr);
    assert.deepEqual(error, {
      error: "evidence audit limit exceeded",
      code: "EVIDENCE_AUDIT_LIMIT_EXCEEDED",
      kind: "validations",
      limit: 1,
      actual: 2,
    });
    assert.equal(limited.stderr.includes("provider-that-must-not-be-loaded"), false);
    assert.deepEqual(await readFile(memoryFile), before);
  } finally {
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

test("interactive CLI exposes explicit evidence cleanup", async () => {
  const workspace = await createGitWorkspace();
  const memoryFile = join(workspace.dir, "session.json");
  try {
    await seedEvidenceMemory(memoryFile, workspace.dir);
    const result = await runCliInteractiveCleanup([], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_MEMORY_FILE: memoryFile,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Evidence cleanup/);
    assert.match(result.stdout, /Protected applied guards: 1/);
    assert.equal(await readFile(workspace.target, "utf8"), "keep\n");
  } finally {
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

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
    assert.equal(payload.evidenceSummary.validations, 1);
    assert.equal(payload.evidenceSummary.changeSets, 1);
    assert.equal(payload.evidenceSummary.protectedChangeSets, 1);
    assert.match(result.stdout.trim(), /^\{.*\}$/s);
  } finally {
    await provider.close();
    await rm(workspace.dir, { recursive: true, force: true });
  }
});

test("CLI reruns persisted change-set validation after a new process", async () => {
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
    const changeSetId = firstPayload.reviews[0].changeSetId;

    const second = await runCliInteractiveValidation(
      ["--no-stream", "--json"],
      env,
      changeSetId
    );
    assert.equal(second.code, 0, second.stderr);
    const validationPayload = parseFirstJsonObject(second.stdout);
    assert.equal(validationPayload.validation.changeSetId, changeSetId);
    assert.match(validationPayload.validation.validationId, new RegExp(`^validation:${changeSetId}:`));
    assert.equal(validationPayload.validation.status, "passed");
    assert.equal(validationPayload.changeSets.length, 1);
    assert.equal(validationPayload.changeSets[0].changeSetId, changeSetId);
    assert.equal(await readFile(workspace.target, "utf8"), "changed\n");
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
    assert.equal(payload.changeSets.length, 1);
    assert.equal(payload.changeSets[0].changeSetId, expectedChangeSetId);
    assert.equal(payload.changeSets[0].files[0].path, "target.md");
    assert.equal(Object.hasOwn(payload.changeSets[0].files[0], "diff"), false);
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


test("CLI explicit validation rerun uses a fresh attempt id and persists the result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-validation-rerun-"));
  const target = join(dir, "target.txt");
  await writeFile(target, "before\n", "utf8");
  const filesystem = new FilesystemTool();
  const prepared = await filesystem.prepareChangeSet(
    { action: "write", path: "target.txt", content: "after\n" },
    { sessionId: "cli-rerun", workingDirectory: dir }
  );
  await filesystem.execute(prepared.executeInput, { sessionId: "cli-rerun", workingDirectory: dir });
  const memory = new InMemoryMemory();
  const context = createAgentContext("cli-rerun", memory, {
    sessionId: "cli-rerun",
    workingDirectory: dir,
  });
  const validation: ValidationAdapter = {
    prepare(review, _context, options): ValidationPlan {
      return {
        validationId: options?.validationId ?? createValidationId(review.changeSetId),
        changeSetId: review.changeSetId,
        status: "skipped",
        checks: [],
        summary: "no checks",
      };
    },
    async run(plan) {
      return {
        validationId: plan.validationId,
        changeSetId: plan.changeSetId,
        status: "skipped",
        checks: [],
        durationMs: 1,
        summary: "validation skipped",
      };
    },
  };
  try {
    const result = await runExplicitValidation(
      filesystem,
      validation,
      context,
      prepared.review.changeSetId
    );
    assert.equal(result.status, "skipped");
    assert.match(result.validationId, new RegExp(`^validation:${prepared.review.changeSetId}:`));
    assert.equal(result.changeSetId, prepared.review.changeSetId);
    assert.equal((await memory.validations()).length, 1);
    assert.equal(await readFile(target, "utf8"), "after\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI explicit validation rerun returns blocked on a postimage conflict and keeps user bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-validation-rerun-conflict-"));
  const target = join(dir, "target.txt");
  await writeFile(target, "before\n", "utf8");
  const filesystem = new FilesystemTool();
  const prepared = await filesystem.prepareChangeSet(
    { action: "write", path: "target.txt", content: "after\n" },
    { sessionId: "cli-rerun", workingDirectory: dir }
  );
  await filesystem.execute(prepared.executeInput, { sessionId: "cli-rerun", workingDirectory: dir });
  await writeFile(target, "user-edit\n", "utf8");
  const context = createAgentContext("cli-rerun-conflict", new InMemoryMemory(), {
    sessionId: "cli-rerun-conflict",
    workingDirectory: dir,
  });
  const validation: ValidationAdapter = {
    prepare: () => {
      throw new Error("must not run after a postimage conflict");
    },
    run: async () => {
      throw new Error("must not run");
    },
  };
  try {
    const result = await runExplicitValidation(
      filesystem,
      validation,
      context,
      prepared.review.changeSetId
    );
    assert.equal(result.status, "blocked");
    assert.match(result.reason ?? "", /postimage|hash conflict/i);
    assert.equal(await readFile(target, "utf8"), "user-edit\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
