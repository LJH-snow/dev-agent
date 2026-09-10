import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(label, args, options = {}) {
  console.log(`\n=== ${label} ===`);
  const child = spawn(args[0], args.slice(1), {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
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
