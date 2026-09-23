import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createGatePlan,
  createGateReport,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  parseGateArgs,
  RELEASE_GATE_REPORT_PATH,
  runGatePlan,
  runStep,
  writeGateReport,
  runGatePlanWithReport,
} from "../scripts/release-gate.mjs";

function createNeverExitingChild() {
  const child = new EventEmitter();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") {
      queueMicrotask(() => child.emit("exit", null, signal));
    }
    return true;
  };
  return { child, signals };
}

test("the default gate uses the fixed TypeScript, Rust, and integration order", () => {
  const selection = parseGateArgs([]);
  const plan = createGatePlan(selection);

  assert.deepEqual(selection.modes, ["typescript", "rust", "integration"]);
  assert.equal(selection.report, false);
  assert.deepEqual(plan.map((step) => step.id), [
    "structure",
    "build",
    "typecheck",
    "typescript-test",
    "package-smoke",
    "npm-release-preflight-contract",
    "npm-release-publish-contract",
    "preview-contract",
    "gate-contract",
    "release-workflow-contract",
    "ci-workflow-contract",
    "documentation-contract",
    "native-desktop-contract",
    "rust-fmt",
    "rust-clippy",
    "rust-test",
    "rust-integration",
  ]);
  assert.deepEqual(
    plan.map((step) => [step.command, ...step.args]),
    [
      ["node", "scripts/check.mjs"],
      ["pnpm", "build"],
      ["pnpm", "typecheck"],
      ["pnpm", "test"],
      ["pnpm", "package:smoke"],
      ["node", "--test", "tests/npm-release-preflight.test.mjs"],
      ["node", "--test", "tests/npm-release-publish.test.mjs"],
      [
        "node",
        "--test",
        "tests/evidence-preview-benchmark.test.mjs",
        "tests/evidence-preview-parity.test.mjs",
      ],
      ["node", "--test", "tests/release-gate.test.mjs"],
      ["node", "--test", "tests/release-workflow.test.mjs"],
      ["node", "--test", "tests/ci-workflow.test.mjs"],
      ["node", "--test", "tests/documentation-contract.test.mjs"],
      ["node", "--test", "tests/native-desktop-bundle.test.mjs"],
      ["cargo", "fmt", "--check"],
      ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"],
      ["cargo", "test"],
      ["pnpm", "--filter", "@dev-agent/executor", "test:integration"],
    ]
  );
});

test("root workspace tests serialize package suites to avoid cross-package contention", () => {
  const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
  const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
  assert.equal(rootPackage.scripts.test, "pnpm -r --workspace-concurrency=1 run test");
});

test("phase flags select only the requested fixed gate", () => {
  assert.deepEqual(parseGateArgs(["--typescript"]).modes, ["typescript"]);
  assert.deepEqual(parseGateArgs(["--rust"]).modes, ["rust"]);
  assert.deepEqual(parseGateArgs(["--integration"]).modes, ["integration"]);
  assert.deepEqual(parseGateArgs(["--rust", "--typescript"]).modes, [
    "typescript",
    "rust",
  ]);
  assert.deepEqual(parseGateArgs(["--help"]).modes, []);
  assert.equal(parseGateArgs(["--help"]).help, true);
  assert.equal(parseGateArgs(["--report"]).report, true);
});

test("gate plans use fixed working directories and never enable a shell", () => {
  const plan = createGatePlan(parseGateArgs([]));
  const repositoryRoot = plan[0].cwd;
  const rustRoot = plan.find((step) => step.id === "rust-test")?.cwd;
  const expectedRepositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

  assert.equal(repositoryRoot, expectedRepositoryRoot);
  assert.equal(rustRoot, resolve(expectedRepositoryRoot, "runtime/rust"));
  assert.notEqual(repositoryRoot, rustRoot);
  for (const step of plan) {
    assert.equal(step.shell, false, step.id);
    assert.equal(step.env, undefined, step.id);
  }
});

test("unknown gate arguments are rejected instead of becoming commands", () => {
  assert.throws(() => parseGateArgs(["--run", "rm", "-rf"]), /unknown gate option/);
  assert.throws(() => parseGateArgs(["--all", "--rust"]), /cannot be combined/);
});

test("the runner stops at the first failed fixed step", async () => {
  const plan = createGatePlan(parseGateArgs(["--typescript"]));
  const observed = [];
  const exitCode = await runGatePlan(
    plan,
    async (step) => {
      observed.push(step.id);
      return step.id === "build" ? 23 : 0;
    },
    { logger: { log() {}, error() {} } }
  );

  assert.equal(exitCode, 23);
  assert.deepEqual(observed, ["structure", "build"]);
});

test("release gate defaults keep a bounded step timeout and kill grace period", () => {
  assert.equal(DEFAULT_STEP_TIMEOUT_MS, 30 * 60 * 1000);
  assert.equal(DEFAULT_KILL_GRACE_MS, 5 * 1000);
});

test("a never-exiting child is terminated after its timeout and returns failure", async () => {
  const { child, signals } = createNeverExitingChild();
  const exitCode = await runStep(
    {
      id: "fake-timeout",
      label: "fake timeout",
      command: "fake-child",
      args: [],
      cwd: resolve(fileURLToPath(new URL("../", import.meta.url))),
      shell: false,
    },
    {
      timeoutMs: 10,
      killGraceMs: 10,
      spawnProcess: () => child,
    }
  );

  assert.equal(exitCode, 124);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});


test("gate reports are a fixed metadata-only allowlist", () => {
  const report = createGateReport(
    ["typescript"],
    [
      {
        id: "structure",
        status: "passed",
        startedAt: "2026-09-14T00:00:00.000Z",
        finishedAt: "2026-09-14T00:00:00.010Z",
        durationMs: 10,
        exitCode: 0,
      },
      {
        id: "build",
        status: "failed",
        startedAt: "2026-09-14T00:00:00.010Z",
        finishedAt: "2026-09-14T00:00:00.025Z",
        durationMs: 15,
        exitCode: 23,
      },
    ],
    "2026-09-14T00:00:00.025Z"
  );

  assert.deepEqual(report, {
    schemaVersion: 1,
    generatedAt: "2026-09-14T00:00:00.025Z",
    modes: ["typescript"],
    status: "failed",
    failedStepId: "build",
    steps: [
      {
        id: "structure",
        status: "passed",
        startedAt: "2026-09-14T00:00:00.000Z",
        finishedAt: "2026-09-14T00:00:00.010Z",
        durationMs: 10,
        exitCode: 0,
      },
      {
        id: "build",
        status: "failed",
        startedAt: "2026-09-14T00:00:00.010Z",
        finishedAt: "2026-09-14T00:00:00.025Z",
        durationMs: 15,
        exitCode: 23,
      },
    ],
  });
  assert.equal(RELEASE_GATE_REPORT_PATH.endsWith("/.dev-agent/release-gate-report.json"), true);
  assert.throws(
    () => parseGateArgs(["--report", "/tmp/untrusted-report.json"]),
    /unknown gate option/
  );
  assert.equal("command" in report.steps[0], false);
  assert.equal("cwd" in report.steps[0], false);
  assert.equal("stdout" in report.steps[0], false);
  assert.equal("stderr" in report.steps[0], false);
});

test("runGatePlanWithReport records only completed steps and preserves fail-fast", async () => {
  let tick = 0;
  const result = await runGatePlanWithReport(
    createGatePlan(parseGateArgs(["--typescript"])),
    async (step) => (step.id === "build" ? 23 : 0),
    {
      generatedAt: "2026-09-14T00:00:00.000Z",
      now: () => (tick += 5),
      logger: { log() {}, error() {} },
    }
  );

  assert.equal(result.exitCode, 23);
  assert.equal(result.report.status, "failed");
  assert.equal(result.report.failedStepId, "build");
  assert.deepEqual(result.report.steps.map((step) => step.id), [
    "structure",
    "build",
  ]);
  assert.equal(result.report.steps[0].durationMs, 5);
  assert.equal(result.report.steps[1].durationMs, 5);
});

test("runGatePlan accepts a logger without changing fail-fast behavior", async () => {
  const messages = [];
  const logger = {
    log(message) {
      messages.push(`log:${message}`);
    },
    error(message) {
      messages.push(`error:${message}`);
    },
  };
  const exitCode = await runGatePlan(
    createGatePlan(parseGateArgs(["--typescript"])),
    async (step) => (step.id === "build" ? 23 : 0),
    { logger }
  );

  assert.equal(exitCode, 23);
  assert.equal(messages.some((message) => message.includes("structure check")), true);
  assert.equal(messages.some((message) => message.includes("failed with exit code 23")), true);
});


test("writeGateReport uses the fixed path and writes the exact metadata snapshot", async () => {
  const previous = existsSync(RELEASE_GATE_REPORT_PATH)
    ? readFileSync(RELEASE_GATE_REPORT_PATH)
    : undefined;
  const report = createGateReport(
    ["integration"],
    [
      {
        id: "rust-integration",
        status: "passed",
        startedAt: "2026-09-14T00:00:00.000Z",
        finishedAt: "2026-09-14T00:00:00.100Z",
        durationMs: 100,
        exitCode: 0,
      },
    ],
    "2026-09-14T00:00:00.100Z"
  );

  try {
    await writeGateReport(report);
    assert.deepEqual(
      JSON.parse(await readFile(RELEASE_GATE_REPORT_PATH, "utf8")),
      report
    );
  } finally {
    if (previous === undefined) {
      await rm(RELEASE_GATE_REPORT_PATH, { force: true });
    } else {
      await writeFile(RELEASE_GATE_REPORT_PATH, previous);
    }
  }
});

test("the TypeScript gate includes the lightweight preview contract suite", () => {
  const plan = createGatePlan(parseGateArgs(["--typescript"]));
  const previewIndex = plan.findIndex((step) => step.id === "preview-contract");
  assert.ok(previewIndex >= 0);
  assert.deepEqual(plan[previewIndex], {
    id: "preview-contract",
    label: "preview contract tests",
    command: "node",
    args: [
      "--test",
      "tests/evidence-preview-benchmark.test.mjs",
      "tests/evidence-preview-parity.test.mjs",
    ],
    cwd: plan[0].cwd,
    shell: false,
    mode: "typescript",
  });
  assert.equal(plan[previewIndex - 1].id, "npm-release-publish-contract");
  assert.equal(plan[previewIndex - 2].id, "npm-release-preflight-contract");
  assert.equal(plan[previewIndex - 3].id, "package-smoke");
  assert.equal(plan[previewIndex - 4].id, "typescript-test");
  assert.equal(plan[previewIndex + 1].id, "gate-contract");
});

test("preview contract failures remain fail-fast and reportable", async () => {
  const plan = createGatePlan(parseGateArgs(["--typescript"]));
  const observed = [];
  const result = await runGatePlanWithReport(
    plan,
    async (step) => {
      observed.push(step.id);
      return step.id === "preview-contract" ? 17 : 0;
    },
    {
      generatedAt: "2026-09-14T00:00:00.000Z",
      now: (() => {
        let tick = 0;
        return () => (tick += 5);
      })(),
      logger: { log() {}, error() {} },
    }
  );

  assert.equal(result.exitCode, 17);
  assert.deepEqual(observed, [
    "structure",
    "build",
    "typecheck",
    "typescript-test",
    "package-smoke",
    "npm-release-preflight-contract",
    "npm-release-publish-contract",
    "preview-contract",
  ]);
  assert.equal(result.report.failedStepId, "preview-contract");
  assert.deepEqual(result.report.steps.map((step) => step.id), observed);
});

test("CI runs live Rust integration on a dedicated macOS job", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(
    packageJson.scripts["verify:integration"],
    "node scripts/release-gate.mjs --integration"
  );

  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8"
  );
  const jobMarker = "\n  macos-integration:\n";
  const jobStart = workflow.indexOf(jobMarker);
  assert.ok(jobStart >= 0, "CI should define a macOS integration job");
  const remainder = workflow.slice(jobStart + jobMarker.length);
  const nextJobOffset = remainder.search(/\n {2}\S/);
  const nextJob = nextJobOffset >= 0
    ? jobStart + jobMarker.length + nextJobOffset
    : -1;
  const job = workflow.slice(jobStart, nextJob >= 0 ? nextJob : undefined);

  assert.match(job, /name: macOS integration/);
  assert.match(job, /runs-on: macos-15/);
  assert.match(job, /pnpm verify:rust/);
  assert.match(job, /- name: Build debug Rust runtime\n\s+run: cargo build --bin dev-agent-executor\n\s+working-directory: runtime\/rust/);
  assert.match(job, /- name: Check Rust binary prerequisite\n\s+run: test -x runtime\/rust\/target\/debug\/dev-agent-executor/);
  assert.match(job, /- name: Check sandbox-exec prerequisite\n\s+run: test -x \/usr\/bin\/sandbox-exec/);
  assert.match(job, /- name: Check Python network fixture prerequisite\n\s+run: python3 -c "import socket"/);
  assert.match(job, /- name: Build executor package\n\s+run: pnpm --filter @dev-agent\/executor build/);
  assert.match(job, /pnpm verify:integration/);
  const rustGate = job.indexOf("pnpm verify:rust");
  const buildRuntime = job.indexOf("- name: Build debug Rust runtime");
  const rustPrerequisite = job.indexOf("- name: Check Rust binary prerequisite");
  const sandboxPrerequisite = job.indexOf("- name: Check sandbox-exec prerequisite");
  const pythonPrerequisite = job.indexOf("- name: Check Python network fixture prerequisite");
  const buildExecutor = job.indexOf("- name: Build executor package");
  const integrationGate = job.indexOf("pnpm verify:integration");
  assert.ok(
    rustGate < buildRuntime && buildRuntime < rustPrerequisite,
    "Rust gate should be followed by an explicit binary build before prerequisite checks"
  );
  assert.ok(
    rustPrerequisite < sandboxPrerequisite && sandboxPrerequisite < pythonPrerequisite,
    "prerequisite checks should expose independent failure boundaries in order"
  );
  assert.ok(
    pythonPrerequisite < buildExecutor && buildExecutor < integrationGate,
    "executor package build should prepare TypeScript artifacts before integration"
  );
});
test("CI runs live Rust integration on a dedicated Linux bwrap job", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8"
  );
  const jobMarker = "\n  linux-integration:\n";
  const jobStart = workflow.indexOf(jobMarker);
  assert.ok(jobStart >= 0, "CI should define a Linux integration job");
  const remainder = workflow.slice(jobStart + jobMarker.length);
  const nextJobOffset = remainder.search(/\n {2}\S/);
  const nextJob = nextJobOffset >= 0
    ? jobStart + jobMarker.length + nextJobOffset
    : -1;
  const job = workflow.slice(jobStart, nextJob >= 0 ? nextJob : undefined);

  assert.match(job, /name: Linux integration/);
  assert.match(job, /runs-on: ubuntu-latest/);
  assert.match(job, /env:\n(?:\s+#.*\n)*\s+DEV_AGENT_REQUIRE_LIVE_SANDBOX: "1"/);
  assert.match(job, /sudo apt-get install -y -qq bubblewrap protobuf-compiler/);
  assert.match(job, /- name: Configure hosted user namespace prerequisites/);
  assert.match(job, /kernel\.unprivileged_userns_clone/);
  assert.match(job, /kernel\.apparmor_restrict_unprivileged_userns/);
  assert.match(job, /pnpm verify:rust/);
  assert.match(job, /- name: Build debug Rust runtime\n\s+run: cargo build --bin dev-agent-executor\n\s+working-directory: runtime\/rust/);
  assert.match(job, /- name: Check Rust binary prerequisite\n\s+run: test -x runtime\/rust\/target\/debug\/dev-agent-executor/);
  assert.match(job, /- name: Check bwrap prerequisite\n\s+run: command -v bwrap && bwrap --version/);
  assert.match(job, /- name: Check bwrap user namespace prerequisite\n\s+run: \|[\s\S]*--unshare-user[\s\S]*--unshare-net/);
  assert.match(job, /- name: Check bwrap user namespace prerequisite[\s\S]*--uid[\s\S]*0[\s\S]*--gid[\s\S]*0/);
  assert.match(job, /- name: Check Python network fixture prerequisite\n\s+run: python3 -c "import socket"/);
  assert.match(job, /- name: Build executor package\n\s+run: pnpm --filter @dev-agent\/executor build/);
  assert.match(job, /pnpm verify:integration/);

  const rustGate = job.indexOf("pnpm verify:rust");
  const buildRuntime = job.indexOf("- name: Build debug Rust runtime");
  const rustPrerequisite = job.indexOf("- name: Check Rust binary prerequisite");
  const bwrapPrerequisite = job.indexOf("- name: Check bwrap prerequisite");
  const namespacePrerequisite = job.indexOf("- name: Check bwrap user namespace prerequisite");
  const pythonPrerequisite = job.indexOf("- name: Check Python network fixture prerequisite");
  const buildExecutor = job.indexOf("- name: Build executor package");
  const integrationGate = job.indexOf("pnpm verify:integration");
  assert.ok(
    rustGate < buildRuntime && buildRuntime < rustPrerequisite,
    "Rust gate should be followed by an explicit binary build before prerequisite checks"
  );
  assert.ok(
    rustPrerequisite < bwrapPrerequisite && bwrapPrerequisite < namespacePrerequisite,
    "bwrap binary and namespace checks should be independent and ordered"
  );
  assert.ok(
    namespacePrerequisite < pythonPrerequisite && pythonPrerequisite < buildExecutor &&
      buildExecutor < integrationGate,
    "all live prerequisites should pass before executor build and integration"
  );
});

test("the TypeScript gate includes the package install smoke test", () => {
  const plan = createGatePlan(parseGateArgs(["--typescript"]));
  const packageSmokeIndex = plan.findIndex((step) => step.id === "package-smoke");
  assert.ok(packageSmokeIndex >= 0);
  assert.deepEqual(plan[packageSmokeIndex], {
    id: "package-smoke",
    label: "CLI package install smoke test",
    command: "pnpm",
    args: ["package:smoke"],
    cwd: plan[0].cwd,
    shell: false,
    mode: "typescript",
  });
  assert.equal(plan[packageSmokeIndex - 1].id, "typescript-test");
});
