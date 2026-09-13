import assert from "node:assert/strict";
import test from "node:test";

import {
  createGatePlan,
  parseGateArgs,
  runGatePlan,
} from "../scripts/release-gate.mjs";

test("the default gate uses the fixed TypeScript, Rust, and integration order", () => {
  const selection = parseGateArgs([]);
  const plan = createGatePlan(selection);

  assert.deepEqual(selection.modes, ["typescript", "rust", "integration"]);
  assert.deepEqual(plan.map((step) => step.id), [
    "structure",
    "build",
    "typecheck",
    "typescript-test",
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
      ["cargo", "fmt", "--check"],
      ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"],
      ["cargo", "test"],
      ["pnpm", "--filter", "@dev-agent/executor", "test:integration"],
    ]
  );
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
});

test("gate plans use fixed working directories and never enable a shell", () => {
  const plan = createGatePlan(parseGateArgs([]));
  const repositoryRoot = plan[0].cwd;
  const rustRoot = plan.find((step) => step.id === "rust-test")?.cwd;

  assert.ok(repositoryRoot?.endsWith("/dev-agent"));
  assert.ok(rustRoot?.endsWith("/dev-agent/runtime/rust"));
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
  const exitCode = await runGatePlan(plan, async (step) => {
    observed.push(step.id);
    return step.id === "build" ? 23 : 0;
  });

  assert.equal(exitCode, 23);
  assert.deepEqual(observed, ["structure", "build"]);
});
