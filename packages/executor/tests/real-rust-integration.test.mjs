import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RustExecutor } from "../dist/index.js";

const rustBinaryPath = fileURLToPath(
  new URL("../../../runtime/rust/target/debug/dev-agent-executor", import.meta.url)
);
const canRunRust = existsSync(rustBinaryPath);

test(
  "real Rust binary enforces Starlark sandbox policies",
  { skip: canRunRust ? false : "Rust binary not built" },
  async () => {
    const executor = new RustExecutor({ binaryPath: rustBinaryPath });
    try {
      await assert.rejects(
        executor.runSandboxed("/bin/echo", ["no"], {
          profile: {
            name: "deny",
            network: "disabled",
            policyScript: "False",
          },
        }),
        /POLICY_DENIED/
      );

      const allowed = await executor.runSandboxed("/bin/echo", ["yes"], {
        profile: {
          name: "allow",
          network: "disabled",
          policyScript: "True",
        },
      });
      assert.equal(allowed.stdout, "yes\n");
      assert.equal(allowed.exitCode, 0);
    } finally {
      await executor.dispose();
    }
  }
);
