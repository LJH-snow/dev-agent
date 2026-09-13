import assert from "node:assert/strict";
import test from "node:test";

import {
  createChangeSetFileReview,
  createChangeSetReview,
  deriveValidationPlan,
} from "../dist/index.js";

function review(
  changeSetId: string,
  files: readonly { path: string; before?: string; after?: string; diff?: string }[]
) {
  return createChangeSetReview(
    files.map((file) => {
      const generated = createChangeSetFileReview({
        path: file.path,
        before: file.before,
        after: file.after,
      });
      return file.diff === undefined ? generated : { ...generated, diff: file.diff };
    }),
    { changeSetId, createdAt: "2026-09-13T00:00:00.000Z" }
  );
}

const context = { workingDirectory: "/workspace/project" };

test("a package source change produces stable, package-scoped typecheck and test checks", () => {
  const input = review("cs-tools", [{ path: "packages/tools/src/filesystem.ts", before: "a", after: "b" }]);
  const first = deriveValidationPlan(input, context);
  const second = deriveValidationPlan(input, context);

  assert.equal(first.status, "ready");
  assert.equal(first.validationId, second.validationId);
  assert.deepEqual(first.checks.map((check) => check.id), [
    "package:@dev-agent/tools:typecheck",
    "package:@dev-agent/tools:test",
  ]);
  assert.deepEqual(first.checks[0]?.command, {
    executable: "pnpm",
    args: ["--filter", "@dev-agent/tools", "typecheck"],
    cwd: "/workspace/project",
    timeoutMs: 120_000,
  });
});

test("cross-package changes are sorted by package name and deduplicated", () => {
  const input = review("cs-cross", [
    { path: "packages/tools/src/filesystem.ts", before: "a", after: "b" },
    { path: "apps/desktop/src/server.ts", before: "a", after: "b" },
    { path: "packages/tools/tests/change-set.test.ts", before: "a", after: "b" },
  ]);
  const plan = deriveValidationPlan(input, context);

  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.checks.map((check) => check.id), [
    "package:@dev-agent/desktop:typecheck",
    "package:@dev-agent/desktop:test",
    "package:@dev-agent/tools:typecheck",
    "package:@dev-agent/tools:test",
  ]);
});

test("test-only changes run only the affected package test", () => {
  const plan = deriveValidationPlan(
    review("cs-test", [{ path: "packages/tools/tests/change-set.test.ts", before: "a", after: "b" }]),
    context
  );

  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.checks.map((check) => check.id), ["package:@dev-agent/tools:test"]);
});

test("Rust runtime changes select format, lint, and test checks in runtime cwd", () => {
  const plan = deriveValidationPlan(
    review("cs-rust", [{ path: "runtime/rust/src/lib.rs", before: "a", after: "b" }]),
    context
  );

  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.checks.map((check) => check.id), [
    "rust:fmt",
    "rust:clippy",
    "rust:test",
  ]);
  assert.equal(plan.checks[0]?.command.cwd, "/workspace/project/runtime/rust");
  assert.deepEqual(plan.checks[1]?.command.args, ["clippy", "--all-targets", "--", "-D", "warnings"]);
});

test("docs and config changes use the bounded workspace diff check", () => {
  const plan = deriveValidationPlan(
    review("cs-docs", [{ path: "docs/guide.md", before: "a\n", after: "b\n" }]),
    context
  );

  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.checks.map((check) => check.id), ["workspace:diff-check"]);
  assert.deepEqual(plan.checks[0]?.command.args, ["diff", "--check", "--", "docs/guide.md"]);
});

test("no-op reviews and unknown-only files are explicitly skipped", () => {
  const noOp = deriveValidationPlan(
    review("cs-noop", [{ path: "docs/guide.md", before: "same\n", after: "same\n" }]),
    context
  );
  const unknown = deriveValidationPlan(
    review("cs-unknown", [{ path: "assets/logo.bin", before: "a", after: "b" }]),
    context
  );

  assert.equal(noOp.status, "skipped");
  assert.equal(noOp.checks.length, 0);
  assert.match(noOp.reason ?? "", /no changed files/i);
  assert.equal(unknown.status, "skipped");
  assert.equal(unknown.checks.length, 0);
  assert.match(unknown.reason ?? "", /no safe validation/i);
});

test("duplicate or escaping paths are blocked before a command is planned", () => {
  const duplicate = deriveValidationPlan(
    review("cs-duplicate", [
      { path: "packages/tools/src/filesystem.ts", before: "a", after: "b" },
      { path: "packages/tools/src/filesystem.ts", before: "b", after: "c" },
    ]),
    context
  );
  const escaping = deriveValidationPlan(
    review("cs-escaping", [{ path: "../../tmp/evil.ts", before: "a", after: "b" }]),
    context
  );

  assert.equal(duplicate.status, "blocked");
  assert.equal(duplicate.checks.length, 0);
  assert.match(duplicate.reason ?? "", /duplicate path/i);
  assert.equal(escaping.status, "blocked");
  assert.equal(escaping.checks.length, 0);
  assert.match(escaping.reason ?? "", /outside|relative/i);
});

test("planner never copies diff text into a shell command", () => {
  const plan = deriveValidationPlan(
    review("cs-untrusted", [
      {
        path: "packages/tools/src/filesystem.ts",
        before: "a",
        after: "b",
        diff: "+pnpm rm -rf /; echo injected",
      },
    ]),
    context
  );

  assert.equal(plan.status, "ready");
  for (const check of plan.checks) {
    assert.equal("shell" in check.command, false);
    assert.equal(check.command.args.join(" ").includes("injected"), false);
    assert.equal(check.command.args.join(" ").includes("rm -rf"), false);
  }
});

test("an explicit validation id is preserved for a trusted rerun", () => {
  const input = review("cs-rerun", [
    { path: "packages/tools/src/filesystem.ts", before: "a", after: "b" },
  ]);
  const plan = deriveValidationPlan(input, {
    ...context,
    validationId: "validation:cs-rerun:attempt-1",
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.validationId, "validation:cs-rerun:attempt-1");
  assert.equal(plan.changeSetId, "cs-rerun");
});
