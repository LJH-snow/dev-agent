import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "index.js");
const runtimeCommand = await import("../dist/runtime-command.js");

function runCli(
  args: readonly string[],
  cwd: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: cwd,
        USERPROFILE: cwd,
        DEV_AGENT_MODEL_PROVIDER: "ollama",
        DEV_AGENT_CONFIG_FILE: join(cwd, "missing-config.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("runtime status is provider-free and reports a missing isolated runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-runtime-cli-"));
  try {
    const result = await runCli(
      [
        "runtime",
        "status",
        "--runtime-version",
        "0.2.0",
        "--runtime-dir",
        join(root, "runtimes"),
        "--json",
      ],
      root
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(
      {
        command: payload.command,
        action: payload.action,
        version: payload.version,
        state: payload.state,
        supported: payload.supported,
      },
      {
        command: "runtime",
        action: "status",
        version: "0.2.0",
        state: "missing",
        supported: true,
      }
    );
    assert.equal(typeof payload.target, "string");
    assert.equal("provider" in payload, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime path fails closed without an installed runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-runtime-cli-"));
  try {
    const result = await runCli(
      [
        "runtime",
        "path",
        "--runtime-version",
        "0.2.0",
        "--runtime-dir",
        join(root, "runtimes"),
        "--json",
      ],
      root
    );

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "RUNTIME_NOT_INSTALLED");
    assert.equal("path" in payload.error, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime release parsing keeps carrying release separate from runtime identity", () => {
  assert.equal(runtimeCommand.readRuntimeManifestRelease([]), "0.1.6");
  assert.equal(
    runtimeCommand.readRuntimeManifestRelease(["--runtime-release", "0.1.7"]),
    "0.1.7"
  );
  assert.equal(
    runtimeCommand.readRuntimeManifestRelease(["--runtime-release", "  "]),
    "0.1.6"
  );
});

test("runtime status accepts the release flag without leaking carrier metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-runtime-release-cli-"));
  try {
    const result = await runCli(
      [
        "runtime",
        "status",
        "--runtime-version",
        "0.2.0",
        "--runtime-release",
        "0.1.6",
        "--runtime-dir",
        join(root, "runtimes"),
        "--json",
      ],
      root
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.version, "0.2.0");
    assert.equal(payload.state, "missing");
    assert.equal("release" in payload, false);
    assert.equal("manifestRelease" in payload, false);
    assert.equal("manifestReleaseVersion" in payload, false);
    assert.equal("path" in payload, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime remove is idempotent and never loads a provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-runtime-cli-"));
  try {
    const result = await runCli(
      [
        "runtime",
        "remove",
        "--runtime-version",
        "0.2.0",
        "--runtime-dir",
        join(root, "runtimes"),
        "--json",
      ],
      root
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      command: "runtime",
      action: "remove",
      version: "0.2.0",
      removed: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime version flag does not print the CLI version", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-runtime-cli-"));
  try {
    const result = await runCli(
      [
        "runtime",
        "status",
        "--version",
        "0.2.0",
        "--runtime-dir",
        join(root, "runtimes"),
        "--json",
      ],
      root
    );

    assert.notEqual(result.stdout.trim(), "dev-agent 0.1.4");
    assert.equal(result.code, 1);
    assert.match(result.stdout, /Unexpected argument|unknown option|version/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normal runs fail closed when rust-sandbox has no managed runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "dev-agent-runtime-cli-"));
  try {
    const result = await runCli(
      [
        "--executor",
        "rust-sandbox",
        "--runtime-version",
        "0.2.0",
        "--runtime-dir",
        join(root, "runtimes"),
        "--once",
        "this must not reach a provider",
        "--json",
      ],
      root
    );

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.match(payload.error, /not installed|runtime/i);
    assert.doesNotMatch(result.stdout, /provider|ollama/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
