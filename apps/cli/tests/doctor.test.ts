import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { printDoctorReport, runDoctor } from "../dist/doctor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

const CHECK_NAMES = [
  "node",
  "ripgrep",
  "protoc",
  "rust runtime",
  "provider",
  "config",
  "sessions",
];

function runCli(args, env = process.env): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end();
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function checkFor(report, name) {
  return report.checks.find((check) => check.name === name);
}

function expectedRuntimeExecutorMode() {
  return process.platform === "darwin"
    ? "sandboxed-macos"
    : process.platform === "linux"
      ? "sandboxed-linux"
      : "unsupported";
}

test("runDoctor reports a healthy environment as ok", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  try {
    const report = await runDoctor({
      providerId: "openai",
      sessionDir: dir,
      configPath: join(dir, "config.json"),
      nodeVersion: "v26.4.0",
      env: { OPENAI_API_KEY: "test-key" },
      commandVersion: async (command) => `${command} 1.0.0`,
      probeRust: async () => ({ runtimeVersion: "0.1.0", capabilities: ["run"] }),
    });

    assert.deepEqual(
      report.checks.map((check) => check.name),
      CHECK_NAMES
    );
    assert.equal(report.executorMode, "local");
    assert.equal(report.summary.fail, 0);
    assert.equal(report.summary.warn, 1, "the unconfigured rust runtime warns");
    assert.equal(report.summary.ok, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor fails when the provider key is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  try {
    const report = await runDoctor({
      providerId: "openai",
      sessionDir: dir,
      configPath: join(dir, "config.json"),
      nodeVersion: "v26.4.0",
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    const provider = checkFor(report, "provider");
    assert.equal(provider.status, "fail");
    assert.match(provider.detail, /OPENAI_API_KEY/);
    assert.equal(report.summary.fail, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor fails when the configured rust binary is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  try {
    const report = await runDoctor({
      providerId: "ollama",
      rustBinaryPath: join(dir, "nope", "dev-agent-executor"),
      sessionDir: dir,
      configPath: join(dir, "config.json"),
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    const rust = checkFor(report, "rust runtime");
    const expectedMode = expectedRuntimeExecutorMode();
    assert.equal(report.executorMode, expectedMode);
    assert.equal(rust.status, "fail");
    assert.equal(report.summary.fail, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor reports a missing config as using defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  try {
    const report = await runDoctor({
      providerId: "ollama",
      sessionDir: dir,
      configPath: join(dir, "config.json"),
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    const config = checkFor(report, "config");
    assert.equal(config.status, "ok");
    assert.match(config.detail, /defaults are used/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor lists the recognised sections of a valid config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  const configPath = join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      defaultProvider: "openai",
      pricing: { "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
      unknownThing: true,
    }),
    "utf8"
  );
  try {
    const report = await runDoctor({
      providerId: "ollama",
      sessionDir: dir,
      configPath,
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    const config = checkFor(report, "config");
    assert.equal(config.status, "ok");
    assert.match(config.detail, /2 recognised sections/);
    assert.match(config.detail, /defaultProvider/);
    assert.match(config.detail, /pricing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor warns and ignores a config file above the 1 MiB read limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  const configPath = join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({ defaultProvider: "ollama", padding: "x".repeat(1024 * 1024) }),
    "utf8"
  );
  try {
    const report = await runDoctor({
      providerId: "ollama",
      sessionDir: dir,
      configPath,
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    const config = checkFor(report, "config");
    assert.equal(config.status, "warn");
    assert.match(config.detail, /1 MiB read limit/);
    assert.match(config.detail, /ignored/);
    assert.doesNotMatch(config.detail, new RegExp(escapeRegExp(configPath)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor warns about a malformed config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  const configPath = join(dir, "config.json");
  await writeFile(configPath, "{ not json", "utf8");
  try {
    const report = await runDoctor({
      providerId: "ollama",
      sessionDir: dir,
      configPath,
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    const config = checkFor(report, "config");
    assert.equal(config.status, "warn");
    assert.match(config.detail, /not valid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--doctor human output labels the executor mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  try {
    const result = await runCli(["--doctor"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: dir,
      DEV_AGENT_RUST_BINARY: "",
    });

    assert.match(result.stdout, /executor mode:\s+local/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--doctor --json prints a parseable report and matches the exit code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  try {
    const result = await runCli(["--doctor", "--json"], {
      ...process.env,
      DEV_AGENT_MODEL_PROVIDER: "ollama",
      DEV_AGENT_SESSION_DIR: dir,
      DEV_AGENT_RUST_BINARY: "",
    });

    const report = JSON.parse(result.stdout);
    assert.deepEqual(
      report.checks.map((check) => check.name),
      CHECK_NAMES
    );
    assert.equal(result.code, report.summary.fail > 0 ? 1 : 0);
    assert.equal(checkFor(report, "node").status, "ok");
    assert.equal(checkFor(report, "ripgrep").status, "ok");
    assert.equal(checkFor(report, "sessions").status, "ok");
    assert.equal(report.executorMode, "local");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("doctor JSON and human output do not expose config or session absolute paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  const configPath = join(dir, "private", "config.json");
  const sessionDir = join(dir, "private", "sessions");
  try {
    const report = await runDoctor({
      providerId: "ollama",
      sessionDir,
      configPath,
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    const json = JSON.stringify(report);
    assert.doesNotMatch(json, new RegExp(escapeRegExp(configPath)));
    assert.doesNotMatch(json, new RegExp(escapeRegExp(sessionDir)));
    assert.match(checkFor(report, "config").detail, /config file/);
    assert.match(checkFor(report, "sessions").detail, /session directory/);

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => {
      lines.push(values.map((value) => String(value)).join(" "));
    };
    try {
      printDoctorReport(report);
    } finally {
      console.log = originalLog;
    }

    const human = lines.join("\n");
    assert.doesNotMatch(human, new RegExp(escapeRegExp(configPath)));
    assert.doesNotMatch(human, new RegExp(escapeRegExp(sessionDir)));
    assert.match(human, /config file/);
    assert.match(human, /session directory/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("human doctor output sanitizes untrusted check details", () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    lines.push(values.map((value) => String(value)).join(" "));
  };

  try {
    printDoctorReport({
      executorMode: "local",
      checks: [
        {
          name: "config",
          status: "warn",
          detail: "/tmp/config\u001b[31m password=hunter2",
        },
      ],
      summary: { ok: 0, warn: 1, fail: 0 },
    });
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.doesNotMatch(output, /\u001b|hunter2/);
  assert.match(output, /\[redacted\]/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("--check-rust sanitizes an untrusted binary path in human errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  const path = join(dir, "missing\u001b[31m-binary");
  try {
    const result = await runCli(["--check-rust", path]);

    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /\u001b/);
    assert.match(result.stderr, /Rust executor binary not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor reports project scope and runtime selection metadata without paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-scope-"));
  try {
    const report = await runDoctor({
      providerId: "ollama",
      sessionDir: join(dir, ".dev-agent", "sessions"),
      configPath: join(dir, ".dev-agent", "config.json"),
      projectState: true,
      configSource: "project",
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    assert.deepEqual(report.scope, {
      projectState: true,
      configSource: "project",
      workingDirectoryScope: "final-cwd",
    });
    assert.deepEqual(report.runtime, {
      source: "default-local",
      configured: false,
      selectedMode: "local",
    });
    assert.doesNotMatch(JSON.stringify(report), new RegExp(escapeRegExp(dir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor reports managed runtime identity and missing reason without paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-runtime-"));
  try {
    const report = await runDoctor({
      providerId: "ollama",
      sessionDir: dir,
      configPath: join(dir, "config.json"),
      runtimeSource: "default-local",
      managedRuntimeVersion: "0.2.0",
      managedRuntimeStatus: Promise.resolve({
        state: "missing",
        version: "0.2.0",
        target: "aarch64-apple-darwin",
      }),
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    assert.deepEqual(report.runtime, {
      source: "default-local",
      configured: false,
      selectedMode: "local",
      target: "aarch64-apple-darwin",
      state: "missing",
      missingReason: "runtime_not_installed",
    });
    assert.doesNotMatch(JSON.stringify(report), new RegExp(escapeRegExp(dir)));
    assert.doesNotMatch(JSON.stringify(report.runtime), /version|protocol/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runDoctor merges managed runtime platform and state with a healthy probe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-runtime-"));
  try {
    const binaryPath = join(dir, "dev-agent-executor");
    await writeFile(binaryPath, "executable", { mode: 0o700 });
    const report = await runDoctor({
      providerId: "ollama",
      rustBinaryPath: binaryPath,
      sessionDir: join(dir, "sessions"),
      runtimeSource: "runtime",
      managedRuntimeStatus: Promise.resolve({
        state: "installed",
        version: "0.2.0",
        target: "aarch64-apple-darwin",
      }),
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
      probeRust: async () => ({
        runtimeVersion: "0.2.0",
        protocolVersion: 1,
        capabilities: ["run"],
      }),
    });

    assert.deepEqual(report.runtime, {
      source: "runtime",
      configured: true,
      selectedMode: expectedRuntimeExecutorMode(),
      runtimeVersion: "0.2.0",
      protocolVersion: 1,
      target: "aarch64-apple-darwin",
      state: "installed",
    });
    assert.doesNotMatch(JSON.stringify(report), new RegExp(escapeRegExp(dir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("doctor human output includes managed runtime diagnosis without binary paths", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    lines.push(values.map((value) => String(value)).join(" "));
  };

  try {
    printDoctorReport({
      executorMode: "local",
      runtime: {
        source: "default-local",
        configured: false,
        selectedMode: "local",
        target: "aarch64-apple-darwin",
        state: "missing",
        missingReason: "runtime_not_installed",
      },
      checks: [],
      summary: { ok: 0, warn: 0, fail: 0 },
    });
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.doesNotMatch(output, /version=/);
  assert.doesNotMatch(output, /protocol=/);
  assert.match(output, /target=aarch64-apple-darwin/);
  assert.match(output, /state=missing/);
  assert.match(output, /missing-reason=runtime_not_installed/);
  assert.doesNotMatch(output, /binaryPath|dev-agent-executor/);
});
