import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { probeRustBinary, runDoctor, validateRustRuntimeContract } from "../dist/doctor.js";

const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const mockBinaryPath = fileURLToPath(
  new URL("../../../packages/executor/tests/mock-executor-binary.mjs", import.meta.url)
);

function runCheckRust(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "--check-rust", mockBinaryPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`check-failed exit=${code}: ${stderr}`));
      }
    });
  });
}

test("CLI --check-rust decodes HealthCheckResult from the mock binary", async () => {
  const stdout = await runCheckRust();
  assert.match(stdout, /Runtime version: 0\.0\.0-mock/);
  assert.match(stdout, /Capabilities: run, run_sandboxed/);
});

test("probe decodes the Rust protocol version", async () => {
  const probe = await probeRustBinary(mockBinaryPath);
  assert.equal(probe.protocolVersion, 1);
});

test("runtime contract validation requires exact release and protocol matches", () => {
  const expected = { releaseVersion: "0.2.0", protocolVersion: 1 };
  assert.deepEqual(
    validateRustRuntimeContract(
      { runtimeVersion: "0.2.0", protocolVersion: 1 },
      expected
    ),
    { ok: true }
  );
  assert.equal(
    validateRustRuntimeContract(
      { runtimeVersion: "0.2.1", protocolVersion: 1 },
      expected
    ).ok,
    false
  );
  assert.equal(
    validateRustRuntimeContract(
      { runtimeVersion: "0.2.0", protocolVersion: 2 },
      expected
    ).ok,
    false
  );
});

test("probe treats a legacy response without protocol version as zero", async () => {
  const previous = process.env.MOCK_EXECUTOR_OMIT_PROTOCOL_VERSION;
  process.env.MOCK_EXECUTOR_OMIT_PROTOCOL_VERSION = "1";
  try {
    const probe = await probeRustBinary(mockBinaryPath);
    assert.equal(probe.protocolVersion, 0);
  } finally {
    if (previous === undefined) {
      delete process.env.MOCK_EXECUTOR_OMIT_PROTOCOL_VERSION;
    } else {
      process.env.MOCK_EXECUTOR_OMIT_PROTOCOL_VERSION = previous;
    }
  }
});

test("probe rejects a response frame above the transport limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-rust-health-limit-"));
  const binary = join(directory, "oversized-runtime.mjs");
  try {
    await writeFile(
      binary,
      "#!/usr/bin/env node\nprocess.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 5, 120));\n",
      "utf8"
    );
    await chmod(binary, 0o755);

    await assert.rejects(
      () => probeRustBinary(binary),
      /Rust executor response exceeds the .* byte frame limit/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("doctor shows protocol version without exposing the runtime path", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "dev-agent-rust-health-"));
  try {
    const report = await runDoctor({
      providerId: "ollama",
      rustBinaryPath: mockBinaryPath,
      sessionDir,
      configPath: join(sessionDir, "config.json"),
      env: {},
      commandVersion: async (command) => `${command} 1.0.0`,
      probeRust: async () => ({
        runtimeVersion: "0.2.0",
        protocolVersion: 1,
        capabilities: ["run", "run_sandboxed"],
      }),
    });
    const rustCheck = report.checks.find((check) => check.name === "rust runtime");
    assert.ok(rustCheck);
    assert.equal(rustCheck.status, "ok");
    assert.match(rustCheck.detail, /protocol version 1/);
    assert.doesNotMatch(rustCheck.detail, new RegExp(mockBinaryPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});
