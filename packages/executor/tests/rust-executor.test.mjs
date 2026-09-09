// Drives the real RustExecutor implementation against the self-contained mock
// binary, covering the protobufjs oneof encoding that manual wire tests skip.

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RustExecutor } from "../dist/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const mockBinary = join(here, "mock-executor-binary.mjs");

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
