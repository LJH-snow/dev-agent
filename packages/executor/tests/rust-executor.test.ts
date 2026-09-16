// Drives the real RustExecutor implementation against the self-contained mock
// binary, covering the protobufjs oneof encoding that manual wire tests skip.

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveExecutorMode, RustExecutor } from "../dist/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const mockBinary = join(here, "..", "tests", "mock-executor-binary.mjs");

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
