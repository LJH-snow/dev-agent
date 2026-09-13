import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rustRoot = join(repositoryRoot, "runtime", "rust");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export const GATE_MODES = Object.freeze([
  "typescript",
  "rust",
  "integration",
]);

const FIXED_STEPS = Object.freeze({
  typescript: Object.freeze([
    step("structure", "structure check", "node", ["scripts/check.mjs"]),
    step("build", "TypeScript build", packageManager, ["build"]),
    step("typecheck", "TypeScript typecheck", packageManager, ["typecheck"]),
    step("typescript-test", "TypeScript tests", packageManager, ["test"]),
    step(
      "gate-contract",
      "release gate contract tests",
      "node",
      ["--test", "tests/release-gate.test.mjs"]
    ),
  ]),
  rust: Object.freeze([
    step("rust-fmt", "Rust format check", "cargo", ["fmt", "--check"], rustRoot),
    step(
      "rust-clippy",
      "Rust clippy",
      "cargo",
      ["clippy", "--all-targets", "--", "-D", "warnings"],
      rustRoot
    ),
    step("rust-test", "Rust unit and doc tests", "cargo", ["test"], rustRoot),
  ]),
  integration: Object.freeze([
    step(
      "rust-integration",
      "real Rust integration tests",
      packageManager,
      ["--filter", "@dev-agent/executor", "test:integration"]
    ),
  ]),
});

function step(id, label, command, args, cwd = repositoryRoot) {
  return Object.freeze({
    id,
    label,
    command,
    args: Object.freeze([...args]),
    cwd,
    shell: false,
  });
}

export function parseGateArgs(args) {
  const selected = new Set();
  let help = false;
  let all = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--typescript" || arg === "--rust" || arg === "--integration") {
      selected.add(arg.slice(2));
      continue;
    }
    throw new Error(`unknown gate option: ${arg}`);
  }

  if (all && selected.size > 0) {
    throw new Error("--all cannot be combined with a phase option");
  }

  const modes = all || selected.size === 0
    ? [...GATE_MODES]
    : GATE_MODES.filter((mode) => selected.has(mode));

  return Object.freeze({
    help,
    modes: Object.freeze(help ? [] : modes),
  });
}

export function createGatePlan(selection) {
  const modes = selection?.modes ?? [];
  const plan = [];
  for (const mode of modes) {
    const steps = FIXED_STEPS[mode];
    if (!steps) {
      throw new Error(`unknown gate mode: ${mode}`);
    }
    plan.push(...steps);
  }
  return Object.freeze([...plan]);
}

export async function runGatePlan(plan, execute = runStep) {
  for (const currentStep of plan) {
    console.log(`\n=== ${currentStep.label} ===`);
    const exitCode = await execute(currentStep);
    if (exitCode !== 0) {
      console.error(
        `${currentStep.label} failed with exit code ${exitCode ?? 1}`
      );
      return exitCode ?? 1;
    }
  }
  console.log("\n=== all selected gates passed ===");
  return 0;
}

function runStep(currentStep) {
  return new Promise((resolveExit) => {
    const child = spawn(currentStep.command, currentStep.args, {
      cwd: currentStep.cwd,
      env: process.env,
      shell: currentStep.shell,
      stdio: "inherit",
    });
    let settled = false;
    const finish = (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveExit(exitCode);
    };
    child.once("error", (error) => {
      console.error(`${currentStep.label} could not start: ${error.message}`);
      finish(1);
    });
    child.once("exit", (exitCode, signal) => {
      if (exitCode !== null) {
        finish(exitCode);
        return;
      }
      finish(signal ? 128 : 1);
    });
  });
}

export function formatHelp() {
  return [
    "Usage: node scripts/release-gate.mjs [options]",
    "",
    "Runs fixed, fail-fast repository verification stages.",
    "With no option, runs TypeScript, Rust, then real-Rust integration.",
    "",
    "Options:",
    "  --typescript   structure check, build, typecheck, TypeScript tests",
    "  --rust         cargo fmt, clippy, and Rust unit/doc tests",
    "  --integration  real Rust integration tests",
    "  --all          explicitly select the complete gate",
    "  --help         show this help",
  ].join("\n");
}

async function main() {
  let selection;
  try {
    selection = parseGateArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(formatHelp());
    process.exitCode = 2;
    return;
  }

  if (selection.help) {
    console.log(formatHelp());
    return;
  }

  process.exitCode = await runGatePlan(createGatePlan(selection));
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entrypoint === fileURLToPath(import.meta.url)) {
  await main();
}
