import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPreflightResult,
  inspectPackedFiles,
  runReleasePreflight,
  validateReleaseCandidateMetadata,
} from "../scripts/npm-release-preflight.mjs";

const packageJson = {
  name: "@agent_cli/cli",
  version: "0.1.5",
  private: false,
  files: ["dist/cli.js", "dist/cli.js.map", "LICENSE"],
};

const releaseState = {
  package: "@agent_cli/cli",
  publishedVersion: "0.1.4",
  candidateVersion: "0.1.5",
  status: "candidate",
};

const packedFiles = [
  "dist/cli.js",
  "dist/cli.js.map",
  "LICENSE",
  "package.json",
  "README.md",
];

test("release candidate metadata accepts the current package and state", () => {
  const result = validateReleaseCandidateMetadata(packageJson, releaseState);

  assert.deepEqual(result, { ok: true });
});

test("release candidate metadata rejects mismatches and non-public packages", () => {
  const result = validateReleaseCandidateMetadata(
    { ...packageJson, name: "@agent-cli/cli", private: true, version: "0.1.4" },
    { ...releaseState, package: "@agent-cli/cli" },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "package_name_mismatch",
    "package_is_private",
    "candidate_version_mismatch",
    "candidate_not_newer",
  ]);
});

test("packed artifact inspection allows only the published CLI surface", () => {
  assert.deepEqual(inspectPackedFiles(packedFiles), {
    ok: true,
    fileCount: 5,
  });

  const unsafe = inspectPackedFiles([
    ...packedFiles,
    "tests/secret.test.js",
    "/Users/Admin/Desktop/dev-agent/apps/cli/dist/index.js",
  ]);
  assert.equal(unsafe.ok, false);
  assert.deepEqual(unsafe.errors, ["unexpected_files"]);
});

test("preflight maps npm auth failures to stable metadata without raw errors", async () => {
  const result = await runReleasePreflight({
    packageJson,
    releaseState,
    runCommand: async (command) => {
      if (command === "whoami") {
        throw new Error("401 Unauthorized /Users/Admin/.npm/_logs/private.log");
      }
      return { stdout: "0.1.4" };
    },
    readPackedFiles: async () => packedFiles,
  });

  assert.equal(result.ok, false);
  assert.equal(result.auth.status, "missing");
  assert.equal(result.registry.status, "matched");
  assert.equal(result.artifact.status, "ready");
  assert.doesNotMatch(JSON.stringify(result), /401|Unauthorized|private\.log|\/Users\//);
});

test("preflight succeeds when candidate, registry, auth, and artifact agree", async () => {
  const result = await runReleasePreflight({
    packageJson,
    releaseState,
    runCommand: async (command) =>
      command === "whoami" ? { stdout: "libai168" } : { stdout: "0.1.4" },
    readPackedFiles: async () => packedFiles,
  });

  assert.deepEqual(result, {
    command: "release preflight",
    ok: true,
    package: "@agent_cli/cli",
    candidateVersion: "0.1.5",
    publishedVersion: "0.1.4",
    auth: { status: "authenticated" },
    registry: { status: "matched", version: "0.1.4" },
    artifact: { status: "ready", fileCount: 5 },
    nextAction: "publish_candidate",
  });
});

test("formatted preflight output is stable and metadata-only", () => {
  const output = formatPreflightResult({
    command: "release preflight",
    ok: false,
    package: "@agent_cli/cli",
    candidateVersion: "0.1.5",
    publishedVersion: "0.1.4",
    auth: { status: "missing" },
    registry: { status: "matched", version: "0.1.4" },
    artifact: { status: "ready", fileCount: 5 },
    nextAction: "npm_login_required",
  });

  assert.match(output, /release preflight/);
  assert.match(output, /npm_login_required/);
  assert.doesNotMatch(output, /\/Users\/|token|secret|401|Unauthorized/i);
});
