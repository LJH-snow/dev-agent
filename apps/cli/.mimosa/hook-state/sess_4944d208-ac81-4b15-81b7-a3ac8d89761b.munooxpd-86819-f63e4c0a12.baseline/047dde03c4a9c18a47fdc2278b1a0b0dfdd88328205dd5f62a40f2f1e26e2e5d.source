import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = join(cliRoot, "dist", "index.js");

function runCli(args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_SESSION_DIR: join(options.cwd, ".sessions"),
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("--cwd makes a relative index path resolve inside an external project", async () => {
  const project = await mkdtemp(join(tmpdir(), "dev-agent-external-project-"));
  const launcher = await mkdtemp(join(tmpdir(), "dev-agent-external-launcher-"));
  try {
    await writeFile(join(project, "entry.ts"), "export const externalValue = 42;\n", "utf8");

    const result = await runCli(["--cwd", project, "--index", ".", "--json"], {
      cwd: launcher,
      env: { INIT_CWD: launcher },
    });

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.path, project);
    assert.equal(report.files, 1);
    assert.equal(report.symbols, 1);
    assert.equal(await readFile(join(project, ".dev-agent", "index.json"), "utf8").then(Boolean), true);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(launcher, { recursive: true, force: true });
  }
});

test("DEV_AGENT_WORKING_DIRECTORY wins over INIT_CWD when no flag is supplied", async () => {
  const project = await mkdtemp(join(tmpdir(), "dev-agent-env-project-"));
  const launcher = await mkdtemp(join(tmpdir(), "dev-agent-env-launcher-"));
  try {
    await writeFile(join(project, "entry.py"), "answer = 42\n", "utf8");

    const result = await runCli(["--index", ".", "--json"], {
      cwd: launcher,
      env: {
        INIT_CWD: launcher,
        DEV_AGENT_WORKING_DIRECTORY: project,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.path, project);
    assert.equal(report.files, 1);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(launcher, { recursive: true, force: true });
  }
});

test("invalid --cwd is rejected before an operation starts", async () => {
  const launcher = await mkdtemp(join(tmpdir(), "dev-agent-invalid-cwd-"));
  const missing = join(launcher, "missing");
  try {
    const result = await runCli(["--cwd", missing, "--tools", "--json"], { cwd: launcher });

    assert.equal(result.code, 1);
    const error = JSON.parse(result.stdout);
    assert.match(error.error, /working directory does not exist/);
  } finally {
    await rm(launcher, { recursive: true, force: true });
  }
});

test("--project-state reads config from the final external project directory", async () => {
  const project = await mkdtemp(join(tmpdir(), "dev-agent-project-state-config-"));
  const launcher = await mkdtemp(join(tmpdir(), "dev-agent-project-state-launcher-"));
  try {
    await mkdir(join(project, ".dev-agent"), { recursive: true });
    await writeFile(
      join(project, ".dev-agent", "config.json"),
      JSON.stringify({ defaultProvider: "gemini" }),
      "utf8"
    );

    const result = await runCli(["--cwd", project, "--project-state", "--once", "hi"], {
      cwd: launcher,
      env: {
        INIT_CWD: launcher,
        DEV_AGENT_MODEL_PROVIDER: "",
        DEV_AGENT_CONFIG_FILE: "",
        GEMINI_API_KEY: "",
        DEV_AGENT_GEMINI_API_KEY: "",
      },
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /GEMINI_API_KEY is required/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(launcher, { recursive: true, force: true });
  }
});

test("relative session and memory paths resolve from the final --cwd", async () => {
  const project = await mkdtemp(join(tmpdir(), "dev-agent-relative-project-"));
  const launcher = await mkdtemp(join(tmpdir(), "dev-agent-relative-launcher-"));
  try {
    const sessionDir = join(project, "project-sessions");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "relative-session.json"),
      JSON.stringify({
        version: 1,
        metadata: {
          sessionId: "relative-session",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-01T00:00:00.000Z",
          entryCount: 3,
        },
        entries: [],
      }),
      "utf8"
    );

    const sessionResult = await runCli(
      ["--cwd", project, "--session", "relative-session", "--metadata"],
      {
        cwd: launcher,
        env: {
          INIT_CWD: launcher,
          DEV_AGENT_SESSION_DIR: "project-sessions",
          DEV_AGENT_MEMORY_FILE: "",
        },
      }
    );

    assert.equal(sessionResult.code, 0, sessionResult.stderr);
    assert.match(sessionResult.stdout, /Entries: 3/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(launcher, { recursive: true, force: true });
  }
});

test("a blank memory path falls back to the project session directory", async () => {
  const project = await mkdtemp(join(tmpdir(), "dev-agent-blank-memory-project-"));
  const launcher = await mkdtemp(join(tmpdir(), "dev-agent-blank-memory-launcher-"));
  try {
    const sessionDir = join(project, "sessions");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "blank-memory.json"),
      JSON.stringify({
        version: 1,
        metadata: {
          sessionId: "blank-memory",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-01T00:00:00.000Z",
          entryCount: 4,
        },
        entries: [],
      }),
      "utf8"
    );

    const result = await runCli(
      ["--cwd", project, "--session", "blank-memory", "--metadata"],
      {
        cwd: launcher,
        env: {
          INIT_CWD: launcher,
          DEV_AGENT_SESSION_DIR: "sessions",
          DEV_AGENT_MEMORY_FILE: "   ",
        },
      }
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Entries: 4/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(launcher, { recursive: true, force: true });
  }
});

test("relative DEV_AGENT_MEMORY_FILE resolves from the final --cwd", async () => {
  const project = await mkdtemp(join(tmpdir(), "dev-agent-relative-memory-project-"));
  const launcher = await mkdtemp(join(tmpdir(), "dev-agent-relative-memory-launcher-"));
  try {
    await writeFile(
      join(project, "project-memory.json"),
      JSON.stringify({
        version: 1,
        metadata: {
          sessionId: "project-memory",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastActiveAt: "2026-01-01T00:00:00.000Z",
          entryCount: 5,
        },
        entries: [],
      }),
      "utf8"
    );

    const result = await runCli(["--cwd", project, "--metadata"], {
      cwd: launcher,
      env: {
        INIT_CWD: launcher,
        DEV_AGENT_MEMORY_FILE: "project-memory.json",
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Entries: 5/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(launcher, { recursive: true, force: true });
  }
});
