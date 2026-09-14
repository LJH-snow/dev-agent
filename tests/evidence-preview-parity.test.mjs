import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FileMemory,
} from "../packages/agent-core/dist/index.js";
import { createDesktopServer } from "../apps/desktop/dist/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "apps", "cli", "dist", "index.js");
const sessionId = "preview-parity";
const previewKeys = [
  "schemaVersion",
  "sessionId",
  "generatedAt",
  "validationCount",
  "changeSetCount",
  "fileCount",
  "serializedBytes",
];

function start(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
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
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function comparablePreview(payload) {
  return Object.fromEntries(
    previewKeys
      .filter((key) => key !== "generatedAt")
      .map((key) => [key, payload[key]])
  );
}

function assertPreviewShape(payload) {
  assert.deepEqual(Object.keys(payload), previewKeys);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.sessionId, sessionId);
  assert.match(payload.generatedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  for (const key of [
    "validationCount",
    "changeSetCount",
    "fileCount",
    "serializedBytes",
  ]) {
    assert.equal(Number.isSafeInteger(payload[key]), true, key);
    assert.ok(payload[key] >= 0, key);
  }
}

async function writeFixture(memoryFile, workspaceDir) {
  const memory = new FileMemory({ filePath: memoryFile });
  await memory.recordValidation({
    validationId: "验证:失败:🚀",
    changeSetId: "变更集:alpha",
    status: "failed",
    checks: [
      {
        id: "check:secret",
        label: "internal label",
        command: {
          executable: "secret-command",
          args: ["--token", "secret"],
          cwd: workspaceDir,
          timeoutMs: 1_000,
        },
        status: "failed",
        durationMs: 9,
        exitCode: 1,
        output: "secret-output",
        error: "secret-error",
        reason: "secret-reason",
      },
    ],
    durationMs: 9,
    summary: "secret-summary",
    reason: "secret-validation-reason",
  });
  await memory.recordValidation({
    validationId: "validation:passed",
    changeSetId: "change-set:beta",
    status: "passed",
    checks: [],
    durationMs: 3,
    summary: "another internal summary",
  });
  await memory.recordChangeSet({
    changeSetId: "变更集:alpha",
    sessionId,
    workingDirectory: workspaceDir,
    files: [
      {
        path: "src/秘密🚀.ts",
        kind: "file",
        beforeHash: "b".repeat(64),
        afterHash: "a".repeat(64),
        additions: 2,
        deletions: 1,
        beforeExists: true,
        afterExists: true,
      },
    ],
    additions: 2,
    deletions: 1,
    createdAt: "2026-09-14T00:10:00.000Z",
    recordedAt: "2026-09-14T00:10:01.000Z",
    state: "applied",
  });
  await memory.recordChangeSet({
    changeSetId: "change-set:beta",
    sessionId,
    workingDirectory: workspaceDir,
    files: [
      {
        path: "README.md",
        kind: "file",
        beforeHash: "c".repeat(64),
        afterHash: "d".repeat(64),
        additions: 1,
        deletions: 0,
        beforeExists: true,
        afterExists: true,
      },
    ],
    additions: 1,
    deletions: 0,
    createdAt: "2026-09-14T00:11:00.000Z",
    recordedAt: "2026-09-14T00:11:01.000Z",
    state: "applied",
  });
}

async function fetchDesktopPreview(base, query = "") {
  const response = await fetch(
    `${base}/api/sessions/${encodeURIComponent(sessionId)}/evidence/preview${query}`
  );
  return { status: response.status, payload: await response.json() };
}

test("core, CLI, and Desktop previews keep the same counts and canonical byte semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-preview-parity-"));
  const workspaceDir = join(root, "workspace");
  const memoryFile = join(root, `${sessionId}.json`);
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(join(workspaceDir, "sentinel.txt"), "sentinel", "utf8");
  await writeFixture(memoryFile, workspaceDir);
  const before = await readFile(memoryFile);
  const previousSessionDir = process.env.DEV_AGENT_SESSION_DIR;
  const previousMemoryFile = process.env.DEV_AGENT_MEMORY_FILE;
  process.env.DEV_AGENT_SESSION_DIR = root;
  delete process.env.DEV_AGENT_MEMORY_FILE;

  let runCalls = 0;
  const server = createDesktopServer({
    session: {
      id: "default",
      async run() {
        runCalls += 1;
      },
    },
  });
  const base = await start(server);
  try {
    const parityCases = [
      {
        cliArgs: [],
        query: "",
        counts: { validationCount: 2, changeSetCount: 2, fileCount: 2 },
      },
      {
        cliArgs: ["--status", "failed"],
        query: "?status=failed",
        counts: { validationCount: 1, changeSetCount: 1, fileCount: 1 },
      },
      {
        cliArgs: ["--change-set-id", "变更集:alpha"],
        query: `?changeSetId=${encodeURIComponent("变更集:alpha")}`,
        counts: { validationCount: 1, changeSetCount: 1, fileCount: 1 },
      },
      {
        cliArgs: ["--validation-id", "验证:失败:🚀"],
        query: `?validationId=${encodeURIComponent("验证:失败:🚀")}`,
        counts: { validationCount: 1, changeSetCount: 1, fileCount: 1 },
      },
    ];

    for (const parityCase of parityCases) {
      const cliResult = await runCli(
        ["--session", sessionId, "--preview-evidence", ...parityCase.cliArgs],
        {
          ...process.env,
          INIT_CWD: root,
          DEV_AGENT_MEMORY_FILE: memoryFile,
          DEV_AGENT_MODEL_PROVIDER: "provider-that-must-not-be-loaded",
        }
      );
      assert.equal(cliResult.code, 0, cliResult.stderr);
      assert.equal(cliResult.stderr, "");
      const cliPayload = JSON.parse(cliResult.stdout);
      const desktopResult = await fetchDesktopPreview(base, parityCase.query);

      assert.equal(desktopResult.status, 200);
      assertPreviewShape(cliPayload);
      assertPreviewShape(desktopResult.payload);
      assert.deepEqual(
        comparablePreview(cliPayload),
        comparablePreview(desktopResult.payload),
        parityCase.query || "unfiltered"
      );
      for (const [key, value] of Object.entries(parityCase.counts)) {
        assert.equal(cliPayload[key], value, `${parityCase.query || "unfiltered"}.${key}`);
      }

      const serialized = `${cliResult.stdout}${JSON.stringify(desktopResult.payload)}`;
      assert.doesNotMatch(
        serialized,
        /secret-command|secret-output|secret-error|workingDirectory|cwd/
      );
    }

    assert.equal(runCalls, 0);
    assert.deepEqual(await readFile(memoryFile), before);
  } finally {
    await close(server);
    if (previousSessionDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousSessionDir;
    }
    if (previousMemoryFile === undefined) {
      delete process.env.DEV_AGENT_MEMORY_FILE;
    } else {
      process.env.DEV_AGENT_MEMORY_FILE = previousMemoryFile;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("Desktop preview preserves documented empty, duplicate, unknown, and encoded query semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-preview-query-"));
  const memoryFile = join(root, `${sessionId}.json`);
  await writeFixture(memoryFile, root);
  const previousSessionDir = process.env.DEV_AGENT_SESSION_DIR;
  const previousMemoryFile = process.env.DEV_AGENT_MEMORY_FILE;
  process.env.DEV_AGENT_SESSION_DIR = root;
  delete process.env.DEV_AGENT_MEMORY_FILE;
  const server = createDesktopServer({ session: { id: "default", async run() {} } });
  const base = await start(server);
  try {
    const all = await fetchDesktopPreview(base);
    const empty = await fetchDesktopPreview(base, "?status=");
    const unknown = await fetchDesktopPreview(base, "?unrelated=ignored");
    const duplicate = await fetchDesktopPreview(base, "?status=failed&status=passed");
    const encoded = await fetchDesktopPreview(
      base,
      `?changeSetId=${encodeURIComponent("变更集:alpha")}`
    );

    assert.equal(all.status, 200);
    assert.equal(empty.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(duplicate.status, 200);
    assert.equal(encoded.status, 200);
    assert.deepEqual(comparablePreview(empty.payload), comparablePreview(all.payload));
    assert.deepEqual(comparablePreview(unknown.payload), comparablePreview(all.payload));
    assert.equal(duplicate.payload.validationCount, 1);
    assert.equal(duplicate.payload.changeSetCount, 1);
    assert.equal(duplicate.payload.fileCount, 1);
    assert.equal(encoded.payload.validationCount, 1);
    assert.equal(encoded.payload.changeSetCount, 1);
    assert.equal(encoded.payload.fileCount, 1);
    assertPreviewShape(all.payload);
    assertPreviewShape(empty.payload);
    assertPreviewShape(unknown.payload);
    assertPreviewShape(duplicate.payload);
    assertPreviewShape(encoded.payload);

    const historyQueries = [
      "?status=",
      "?unrelated=ignored",
      "?status=failed&status=passed",
      `?changeSetId=${encodeURIComponent("变更集:alpha")}`,
    ];
    for (const query of historyQueries) {
      const historyResponse = await fetch(
        `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages${query}`
      );
      assert.equal(historyResponse.status, 200, query);
      const history = await historyResponse.json();
      assert.equal(history.sessionId, sessionId, query);
      if (query === "?status=failed&status=passed" || query.includes("changeSetId=")) {
        assert.equal(history.validations.length, 1, query);
        assert.equal(history.changeSets.length, 1, query);
      } else {
        assert.equal(history.validations.length, 2, query);
        assert.equal(history.changeSets.length, 2, query);
      }
    }
  } finally {
    await close(server);
    if (previousSessionDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousSessionDir;
    }
    if (previousMemoryFile === undefined) {
      delete process.env.DEV_AGENT_MEMORY_FILE;
    } else {
      process.env.DEV_AGENT_MEMORY_FILE = previousMemoryFile;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("Desktop preview keeps unknown-session and audit-limit errors metadata-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-preview-errors-"));
  const memoryFile = join(root, `${sessionId}.json`);
  await writeFixture(memoryFile, root);
  const previousSessionDir = process.env.DEV_AGENT_SESSION_DIR;
  const previousMemoryFile = process.env.DEV_AGENT_MEMORY_FILE;
  process.env.DEV_AGENT_SESSION_DIR = root;
  delete process.env.DEV_AGENT_MEMORY_FILE;
  const server = createDesktopServer({ session: { id: "default", async run() {} } });
  const base = await start(server);
  try {
    const unknown = await fetch(base + "/api/sessions/missing/evidence/preview");
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: "unknown session" });

    const limited = await fetch(
      base + "/api/sessions/missing/evidence/preview?maxBytes=1"
    );
    assert.equal(limited.status, 404, "unknown session is resolved before query validation");
    assert.deepEqual(await limited.json(), { error: "unknown session" });

    const existingLimited = await fetch(
      base + `/api/sessions/${encodeURIComponent(sessionId)}/evidence/preview?maxBytes=1`
    );
    assert.equal(existingLimited.status, 400);
    assert.deepEqual(await existingLimited.json(), {
      error: "audit limit options require /evidence",
    });
  } finally {
    await close(server);
    if (previousSessionDir === undefined) {
      delete process.env.DEV_AGENT_SESSION_DIR;
    } else {
      process.env.DEV_AGENT_SESSION_DIR = previousSessionDir;
    }
    if (previousMemoryFile === undefined) {
      delete process.env.DEV_AGENT_MEMORY_FILE;
    } else {
      process.env.DEV_AGENT_MEMORY_FILE = previousMemoryFile;
    }
    await rm(root, { recursive: true, force: true });
  }
});
