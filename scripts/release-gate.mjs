import { spawn } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rustRoot = join(repositoryRoot, "runtime", "rust");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export const GATE_REPORT_SCHEMA_VERSION = 1;
export const RELEASE_GATE_REPORT_PATH = join(
  repositoryRoot,
  ".dev-agent",
  "release-gate-report.json"
);

export const GATE_MODES = Object.freeze([
  "typescript",
  "rust",
  "integration",
]);

export const DEFAULT_STEP_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_KILL_GRACE_MS = 5 * 1000;

const FIXED_STEPS = Object.freeze({
  typescript: Object.freeze([
    step("structure", "structure check", "node", ["scripts/check.mjs"]),
    step("build", "TypeScript build", packageManager, ["build"]),
    step("typecheck", "TypeScript typecheck", packageManager, ["typecheck"]),
    step("typescript-test", "TypeScript tests", packageManager, ["test"]),
    step(
      "package-smoke",
      "CLI package install smoke test",
      packageManager,
      ["package:smoke"]
    ),
    step(
      "npm-release-preflight-contract",
      "npm release preflight contract",
      "node",
      ["--test", "tests/npm-release-preflight.test.mjs"]
    ),
    step(
      "npm-release-publish-contract",
      "npm release publish contract",
      "node",
      ["--test", "tests/npm-release-publish.test.mjs"]
    ),
    step(
      "preview-contract",
      "preview contract tests",
      "node",
      [
        "--test",
        "tests/evidence-preview-benchmark.test.mjs",
        "tests/evidence-preview-parity.test.mjs",
      ]
    ),
    step(
      "gate-contract",
      "release gate contract tests",
      "node",
      ["--test", "tests/release-gate.test.mjs"]
    ),
    step(
      "release-workflow-contract",
      "release workflow contract tests",
      "node",
      ["--test", "tests/release-workflow.test.mjs"]
    ),
    step(
      "ci-workflow-contract",
      "CI workflow contract tests",
      "node",
      ["--test", "tests/ci-workflow.test.mjs"]
    ),
    step(
      "documentation-contract",
      "documentation contract tests",
      "node",
      ["--test", "tests/documentation-contract.test.mjs"]
    ),
    step(
      "native-desktop-contract",
      "native Desktop bundle contract tests",
      "node",
      ["--test", "tests/native-desktop-bundle.test.mjs"]
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
  let report = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--report") {
      report = true;
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
    report,
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
    plan.push(...steps.map((currentStep) => Object.freeze({ ...currentStep, mode })));
  }
  return Object.freeze([...plan]);
}

export async function runGatePlan(plan, execute = runStep, options = {}) {
  const result = await runGatePlanWithReport(plan, execute, options);
  return result.exitCode;
}

export async function runGatePlanWithReport(plan, execute = runStep, options = {}) {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const generatedAt = options.generatedAt ?? new Date(now()).toISOString();
  const results = [];
  const modes = GATE_MODES.filter((mode) =>
    plan.some((currentStep) => currentStep.mode === mode)
  );

  for (const currentStep of plan) {
    logger.log(`\n=== ${currentStep.label} ===`);
    const startedAtMs = now();
    const exitCode = execute === runStep
      ? await execute(currentStep, options)
      : await execute(currentStep);
    const finishedAtMs = now();
    const result = {
      id: currentStep.id,
      status: exitCode === 0 ? "passed" : "failed",
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      exitCode: exitCode ?? 1,
    };
    results.push(result);
    if (exitCode !== 0) {
      logger.error(
        `${currentStep.label} failed with exit code ${exitCode ?? 1}`
      );
      return {
        exitCode: exitCode ?? 1,
        report: createGateReport(modes, results, generatedAt),
      };
    }
  }
  logger.log("\n=== all selected gates passed ===");
  return {
    exitCode: 0,
    report: createGateReport(modes, results, generatedAt),
  };
}

export function createGateReport(modes, results, generatedAt = new Date().toISOString()) {
  const failedStep = results.find((result) => result.status === "failed");
  return {
    schemaVersion: GATE_REPORT_SCHEMA_VERSION,
    generatedAt,
    modes: [...modes],
    status: failedStep ? "failed" : "passed",
    ...(failedStep ? { failedStepId: failedStep.id } : {}),
    steps: results.map((result) => ({
      id: result.id,
      status: result.status,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
    })),
  };
}

export async function writeGateReport(report) {
  await mkdir(dirname(RELEASE_GATE_REPORT_PATH), { recursive: true });
  const tempPath = `${RELEASE_GATE_REPORT_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, RELEASE_GATE_REPORT_PATH);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export function runStep(
  currentStep,
  {
    timeoutMs = DEFAULT_STEP_TIMEOUT_MS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    spawnProcess = spawn,
  } = {}
) {
  return new Promise((resolveExit) => {
    const child = spawnProcess(currentStep.command, currentStep.args, {
      cwd: currentStep.cwd,
      env: process.env,
      shell: currentStep.shell,
      stdio: "inherit",
    });
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
      if (!timedOut) {
        console.error(`${currentStep.label} could not start: ${error.message}`);
      }
      finish(timedOut ? 124 : 1);
    });
    child.once("exit", (exitCode, signal) => {
      if (timedOut) {
        finish(124);
        return;
      }
      if (exitCode !== null) {
        finish(exitCode);
        return;
      }
      finish(signal ? 128 : 1);
    });
    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      console.error(`${currentStep.label} timed out after ${timeoutMs}ms`);
      killHandle = setTimeout(() => {
        if (!settled) {
          terminate("SIGKILL");
        }
      }, killGraceMs);
      terminate("SIGTERM");
    }, timeoutMs);
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
    "  --report       write metadata-only results to .dev-agent/release-gate-report.json",
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

  const result = await runGatePlanWithReport(createGatePlan(selection));
  if (selection.report) {
    try {
      await writeGateReport(result.report);
      console.log(`Report written to ${RELEASE_GATE_REPORT_PATH}`);
    } catch (error) {
      console.error(
        `could not write release gate report: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = result.exitCode === 0 ? 1 : result.exitCode;
      return;
    }
  }
  process.exitCode = result.exitCode;
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entrypoint === fileURLToPath(import.meta.url)) {
  await main();
}
