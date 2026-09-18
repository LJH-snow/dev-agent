import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { FileMemory } from "@dev-agent/agent-core";
import { ChatSession } from "../dist/chat-session.js";
import { createDesktopServer } from "../dist/server.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const ENV_KEYS = [
  "DEV_AGENT_MODEL_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEV_AGENT_MEMORY_FILE",
  "DEV_AGENT_APPROVAL",
  "DEV_AGENT_RUST_BINARY",
];

function applyEnv(values: Record<string, string>): () => void {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return () => {
    for (const key of ENV_KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  };
}

async function startStubProvider(content: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  let requests = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests += 1;
      const chunks = requests === 1
        ? [{
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call-desktop-validation-1",
                  type: "function",
                  function: {
                    name: "filesystem",
                    arguments: JSON.stringify({
                      action: "write",
                      path: "target.txt",
                      content,
                    }),
                  },
                }],
              },
            }],
          }]
        : [{ choices: [{ delta: { content: "done" } }] }];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
          "data: [DONE]\n\n"
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function createGitWorkspace(): Promise<{ directory: string; target: string }> {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-desktop-validation-"));
  const target = join(directory, "target.txt");
  await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
  await writeFile(target, "keep\n", "utf8");
  await execFileAsync("git", ["add", "target.txt"], { cwd: directory });
  return { directory, target };
}

function start(server: any): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(`http://127.0.0.1:${(server.address() as any).port}`);
    });
  });
}

function close(server: any): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function parseSse(text: string): Array<{ type: string; data: any }> {
  return text
    .split("\n\n")
    .map((block) => {
      let type = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) type = line.slice(7).trim();
        if (line.startsWith("data: ")) data += line.slice(6);
      }
      return data ? { type, data: JSON.parse(data) } : undefined;
    })
    .filter((event): event is { type: string; data: any } => event !== undefined);
}

test("ChatSession emits validation after apply and keeps Undo available", async () => {
  const workspace = await createGitWorkspace();
  const provider = await startStubProvider("changed\n");
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(workspace.directory, "session.json"),
  });
  const session = new ChatSession({
    sessionId: "default",
    workingDirectory: workspace.directory,
    approvalMode: "review-writes",
  });
  const events: any[] = [];
  let changeSetId = "";
  try {
    await session.run("change and verify", (event) => {
      events.push(event);
      const data = event.data as any;
      if (event.type === "approval" && data.review?.changeSetId) {
        changeSetId = data.review.changeSetId;
      }
    }, {
      requestApproval: async () => "allow",
    });

    const toolResultIndex = events.findIndex((event) => event.type === "tool-result");
    const validationIndex = events.findIndex((event) => event.type === "validation");
    const doneIndex = events.findIndex((event) => event.type === "done");
    assert.ok(toolResultIndex >= 0);
    assert.ok(validationIndex > toolResultIndex, "validation must follow the apply result");
    assert.ok(doneIndex > validationIndex, "done must follow validation");
    const validation = events[validationIndex];
    assert.equal(validation.data.sessionId, "default");
    assert.equal(validation.data.changeSetId, changeSetId);
    assert.equal(validation.data.status, "passed");
    assert.equal(validation.data.checks[0].id, "workspace:diff-check");
    assert.equal(await readFile(workspace.target, "utf8"), "changed\n");

    const rollback = await session.rollbackChangeSet(changeSetId) as any;
    assert.equal(rollback.ok, true);
    assert.equal(await readFile(workspace.target, "utf8"), "keep\n");

    const persisted = new FileMemory({
      filePath: join(workspace.directory, "session.json"),
    });
    assert.equal(
      (await persisted.changeSets()).find((record) => record.changeSetId === changeSetId)?.state,
      "rolled-back"
    );
  } finally {
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(workspace.directory, { recursive: true, force: true });
  }
});

test("Desktop SSE forwards validation results for isolated sessions", async () => {
  const makeSession = (id: string) => ({
    id,
    async run(_message: string, emit: (event: any) => void) {
      emit({ type: "tool-result", data: { name: "filesystem", output: "applied" } });
      emit({
        type: "validation",
        data: {
          sessionId: id,
          validationId: `validation:${id}`,
          changeSetId: `change-set-${id}`,
          status: "failed",
          checks: [],
          durationMs: 3,
          summary: `validation failed for ${id}`,
          reason: "diff check failed",
        },
      });
      emit({ type: "done", data: { status: "done", turns: 1 } });
    },
  });
  const server = createDesktopServer({
    session: makeSession("default"),
    createSession: (id) => makeSession(id),
  });
  const base = await start(server);
  try {
    const eventsBySession = new Map<string, any>();
    for (const sessionId of ["alpha", "beta"]) {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "verify", sessionId }),
      });
      assert.equal(response.status, 200);
      const events = parseSse(await response.text());
      const validation = events.find((event) => event.type === "validation");
      assert.ok(validation);
      eventsBySession.set(sessionId, validation.data);
      assert.deepEqual(
        events.map((event) => event.type),
        ["tool-result", "validation", "done"]
      );
    }
    assert.equal(eventsBySession.get("alpha").sessionId, "alpha");
    assert.equal(eventsBySession.get("beta").sessionId, "beta");
    assert.notEqual(
      eventsBySession.get("alpha").changeSetId,
      eventsBySession.get("beta").changeSetId
    );
  } finally {
    await close(server);
  }
});

test("Desktop cancel keeps a blocked validation event before the aborted done event", async () => {
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const session = {
    id: "default",
    async run(_message: string, emit: (event: any) => void, options: { signal?: AbortSignal } = {}) {
      markStarted?.();
      await new Promise<void>((resolve) =>
        options.signal?.addEventListener("abort", () => resolve(), { once: true })
      );
      emit({
        type: "validation",
        data: {
          sessionId: "default",
          validationId: "validation:cancelled",
          changeSetId: "change-set-cancelled",
          status: "blocked",
          checks: [],
          durationMs: 1,
          summary: "validation is blocked",
          reason: "validation aborted while the checks were running",
        },
      });
      emit({ type: "done", data: { status: "aborted", turns: 1 } });
    },
  };
  const server = createDesktopServer({ session });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "stop validation" }),
    });
    const textPromise = response.text();
    await started;
    const cancelled = await fetch(`${base}/api/chat/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "default" }),
    });
    assert.equal(cancelled.status, 200);
    const events = parseSse(await textPromise);
    assert.deepEqual(events.map((event) => event.type), ["validation", "done"]);
    assert.equal(events[0]?.data.status, "blocked");
    assert.equal(events[1]?.data.status, "aborted");
  } finally {
    await close(server);
  }
});

test("Desktop UI includes a validation card without removing the Undo action", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /className = "msg validation"/);
    assert.match(html, /appendValidation/);
    assert.match(html, /data\.validations/);
    assert.match(html, /case "validation":/);
    assert.match(html, /data-undo/);
    assert.match(html, /data-rerun/);
    assert.match(html, /\/api\/changesets\/validate/);
    assert.match(html, /Rerun blocked — the file or session is busy/);
    assert.match(html, /Change set is no longer available/);
    assert.match(html, /Rerun is unavailable for this session/);
    assert.match(html, /Rerun failed/);
    assert.match(html, /Undo/);
  } finally {
    await close(server);
  }
});

test("GET / guards desktop validation rerun responses against stale sessions", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /let desktopValidationRerunRequestId = 0/);
    assert.match(html, /let desktopValidationRerunController = null/);
    assert.match(html, /const requestId = \+\+desktopValidationRerunRequestId/);
    assert.match(html, /desktopValidationRerunController\?\.abort\(\)/);
    assert.match(html, /desktopValidationRerunController = controller/);
    assert.match(html, /signal: controller\.signal/);
    assert.match(html, /requestId !== desktopValidationRerunRequestId \|\| sessionId !== currentSessionId/);
  } finally {
    await close(server);
  }
});

test("ChatSession reruns trusted validation with a fresh attempt id and preserves evidence", async () => {
  const workspace = await createGitWorkspace();
  const provider = await startStubProvider("changed\n");
  const memoryFile = join(workspace.directory, "session.json");
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: memoryFile,
  });
  const session = new ChatSession({
    sessionId: "default",
    workingDirectory: workspace.directory,
    approvalMode: "review-writes",
  });
  let changeSetId = "";
  try {
    await session.run("change and verify", (event) => {
      const data = event.data as any;
      if (event.type === "approval" && data.review?.changeSetId) {
        changeSetId = data.review.changeSetId;
      }
    }, { requestApproval: async () => "allow" });

    const savedBefore = JSON.parse(await readFile(memoryFile, "utf8"));
    assert.equal(savedBefore.validations.length, 1);
    const firstId = savedBefore.validations[0].validationId;

    const rerun = await session.rerunValidation(changeSetId);

    assert.equal(rerun.status, "passed");
    assert.match(rerun.validationId, new RegExp(`^validation:${changeSetId}:`));
    assert.notEqual(rerun.validationId, firstId);
    assert.equal(rerun.changeSetId, changeSetId);
    assert.equal(await readFile(workspace.target, "utf8"), "changed\n");
    const savedAfter = JSON.parse(await readFile(memoryFile, "utf8"));
    assert.equal(savedAfter.validations.length, 2);
    assert.equal(savedAfter.validations[1].validationId, rerun.validationId);
  } finally {
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(workspace.directory, { recursive: true, force: true });
  }
});

test("a new Desktop session reruns evidence persisted by an earlier session", async () => {
  const workspace = await createGitWorkspace();
  const provider = await startStubProvider("changed\n");
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(workspace.directory, "session.json"),
  });
  let firstSession: ChatSession | undefined;
  let secondSession: ChatSession | undefined;
  let changeSetId = "";
  try {
    firstSession = new ChatSession({
      sessionId: "restart",
      workingDirectory: workspace.directory,
      approvalMode: "review-writes",
    });
    await firstSession.run("change and verify", (event) => {
      const data = event.data as any;
      if (event.type === "approval" && data.review?.changeSetId) {
        changeSetId = data.review.changeSetId;
      }
    }, { requestApproval: async () => "allow" });
    await firstSession.close();
    firstSession = undefined;

    secondSession = new ChatSession({
      sessionId: "restart",
      workingDirectory: workspace.directory,
      approvalMode: "review-writes",
    });
    const rerun = await secondSession.rerunValidation(changeSetId);

    assert.equal(rerun.changeSetId, changeSetId);
    assert.match(rerun.validationId, new RegExp(`^validation:${changeSetId}:`));
    assert.equal(rerun.status, "passed");
    assert.equal(await readFile(workspace.target, "utf8"), "changed\n");
  } finally {
    await firstSession?.close();
    await secondSession?.close();
    await provider.close();
    restoreEnv();
    await rm(workspace.directory, { recursive: true, force: true });
  }
});

test("restored evidence cannot cross session or working-directory boundaries", async () => {
  const workspace = await createGitWorkspace();
  const otherWorkspace = await createGitWorkspace();
  const provider = await startStubProvider("changed\n");
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(workspace.directory, "session.json"),
  });
  let firstSession: ChatSession | undefined;
  let wrongSession: ChatSession | undefined;
  let wrongWorkspaceSession: ChatSession | undefined;
  let changeSetId = "";
  try {
    firstSession = new ChatSession({
      sessionId: "restart",
      workingDirectory: workspace.directory,
      approvalMode: "review-writes",
    });
    await firstSession.run("change and verify", (event) => {
      const data = event.data as any;
      if (event.type === "approval" && data.review?.changeSetId) {
        changeSetId = data.review.changeSetId;
      }
    }, { requestApproval: async () => "allow" });
    await firstSession.close();
    firstSession = undefined;

    wrongSession = new ChatSession({
      sessionId: "other-session",
      workingDirectory: workspace.directory,
      approvalMode: "review-writes",
    });
    const sessionMismatch = await wrongSession.rerunValidation(changeSetId);
    assert.equal(sessionMismatch.status, "blocked");
    assert.match(sessionMismatch.reason ?? "", /session/);
    await wrongSession.close();
    wrongSession = undefined;

    wrongWorkspaceSession = new ChatSession({
      sessionId: "restart",
      workingDirectory: otherWorkspace.directory,
      approvalMode: "review-writes",
    });
    const workingDirectoryMismatch = await wrongWorkspaceSession.rerunValidation(changeSetId);
    assert.equal(workingDirectoryMismatch.status, "blocked");
    assert.match(workingDirectoryMismatch.reason ?? "", /working directory/);
    assert.equal(await readFile(workspace.target, "utf8"), "changed\n");
    assert.equal(await readFile(otherWorkspace.target, "utf8"), "keep\n");
  } finally {
    await firstSession?.close();
    await wrongSession?.close();
    await wrongWorkspaceSession?.close();
    await provider.close();
    restoreEnv();
    await rm(workspace.directory, { recursive: true, force: true });
    await rm(otherWorkspace.directory, { recursive: true, force: true });
  }
});

test("ChatSession turns a rerun postimage conflict into blocked evidence without undoing user bytes", async () => {
  const workspace = await createGitWorkspace();
  const provider = await startStubProvider("changed\n");
  const restoreEnv = applyEnv({
    DEV_AGENT_MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_BASE_URL: provider.baseUrl,
    DEV_AGENT_MEMORY_FILE: join(workspace.directory, "session.json"),
  });
  const session = new ChatSession({
    sessionId: "default",
    workingDirectory: workspace.directory,
    approvalMode: "review-writes",
  });
  let changeSetId = "";
  try {
    await session.run("change and verify", (event) => {
      const data = event.data as any;
      if (event.type === "approval" && data.review?.changeSetId) {
        changeSetId = data.review.changeSetId;
      }
    }, { requestApproval: async () => "allow" });
    await writeFile(workspace.target, "user-edit\n", "utf8");

    const rerun = await session.rerunValidation(changeSetId);

    assert.equal(rerun.status, "blocked");
    assert.match(rerun.reason ?? "", /postimage|hash conflict/i);
    assert.equal(await readFile(workspace.target, "utf8"), "user-edit\n");
  } finally {
    await session.close();
    await provider.close();
    restoreEnv();
    await rm(workspace.directory, { recursive: true, force: true });
  }
});

test("Desktop validation endpoint returns isolated rerun results and rejects same-session overlap", async () => {
  let release: (() => void) | undefined;
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reruns = 0;
  const makeSession = (id: string) => ({
    id,
    async run() {},
    async rerunValidation(changeSetId: string, options: { signal?: AbortSignal } = {}) {
      reruns += 1;
      if (id === "alpha" && reruns === 1) {
        await releasePromise;
      }
      return {
        validationId: `validation:${changeSetId}:attempt-${id}`,
        changeSetId,
        status: options.signal?.aborted ? "blocked" as const : "passed" as const,
        checks: [],
        durationMs: 1,
        summary: `validation ${id}`,
      };
    },
  });
  const server = createDesktopServer({
    session: makeSession("default"),
    createSession: (id) => makeSession(id),
  });
  const base = await start(server);
  try {
    for (const sessionId of ["alpha", "beta"]) {
      const chat = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "open", sessionId }),
      });
      assert.equal(chat.status, 200);
      await chat.text();
    }

    const first = fetch(`${base}/api/changesets/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "alpha", changeSetId: "cs-alpha" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const overlap = await fetch(`${base}/api/changesets/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "alpha", changeSetId: "cs-alpha-2" }),
    });
    assert.equal(overlap.status, 409);
    release?.();
    const firstResponse = await first;
    assert.equal(firstResponse.status, 200);
    const firstBody = (await firstResponse.json()) as any;
    assert.equal(firstBody.sessionId, "alpha");
    assert.equal(firstBody.changeSetId, "cs-alpha");

    const second = await fetch(`${base}/api/changesets/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "beta", changeSetId: "cs-beta" }),
    });
    assert.equal(second.status, 200);
    const secondBody = (await second.json()) as any;
    assert.equal(secondBody.sessionId, "beta");
    assert.equal(secondBody.changeSetId, "cs-beta");
  } finally {
    release?.();
    await close(server);
  }
});
