import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts", "verify-release-version.mjs");

function runVersion(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("derives the release version only from an explicit v* tag", () => {
  const result = runVersion("--tag", "v0.2.0");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "0.2.0");
});

test("accepts an explicit version only when it matches the tag", () => {
  const result = runVersion("--tag", "v0.2.0", "--version", "0.2.0");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "0.2.0");
});

test("rejects a version that does not match the tag", () => {
  const result = runVersion("--tag", "v0.2.0", "--version", "9.9.9");

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /version.*match|mismatch|tag/i);
});

test("rejects a branch name or missing tag as a release version source", () => {
  const invalidTag = runVersion("--tag", "main");
  assert.notEqual(invalidTag.status, 0);
  assert.match(`${invalidTag.stdout}\n${invalidTag.stderr}`, /tag|semver|release/i);

  const missingTag = runVersion();
  assert.notEqual(missingTag.status, 0);
  assert.match(`${missingTag.stdout}\n${missingTag.stderr}`, /tag|required|release/i);
});

test("does not read package metadata or remote sources for version resolution", () => {
  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(source, /package\.json|\bfetch\s*\(|node:(?:http|https)|https?:\/\//i);
});
