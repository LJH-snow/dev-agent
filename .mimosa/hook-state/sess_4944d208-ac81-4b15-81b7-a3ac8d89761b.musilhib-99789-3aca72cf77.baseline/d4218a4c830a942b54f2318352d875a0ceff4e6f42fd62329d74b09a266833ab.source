import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopStatus } from "../dist/status.js";
import { resolveDesktopManagedRuntimeStatus } from "../dist/managed-runtime.js";

test("desktop status exposes only allowlisted runtime metadata", () => {
  const status = createDesktopStatus({
    sessionId: "Work Session/../demo",
    running: true,
    executorMode: "sandboxed-macos",
    providerId: "openai",
    model: "gpt-4o-mini",
    approvalMode: "review-writes",
    validationPolicy: "strict",
    validationResult: "passed",
    managedRuntime: {
      state: "installed",
      version: "0.2.0",
      target: "aarch64-apple-darwin",
    },
    nodeVersion: "v22.14.0",
    platform: "darwin",
  });

  assert.deepEqual(status, {
    schemaVersion: 1,
    metadataOnly: true,
    session: { id: "work-session-demo", running: true },
    executor: { mode: "sandboxed-macos" },
    runtime: { kind: "node", version: "v22.14.0", platform: "darwin" },
    provider: { id: "openai", state: "ready" },
    model: { id: "gpt-4o-mini", state: "ready" },
    approval: { mode: "review-writes", guarded: true },
    validation: { policy: "strict", enabled: true, lastResult: "passed" },
    managedRuntime: {
      state: "installed",
      version: "0.2.0",
      target: "aarch64-apple-darwin",
    },
  });

  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /secret|Users|home|tmp|source|api[-_ ]?key/i);
});

test("desktop workspace label stays metadata-only", () => {
  const labeled = createDesktopStatus({ workspaceLabel: "dev-agent" });
  const path = createDesktopStatus({ workspaceLabel: "/Users/Admin/Desktop/dev-agent" });
  const unsafe = createDesktopStatus({ workspaceLabel: ".." });

  assert.deepEqual(labeled.workspace, { label: "dev-agent" });
  assert.equal(path.workspace, undefined);
  assert.equal(unsafe.workspace, undefined);
  const serialized = JSON.stringify(labeled);
  assert.doesNotMatch(serialized, /Users|home|tmp/i);
});

test("desktop MCP summary is metadata-only and bounded", () => {
  const ready = createDesktopStatus({ mcpConfigured: 2, mcpConnected: 2 });
  const idle = createDesktopStatus({ mcpConfigured: 2, mcpConnected: 0 });
  const none = createDesktopStatus();
  const invalid = createDesktopStatus({ mcpConfigured: 1, mcpConnected: 2 });

  assert.deepEqual(ready.mcp, { configured: 2, connected: 2 });
  assert.deepEqual(idle.mcp, { configured: 2, connected: 0 });
  assert.equal(none.mcp, undefined);
  assert.equal(invalid.mcp, undefined);
  const serialized = JSON.stringify(ready);
  assert.doesNotMatch(serialized, /command|args|env|Users|home|tmp/i);
});

test("desktop status redacts path-like and secret-like model labels", () => {
  const pathStatus = createDesktopStatus({
    providerId: "ollama",
    model: "/Users/Admin/.secrets/model-key",
  });
  const secretStatus = createDesktopStatus({
    providerId: "openai",
    model: "sk-test-secret",
  });
  const unknownStatus = createDesktopStatus({
    executorMode: "unsupported",
    approvalMode: "allow",
    validationPolicy: "fast",
    nodeVersion: "not-a-node-version",
    platform: "not-a-platform",
  });

  assert.deepEqual(pathStatus.model, { id: "redacted", state: "unknown" });
  assert.deepEqual(secretStatus.model, { id: "redacted", state: "unknown" });
  assert.deepEqual(unknownStatus.runtime, {
    kind: "node",
    version: "unknown",
    platform: "unknown",
  });
  assert.deepEqual(unknownStatus.managedRuntime, {
    state: "unavailable",
    reason: "runtime_status_unavailable",
  });
  assert.equal(unknownStatus.provider.id, "unknown");
  assert.equal(unknownStatus.validation.policy, "fast");
  assert.equal(unknownStatus.validation.lastResult, "unknown");
});

test("desktop managed runtime status stays metadata-only", async () => {
  const status = await resolveDesktopManagedRuntimeStatus({
    version: "0.2.0",
    runtimeDir: "/definitely/missing/runtime-dir",
    target: "aarch64-apple-darwin",
  });
  assert.equal(status.state, "missing");
  assert.equal(status.target, "aarch64-apple-darwin");
  assert.ok(!("version" in status));
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /api[-_ ]?key|token|secret|Users|home|tmp/i);
});

test("desktop managed runtime turns runtime errors into stable codes", async () => {
  const status = await resolveDesktopManagedRuntimeStatus({
    version: "../not-a-version",
    runtimeDir: "/definitely/missing/runtime-dir",
  });
  assert.deepEqual(status, { state: "unavailable", reason: "INVALID_VERSION" });
});

test("desktop status sanitizes injected managed runtime data", () => {
  const status = createDesktopStatus({
    managedRuntime: {
      state: "corrupt",
      version: "/Users/Admin/runtime/0.2.0",
      target: "/tmp/runtime" as unknown as "aarch64-apple-darwin",
      reason: "provider exploded at /Users/Admin/runtime/0.2.0",
    } as never,
  });

  assert.deepEqual(status.managedRuntime, { state: "corrupt" });
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /Users|tmp|provider exploded/i);
});
