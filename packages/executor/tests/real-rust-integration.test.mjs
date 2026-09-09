import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RustExecutor } from "../dist/index.js";

const rustBinaryPath = fileURLToPath(
  new URL("../../../runtime/rust/target/debug/dev-agent-executor", import.meta.url)
);
const sandboxExecPath = "/usr/bin/sandbox-exec";
const canRunRust =
  existsSync(rustBinaryPath) &&
  process.platform === "darwin" &&
  existsSync(sandboxExecPath) &&
  existsSync("/usr/bin/python3");

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

test(
  "real Rust binary rejects writes to readonly paths",
  { skip: canRunRust ? false : "Rust binary or macOS sandbox not available" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "dev-agent-sandbox-"));
    const readonlyPath = join(dir, "readonly.txt");
    await writeFile(readonlyPath, "keep\n");
    const executor = new RustExecutor({ binaryPath: rustBinaryPath });
    try {
      const result = await executor.runSandboxed(
        "/bin/sh",
        ["-c", "echo blocked > readonly.txt"],
        {
          cwd: dir,
          profile: {
            name: "readonly",
            network: "disabled",
            writablePaths: [dir],
            readonlyPaths: [readonlyPath],
            policyScript: "True",
          },
        }
      );
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /Operation not permitted/);
      assert.equal(await readFile(readonlyPath, "utf8"), "keep\n");
    } finally {
      await executor.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "real Rust binary blocks network when disabled",
  { skip: canRunRust ? false : "Rust binary or macOS sandbox not available" },
  async () => {
    const executor = new RustExecutor({ binaryPath: rustBinaryPath });
    try {
      const script = [
        "import socket",
        "s = socket.socket()",
        "s.settimeout(1)",
        "s.connect(('127.0.0.1', 65530))",
      ].join("; ");
      const result = await executor.runSandboxed("/usr/bin/python3", ["-c", script], {
        profile: {
          name: "network-off",
          network: "disabled",
          policyScript: "True",
        },
      });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /Operation not permitted/);
    } finally {
      await executor.dispose();
    }
  }
);

test(
  "real Rust binary allows loopback when configured",
  { skip: canRunRust ? false : "Rust binary or macOS sandbox not available" },
  async () => {
    const executor = new RustExecutor({ binaryPath: rustBinaryPath });
    try {
      const script = [
        "import socket, threading",
        "ls = socket.socket()",
        "ls.bind(('127.0.0.1', 0))",
        "ls.listen(1)",
        "port = ls.getsockname()[1]",
        "threading.Thread(target=lambda: (lambda c: (c.sendall(b'ok'), c.close()))(ls.accept()[0]), daemon=True).start()",
        "s = socket.socket()",
        "s.settimeout(2)",
        "s.connect(('127.0.0.1', port))",
        "print(s.recv(2).decode())",
        "s.close()",
      ].join("; ");
      const result = await executor.runSandboxed("/usr/bin/python3", ["-c", script], {
        profile: {
          name: "loopback",
          network: "loopback",
          policyScript: "True",
        },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "ok");
    } finally {
      await executor.dispose();
    }
  }
);

test(
  "real Rust binary allows conforming writes",
  { skip: canRunRust ? false : "Rust binary or macOS sandbox not available" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "dev-agent-sandbox-"));
    const outPath = join(dir, "out.txt");
    const executor = new RustExecutor({ binaryPath: rustBinaryPath });
    try {
      const result = await executor.runSandboxed(
        "/bin/sh",
        ["-c", "echo ok > out.txt"],
        {
          cwd: dir,
          profile: {
            name: "writable",
            network: "disabled",
            writablePaths: [dir],
            policyScript: "True",
          },
        }
      );
      assert.equal(result.exitCode, 0);
      assert.equal(await readFile(outPath, "utf8"), "ok\n");
    } finally {
      await executor.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "real Rust binary applies profile timeout",
  { skip: canRunRust ? false : "Rust binary or macOS sandbox not available" },
  async () => {
    const executor = new RustExecutor({ binaryPath: rustBinaryPath });
    try {
      const result = await executor.runSandboxed("/bin/sleep", ["10"], {
        profile: {
          name: "timeout",
          network: "disabled",
          timeoutMs: 100,
          policyScript: "True",
        },
      });
      assert.equal(result.timedOut, true);
      assert.equal(result.exitCode, -1);
    } finally {
      await executor.dispose();
    }
  }
);

test(
  "real Rust binary applies resource limits",
  { skip: canRunRust ? false : "Rust binary or macOS sandbox not available" },
  async () => {
    const executor = new RustExecutor({ binaryPath: rustBinaryPath });
    try {
      const result = await executor.runSandboxed("/bin/sh", ["-c", "ulimit -n"], {
        profile: {
          name: "resources",
          network: "disabled",
          policyScript: "True",
        },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "4096");
    } finally {
      await executor.dispose();
    }
  }
);
