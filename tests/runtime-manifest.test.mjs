import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const manifestScript = join(repoRoot, "scripts", "build-runtime-manifest.mjs");
const manifestName = "dev-agent-runtime-manifest.json";

const targets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
];

const platformByTarget = {
  "aarch64-apple-darwin": { os: "darwin", arch: "arm64", libc: "none" },
  "x86_64-apple-darwin": { os: "darwin", arch: "x64", libc: "none" },
  "aarch64-unknown-linux-gnu": { os: "linux", arch: "arm64", libc: "glibc" },
  "x86_64-unknown-linux-gnu": { os: "linux", arch: "x64", libc: "glibc" },
};

function runManifest(inputDir, outputPath, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      manifestScript,
      "--input-dir",
      inputDir,
      "--output",
      outputPath,
      "--tag",
      "v0.2.0",
      "--repository",
      "LJH-snow/dev-agent",
      ...extraArgs,
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
}

function archiveName(target) {
  return `dev-agent-executor-${target}.tar.gz`;
}

function createRuntimeArchive(inputDir, target, { extraEntries = [] } = {}) {
  const stageDir = mkdtempSync(join(tmpdir(), "runtime-manifest-stage-"));
  const assetDir = join(stageDir, `dev-agent-executor-${target}`);
  mkdirSync(assetDir, { recursive: true });
  const binaryPath = join(assetDir, "dev-agent-executor");
  writeFileSync(binaryPath, `fixture binary for ${target}\n`);
  chmodSync(binaryPath, 0o755);
  writeFileSync(join(assetDir, "README.md"), `fixture README for ${target}\n`);
  for (const entry of extraEntries) {
    const entryPath = join(stageDir, entry);
    mkdirSync(join(entryPath, ".."), { recursive: true });
    writeFileSync(entryPath, "unexpected fixture\n");
  }

  const archivePath = join(inputDir, archiveName(target));
  execFileSync("tar", ["-C", stageDir, "-czf", archivePath, `dev-agent-executor-${target}`]);
  const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  writeFileSync(join(inputDir, `${archiveName(target)}.sha256`), `${sha256}  ${archiveName(target)}\n`);
  return archivePath;
}

function seedRuntimeInputs({ missing = [], extraEntriesByTarget = {} } = {}) {
  const inputDir = mkdtempSync(join(tmpdir(), "runtime-manifest-input-"));
  for (const target of targets) {
    if (!missing.includes(target)) {
      createRuntimeArchive(inputDir, target, {
        extraEntries: extraEntriesByTarget[target] ?? [],
      });
    }
  }
  return inputDir;
}

function expectedArtifact(target) {
  return {
    target,
    ...platformByTarget[target],
    archive: archiveName(target),
    binary: `dev-agent-executor-${target}/dev-agent-executor`,
  };
}

test("builds a stable v0.2.0 manifest from all four verified runtime archives", () => {
  const inputDir = seedRuntimeInputs();
  const outputPath = join(inputDir, manifestName);
  const result = runManifest(inputDir, outputPath);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const firstBytes = readFileSync(outputPath, "utf8");
  const manifest = JSON.parse(firstBytes);

  assert.deepEqual(Object.keys(manifest), [
    "schemaVersion",
    "product",
    "runtime",
    "releaseVersion",
    "releaseTag",
    "repository",
    "protocolVersion",
    "artifacts",
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.product, "dev-agent");
  assert.equal(manifest.runtime, "dev-agent-executor");
  assert.equal(manifest.releaseVersion, "0.2.0");
  assert.equal(manifest.releaseTag, "v0.2.0");
  assert.equal(manifest.repository, "LJH-snow/dev-agent");
  assert.equal(manifest.protocolVersion, 1);
  assert.deepEqual(
    manifest.artifacts.map(({ target, os, arch, libc, archive, binary }) => ({
      target,
      os,
      arch,
      libc,
      archive,
      binary,
    })),
    targets.map(expectedArtifact)
  );
  for (const artifact of manifest.artifacts) {
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof artifact.size, "number");
    assert.ok(artifact.size > 0);
  }

  assert.equal(result.stderr, "");
  const secondResult = runManifest(inputDir, outputPath);
  assert.equal(secondResult.status, 0, secondResult.stderr || secondResult.stdout);
  assert.equal(readFileSync(outputPath, "utf8"), firstBytes);
  assert.match(firstBytes, /\n$/);
});

test("rejects a missing target instead of emitting a partial manifest", () => {
  const inputDir = seedRuntimeInputs({ missing: ["x86_64-apple-darwin"] });
  const outputPath = join(inputDir, manifestName);
  const result = runManifest(inputDir, outputPath);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /missing.*x86_64-apple-darwin/i);
});

test("rejects an extra runtime target", () => {
  const inputDir = seedRuntimeInputs();
  createRuntimeArchive(inputDir, "riscv64-unknown-linux-gnu");
  const outputPath = join(inputDir, manifestName);
  const result = runManifest(inputDir, outputPath);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /unexpected.*target|extra.*target/i);
});

test("rejects duplicate target inputs discovered under the input directory", () => {
  const inputDir = seedRuntimeInputs();
  const duplicateDir = join(inputDir, "duplicate");
  mkdirSync(duplicateDir);
  createRuntimeArchive(duplicateDir, "aarch64-apple-darwin");
  const outputPath = join(inputDir, manifestName);
  const result = runManifest(inputDir, outputPath);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /duplicate.*aarch64-apple-darwin/i);
});

test("rejects archive entries outside the runtime allowlist", () => {
  const inputDir = seedRuntimeInputs({
    extraEntriesByTarget: {
      "aarch64-apple-darwin": [
        "dev-agent-executor-aarch64-apple-darwin/extra.txt",
      ],
    },
  });
  const outputPath = join(inputDir, manifestName);
  const result = runManifest(inputDir, outputPath);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /allowlist|unexpected archive entry|archive contents/i);
});

test("recomputes the archive digest and rejects a stale sidecar", () => {
  const inputDir = seedRuntimeInputs();
  const checksumPath = join(inputDir, `${archiveName(targets[0])}.sha256`);
  writeFileSync(checksumPath, `${"0".repeat(64)}  ${archiveName(targets[0])}\n`);
  const outputPath = join(inputDir, manifestName);
  const result = runManifest(inputDir, outputPath);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /sha256|checksum|digest/i);
});

test("does not introduce a network dependency for release metadata", () => {
  const source = readFileSync(manifestScript, "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|node:(?:http|https)|https?:\/\//i);
});
