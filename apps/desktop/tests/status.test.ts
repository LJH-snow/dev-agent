import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopStatus } from "../dist/status.js";

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
  });

  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /secret|Users|home|tmp|source|api[-_ ]?key/i);
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
  assert.equal(unknownStatus.provider.id, "unknown");
  assert.equal(unknownStatus.validation.policy, "fast");
  assert.equal(unknownStatus.validation.lastResult, "unknown");
});
