// Drives the real RustExecutor implementation against the self-contained mock
// binary, covering the protobufjs oneof encoding that manual wire tests skip.

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveExecutorMode, RustExecutor } from "../dist/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const mockBinary = join(here, "..", "tests", "mock-executor-binary.mjs");

test("RustExecutor refuses a directory as its binary path before spawning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-rust-preflight-"));
  const runtimeDirectory = join(directory, "runtime-dir");
  try {
    await mkdir(runtimeDirectory);
    const executor = new RustExecutor({ binaryPath: runtimeDirectory });
    await assert.rejects(
      executor.run("echo", ["hello"]),
      /Rust executor binary path is not a regular file/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("RustExecutor refuses a non-executable regular file on Unix", async (t) => {
  if (process.platform === "win32") {
    t.skip("Unix executable-bit checks do not apply on Windows");
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-rust-preflight-"));
  const inertBinary = join(directory, "inert-runtime.mjs");
  try {
    await writeFile(inertBinary, "#!/usr/bin/env node\n", "utf8");
    await chmod(inertBinary, 0o644);
    const executor = new RustExecutor({ binaryPath: inertBinary });
    await assert.rejects(
      executor.run("echo", ["hello"]),
      /Rust executor binary is not executable/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("executor mode resolver keeps local and unsupported states explicit", () => {
  assert.equal(resolveExecutorMode(), "local");
  assert.equal(resolveExecutorMode(mockBinary, "darwin"), "sandboxed-macos");
  assert.equal(resolveExecutorMode(mockBinary, "linux"), "sandboxed-linux");
  assert.equal(resolveExecutorMode(mockBinary, "win32"), "unsupported");
});

test("RustExecutor exposes its restricted platform mode without starting", () => {
  const executor = new RustExecutor({ binaryPath: mockBinary });
  const expected =
    process.platform === "darwin"
      ? "sandboxed-macos"
      : process.platform === "linux"
        ? "sandboxed-linux"
        : "unsupported";
  assert.equal(executor.mode, expected);
});

test("RustExecutor encodes a run request the mock binary can decode", async () => {
  const executor = new RustExecutor({ binaryPath: mockBinary });
  try {
    const result = await executor.run("echo", ["hello"]);
    assert.equal(result.stdout, "mock:echo");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await executor.dispose();
  }
});

test("RustExecutor encodes a sandboxed request the mock binary can decode", async () => {
  const executor = new RustExecutor({ binaryPath: mockBinary });
  try {
    const result = await executor.runSandboxed("npm", ["install"], {
      profile: {
        name: "ci",
        network: "disabled",
        writablePaths: ["/tmp"],
        policyScript: "allow_all()",
      },
    });
    assert.equal(result.stdout, "sandboxed:npm");
  } finally {
    await executor.dispose();
  }
});

test("RustExecutor exposes policy denials as typed sandbox errors", async () => {
  process.env.MOCK_EXECUTOR_BEHAVIOR = "error:POLICY_DENIED";
  const executor = new RustExecutor({ binaryPath: mockBinary });
  try {
    await assert.rejects(
      executor.runSandboxed("curl", ["https://example.com"], {
        profile: {
          name: "restricted",
          network: "disabled",
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "SandboxDeniedError" &&
        (error as Error & { code?: string }).code === "SANDBOX_DENIED" &&
        (error as Error & { originalCode?: string }).originalCode === "POLICY_DENIED"
    );
  } finally {
    await executor.dispose();
    delete process.env.MOCK_EXECUTOR_BEHAVIOR;
  }
});

test("RustExecutor forwards maxOutputBytes to the runtime", async () => {
  process.env.MOCK_EXECUTOR_BEHAVIOR = "reflect";
  const executor = new RustExecutor({ binaryPath: mockBinary });
  try {
    const result = await executor.run("echo", ["hi"], { maxOutputBytes: 4096 });
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.maxOutputBytes, 4096);
  } finally {
    await executor.dispose();
    delete process.env.MOCK_EXECUTOR_BEHAVIOR;
  }
});

test("RustExecutor applies the default output limit when none is given", async () => {
  process.env.MOCK_EXECUTOR_BEHAVIOR = "reflect";
  const executor = new RustExecutor({ binaryPath: mockBinary });
  try {
    const result = await executor.run("echo", ["hi"]);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.maxOutputBytes, 1_000_000);
  } finally {
    await executor.dispose();
    delete process.env.MOCK_EXECUTOR_BEHAVIOR;
  }
});

test("RustExecutor surfaces bytesTruncated from the runtime", async () => {
  process.env.MOCK_EXECUTOR_BEHAVIOR = "truncate";
  const executor = new RustExecutor({ binaryPath: mockBinary });
  try {
    const result = await executor.run("yes");
    assert.equal(result.bytesTruncated, true);
    assert.equal(result.stdout, "partial-output");
  } finally {
    await executor.dispose();
    delete process.env.MOCK_EXECUTOR_BEHAVIOR;
  }
});

test("RustExecutor rejects an oversized incoming frame before buffering its payload", async () => {
  const executor = new RustExecutor({
    binaryPath: join(here, "..", "tests", "oversized-frame-binary.mjs"),
    maxFrameBytes: 64,
    requestTimeoutMs: 1000,
  } as any);

  try {
    await assert.rejects(
      executor.run("echo", ["hello"]),
      /Rust executor frame exceeds maximum of 64 bytes/
    );
  } finally {
    await executor.dispose();
  }
});

test("RustExecutor rejects an oversized outgoing frame before writing it", async () => {
  const executor = new RustExecutor({
    binaryPath: mockBinary,
    maxFrameBytes: 8,
    requestTimeoutMs: 1000,
  } as any);

  try {
    await assert.rejects(
      executor.run("echo", ["hello"]),
      /Rust executor frame exceeds maximum of 8 bytes/
    );
  } finally {
    await executor.dispose();
  }
});

test("RustExecutor fails closed when the pre-spawn verifier rejects", async () => {
  const executor = new RustExecutor({
    binaryPath: mockBinary,
    verifyBeforeSpawn: () => {
      throw new Error("managed runtime failed re-validation");
    },
  } as any);

  try {
    await assert.rejects(
      executor.run("echo", ["hello"]),
      /managed runtime failed re-validation/
    );
  } finally {
    await executor.dispose();
  }
});

test("RustExecutor invokes the pre-spawn verifier with the binary path before spawning", async () => {
  const verifiedPaths: string[] = [];
  const executor = new RustExecutor({
    binaryPath: mockBinary,
    verifyBeforeSpawn: async (binaryPath) => {
      verifiedPaths.push(binaryPath);
    },
  } as any);

  try {
    const result = await executor.run("echo", ["hello"]);
    assert.equal(result.stdout, "mock:echo");
    assert.deepEqual(verifiedPaths, [mockBinary]);
  } finally {
    await executor.dispose();
  }
});
