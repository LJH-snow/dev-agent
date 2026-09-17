import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPublishResult,
  parsePublishArgs,
  publishReleaseCandidate,
} from "../scripts/npm-release-publish.mjs";

const successfulPreflight = {
  command: "release preflight",
  ok: true,
  package: "@agent_cli/cli",
  candidateVersion: "0.1.5",
  publishedVersion: "0.1.4",
  auth: { status: "authenticated" },
  registry: { status: "matched", version: "0.1.4" },
  artifact: { status: "ready", fileCount: 5 },
  nextAction: "publish_candidate",
};


test("publish wrapper accepts the package-manager argument separator", () => {
  assert.deepEqual(parsePublishArgs(["--", "--publish"]), { publish: true });
});

test("publish wrapper never publishes without explicit confirmation", async () => {
  const commands = [];
  const result = await publishReleaseCandidate({
    preflight: async () => successfulPreflight,
    runCommand: async (operation) => {
      commands.push(operation);
      return { stdout: "0.1.4" };
    },
    publish: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.nextAction, "explicit_publish_confirmation");
  assert.deepEqual(commands, []);
});

test("publish wrapper stops before npm publish when preflight fails", async () => {
  const commands = [];
  const preflight = {
    ...successfulPreflight,
    ok: false,
    auth: { status: "missing" },
    errors: ["auth_required"],
    nextAction: "npm_login_required",
  };
  const result = await publishReleaseCandidate({
    preflight: async () => preflight,
    runCommand: async (operation) => {
      commands.push(operation);
      return { stdout: "0.1.4" };
    },
    publish: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.nextAction, "npm_login_required");
  assert.deepEqual(commands, []);
});

test("publish wrapper publishes only after a successful preflight and verifies the candidate", async () => {
  const commands = [];
  const result = await publishReleaseCandidate({
    preflight: async () => successfulPreflight,
    runCommand: async (operation) => {
      commands.push(operation);
      if (operation === "publish") return { stdout: "published" };
      return { stdout: "0.1.5" };
    },
    publish: true,
  });

  assert.deepEqual(result, {
    command: "release publish",
    ok: true,
    package: "@agent_cli/cli",
    candidateVersion: "0.1.5",
    status: "published",
    nextAction: "verify_install",
  });
  assert.deepEqual(commands, ["publish", "view"]);
});

test("publish wrapper hides npm errors behind stable metadata", async () => {
  const result = await publishReleaseCandidate({
    preflight: async () => successfulPreflight,
    runCommand: async (operation) => {
      if (operation === "publish") {
        throw new Error("E401 /Users/Admin/.npm/_logs/private.log");
      }
      return { stdout: "0.1.4" };
    },
    publish: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "publish_failed");
  assert.doesNotMatch(JSON.stringify(result), /E401|private\.log|\/Users\//);
});

test("formatted publish output is metadata-only", () => {
  const output = formatPublishResult({
    command: "release publish",
    ok: false,
    package: "@agent_cli/cli",
    candidateVersion: "0.1.5",
    reason: "publish_failed",
    nextAction: "review_publish_error",
  });

  assert.match(output, /publish_failed/);
  assert.doesNotMatch(output, /token|secret|\/Users\//i);
});
