import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import { FilesystemTool } from "@dev-agent/tools";
import {
  applyPlan,
  createPlan,
  formatPlanResult,
  loadPlan,
  type PlanClock,
  type PlanDocument,
} from "../dist/plan-command.js";

const fixedNow = (value: string): PlanClock => () => new Date(value);

async function withWorkspace(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-plan-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function changeFor(path: string, content: string) {
  return { action: "write" as const, path, content };
}

test("createPlan creates a stable sanitized plan without changing the workspace", async () => {
  await withWorkspace(async (workingDirectory) => {
    const filesystem = new FilesystemTool();
    const secret = "do-not-persist-this-secret";
    const result = await createPlan({
      filesystem,
      sessionId: "plan-session",
      workingDirectory,
      changes: [changeFor("result.txt", secret)],
      clock: fixedNow("2026-09-16T08:00:00.000Z"),
      ttlMs: 60_000,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.command, "plan");
    assert.equal(result.plan.schemaVersion, 1);
    assert.equal(result.plan.executeInput.action, "apply");
    assert.equal(result.plan.executeInput.changeSetId, result.plan.changeSetId);
    assert.equal(result.plan.review.files[0]?.path, "result.txt");
    assert.equal("diff" in (result.plan.review.files[0] ?? {}), false);
    assert.equal(result.plan.review.files[0]?.afterHash !== undefined, true);
    assert.equal(result.plan.workspaceId.length, 64);
    assert.equal(isAbsolute(result.plan.review.files[0]?.path ?? ""), false);
    assert.equal(await readFile(join(workingDirectory, "result.txt"), "utf8").catch(() => "missing"), "missing");

    const serialized = JSON.stringify(result.plan);
    assert.doesNotMatch(serialized, /do-not-persist-this-secret/);
    assert.doesNotMatch(serialized, /\/private\/|\/Users\/|\/tmp\//);
    assert.equal(loadPlan(serialized).ok, true);
  });
});

test("applyPlan uses the prepared change set and returns metadata only", async () => {
  await withWorkspace(async (workingDirectory) => {
    const filesystem = new FilesystemTool();
    const planned = await createPlan({
      filesystem,
      sessionId: "apply-session",
      workingDirectory,
      changes: [changeFor("result.txt", "secret-content")],
      clock: fixedNow("2026-09-16T08:00:00.000Z"),
      ttlMs: 60_000,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;

    const applied = await applyPlan({
      filesystem,
      plan: planned.plan,
      sessionId: "apply-session",
      workingDirectory,
      clock: fixedNow("2026-09-16T08:00:10.000Z"),
    });

    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.command, "apply");
    assert.equal(applied.planId, planned.plan.planId);
    assert.deepEqual(applied.files, [
      { path: "result.txt", kind: "file", beforeExists: false, afterExists: true },
    ]);
    assert.equal("diff" in applied, false);
    assert.equal("content" in applied, false);
    assert.equal("hash" in applied, false);
    assert.equal(JSON.stringify(applied).includes("secret-content"), false);
    assert.equal(await readFile(join(workingDirectory, "result.txt"), "utf8"), "secret-content");

    const repeated = await applyPlan({
      filesystem,
      plan: planned.plan,
      sessionId: "apply-session",
      workingDirectory,
      clock: fixedNow("2026-09-16T08:00:11.000Z"),
    });
    assert.equal(repeated.ok, false);
    if (!repeated.ok) assert.equal(repeated.error.code, "already_applied");
  });
});

test("applyPlan rejects expired and mismatched plans with stable errors", async () => {
  await withWorkspace(async (workingDirectory) => {
    const filesystem = new FilesystemTool();
    const planned = await createPlan({
      filesystem,
      sessionId: "bound-session",
      workingDirectory,
      changes: [changeFor("result.txt", "value")],
      clock: fixedNow("2026-09-16T08:00:00.000Z"),
      ttlMs: 1_000,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;

    const expired = await applyPlan({
      filesystem,
      plan: planned.plan,
      sessionId: "bound-session",
      workingDirectory,
      clock: fixedNow("2026-09-16T08:00:01.001Z"),
    });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.deepEqual(expired.error, {
      code: "expired",
      message: "The plan has expired.",
    });

    const sessionMismatch = await applyPlan({
      filesystem,
      plan: planned.plan,
      sessionId: "other-session",
      workingDirectory,
      clock: fixedNow("2026-09-16T08:00:00.500Z"),
    });
    assert.equal(sessionMismatch.ok, false);
    if (!sessionMismatch.ok) assert.equal(sessionMismatch.error.code, "session_mismatch");

    const directoryMismatch = await mkdtemp(join(tmpdir(), "dev-agent-plan-other-"));
    try {
      const mismatch = await applyPlan({
        filesystem,
        plan: planned.plan,
        sessionId: "bound-session",
        workingDirectory: directoryMismatch,
        clock: fixedNow("2026-09-16T08:00:00.500Z"),
      });
      assert.equal(mismatch.ok, false);
      if (!mismatch.ok) assert.equal(mismatch.error.code, "working_directory_mismatch");
    } finally {
      await rm(directoryMismatch, { recursive: true, force: true });
    }
  });
});

test("applyPlan preserves filesystem preimage guards and reports path conflicts", async () => {
  await withWorkspace(async (workingDirectory) => {
    const filesystem = new FilesystemTool();
    const planned = await createPlan({
      filesystem,
      sessionId: "guard-session",
      workingDirectory,
      changes: [changeFor("result.txt", "planned")],
      clock: fixedNow("2026-09-16T08:00:00.000Z"),
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    await writeFile(join(workingDirectory, "result.txt"), "changed-after-plan", "utf8");

    const conflict = await applyPlan({
      filesystem,
      plan: planned.plan,
      sessionId: "guard-session",
      workingDirectory,
      clock: fixedNow("2026-09-16T08:00:00.500Z"),
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.error.code, "path_conflict");
    assert.equal(await readFile(join(workingDirectory, "result.txt"), "utf8"), "changed-after-plan");
  });
});

test("loadPlan returns stable errors for invalid JSON and tampered plans", () => {
  const invalidJson = loadPlan("{not-json");
  assert.equal(invalidJson.ok, false);
  if (!invalidJson.ok) assert.deepEqual(invalidJson.error, {
    code: "invalid_json",
    message: "The plan document is not valid JSON.",
  });

  const invalidShape = loadPlan(JSON.stringify({ schemaVersion: 1, kind: "wrong" }));
  assert.equal(invalidShape.ok, false);
  if (!invalidShape.ok) assert.equal(invalidShape.error.code, "invalid_plan");
});

test("formatPlanResult emits stable metadata without sensitive content or absolute paths", async () => {
  await withWorkspace(async (workingDirectory) => {
    const result = await createPlan({
      filesystem: new FilesystemTool(),
      sessionId: "format-session",
      workingDirectory,
      changes: [changeFor("result.txt", "secret-format-content")],
      clock: fixedNow("2026-09-16T08:00:00.000Z"),
    });
    const formatted = formatPlanResult(result);
    assert.doesNotMatch(formatted, /secret-format-content/);
    assert.doesNotMatch(formatted, new RegExp(workingDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(JSON.parse(formatted).command, "plan");
  });
});

void (undefined as unknown as PlanDocument);

test("applyPlan can rehydrate a plan in a fresh filesystem tool when the original changes are supplied", async () => {
  await withWorkspace(async (workingDirectory) => {
    const changes = [changeFor("fresh-process.txt", "fresh-process-content")];
    const planned = await createPlan({
      filesystem: new FilesystemTool(),
      sessionId: "fresh-session",
      workingDirectory,
      changes,
      clock: fixedNow("2026-09-16T08:00:00.000Z"),
      ttlMs: 60_000,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok) return;

    const applied = await applyPlan({
      filesystem: new FilesystemTool(),
      plan: planned.plan,
      changes,
      sessionId: "fresh-session",
      workingDirectory,
      clock: fixedNow("2026-09-16T08:00:10.000Z"),
    });

    assert.equal(applied.ok, true);
    assert.equal(await readFile(join(workingDirectory, "fresh-process.txt"), "utf8"), "fresh-process-content");
  });
});
