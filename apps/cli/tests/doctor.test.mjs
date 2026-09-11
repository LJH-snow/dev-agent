import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runDoctor } from "../dist/doctor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");

const CHECK_NAMES = ["node", "ripgrep", "protoc", "rust runtime", "provider", "sessions"];

function runCli(args, env = process.env) {
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

test("runDoctor reports a healthy environment as ok", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dev-agent-doctor-"));
  try {
    const report = await runDoctor({
      providerId: "openai",
      sessionDir: dir,
      nodeVersion: "v26.4.0",
      env: { OPENAI_API_KEY: "test-key" },
      commandVersion: async (command) => `${command} 1.0.0`,
      probeRust: async () => ({ runtimeVersion: "0.1.0", capabilities: ["run"] }),
    });

    assert.deepEqual(
      report.checks.map((check) => check.name),
      CHECK_NAMES
    );
    assert.equal(report.summary.fail, 0);
    assert.equal(report.summary.warn, 1, "the unconfigured rust runtime warns");
    assert.equal(report.summary.ok, 5);
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
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
    });

    const rust = checkFor(report, "rust runtime");
    assert.equal(rust.status, "fail");
    assert.equal(report.summary.fail, 1);
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
