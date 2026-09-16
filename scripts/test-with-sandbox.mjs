import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_STEP_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 5 * 1000;

function run(label, args, options = {}) {
  const {
    timeoutMs = DEFAULT_STEP_TIMEOUT_MS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    ...spawnOptions
  } = options;
  console.log(`\n=== ${label} ===`);
  const child = spawn(args[0], args.slice(1), {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    ...spawnOptions,
    shell: false,
  });
  return new Promise((resolveExit) => {
    let settled = false;
    let timedOut = false;
    let timeoutHandle;
    let killHandle;
    const finish = (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(killHandle);
      resolveExit(exitCode);
    };
    const terminate = (signal) => {
      try {
        child.kill(signal);
      } catch {
        // The child may already be gone; the exit event remains authoritative.
      }
    };
    child.once("error", (error) => {
      console.error(`${label} could not start: ${error.message}`);
      finish(timedOut ? 124 : 1);
    });
    child.once("exit", (code, signal) => {
      finish(timedOut ? 124 : code ?? (signal ? 128 : 1));
    });
    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      console.error(`${label} timed out after ${timeoutMs}ms`);
      killHandle = setTimeout(() => {
        if (!settled) {
          terminate("SIGKILL");
        }
      }, killGraceMs);
      terminate("SIGTERM");
    }, timeoutMs);
  });
}

async function main() {
  const structural = await run("structure check", ["node", "scripts/check.mjs"]);
  if (structural !== 0) {
    console.error("structure check failed");
    process.exitCode = 1;
    return;
  }

  const typecheck = await run("typecheck", ["pnpm", "-r", "typecheck"]);
  if (typecheck !== 0) {
    console.error("typecheck failed");
    process.exitCode = 1;
    return;
  }

  const unitTests = await run("unit tests", ["pnpm", "-r", "test"]);
  if (unitTests !== 0) {
    console.error("unit tests failed");
    process.exitCode = 1;
    return;
  }

  const rustTests = await run("rust tests", ["cargo", "test"], { cwd: join(root, "runtime/rust") });
  if (rustTests !== 0) {
    console.error("rust tests failed");
    process.exitCode = 1;
    return;
  }

  const integration = await run(
    "sandbox integration tests",
    ["pnpm", "--filter", "@dev-agent/executor", "run", "test:integration"]
  );

  if (integration !== 0) {
    console.error("sandbox integration tests failed");
    process.exitCode = 1;
    return;
  }

  console.log("\n=== all checks passed ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
