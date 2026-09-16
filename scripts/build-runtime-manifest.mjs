import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveReleaseVersion } from "./verify-release-version.mjs";

export const MANIFEST_FILENAME = "dev-agent-runtime-manifest.json";
export const EXPECTED_TARGETS = Object.freeze([
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
]);

const TARGET_METADATA = Object.freeze({
  "aarch64-apple-darwin": Object.freeze({ os: "darwin", arch: "arm64", libc: "none" }),
  "x86_64-apple-darwin": Object.freeze({ os: "darwin", arch: "x64", libc: "none" }),
  "aarch64-unknown-linux-gnu": Object.freeze({ os: "linux", arch: "arm64", libc: "glibc" }),
  "x86_64-unknown-linux-gnu": Object.freeze({ os: "linux", arch: "x64", libc: "glibc" }),
});

const ARCHIVE_PATTERN = /^dev-agent-executor-(.+)\.tar\.gz$/;
const SIDECAR_PATTERN = /^dev-agent-executor-(.+)\.tar\.gz\.sha256$/;
const RUNTIME_FILE_PREFIX = "dev-agent-executor-";

function fail(message) {
  throw new Error(message);
}

function walkFiles(directory) {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  );

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function collectRuntimeInputs(inputDir) {
  const candidates = new Map();
  for (const filePath of walkFiles(inputDir)) {
    const fileName = basename(filePath);
    const archiveMatch = fileName.match(ARCHIVE_PATTERN);
    const sidecarMatch = fileName.match(SIDECAR_PATTERN);
    if (!archiveMatch && !sidecarMatch) {
      if (fileName.startsWith(RUNTIME_FILE_PREFIX)) {
        fail(`unexpected runtime artifact: ${relative(inputDir, filePath)}`);
      }
      continue;
    }

    const kind = archiveMatch ? "archive" : "sidecar";
    const target = (archiveMatch ?? sidecarMatch)[1];
    if (!Object.hasOwn(TARGET_METADATA, target)) {
      fail(`unexpected runtime target: ${target}`);
    }
    const entry = candidates.get(target) ?? {};
    if (entry[kind]) {
      fail(`duplicate ${kind} for target ${target}`);
    }
    entry[kind] = filePath;
    candidates.set(target, entry);
  }

  for (const target of EXPECTED_TARGETS) {
    const entry = candidates.get(target);
    if (!entry?.archive) {
      fail(`missing archive for target ${target}`);
    }
    if (!entry.sidecar) {
      fail(`missing checksum sidecar for target ${target}`);
    }
  }
  if (candidates.size !== EXPECTED_TARGETS.length) {
    const unexpected = [...candidates.keys()].filter((target) => !EXPECTED_TARGETS.includes(target));
    fail(`unexpected runtime target(s): ${unexpected.join(", ")}`);
  }

  return candidates;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function verifySidecar(sidecarPath, archivePath, archiveDigest) {
  const sidecarText = readFileSync(sidecarPath, "utf8").replace(/\r\n/g, "\n");
  const lines = sidecarText.endsWith("\n") ? sidecarText.slice(0, -1).split("\n") : sidecarText.split("\n");
  if (lines.length !== 1) {
    fail(`checksum sidecar must contain exactly one line: ${basename(sidecarPath)}`);
  }

  const expectedArchiveName = basename(archivePath);
  const match = lines[0].match(/^([0-9a-f]{64})\s+(.+)$/);
  if (!match || match[2] !== expectedArchiveName) {
    fail(`invalid checksum sidecar for ${expectedArchiveName}`);
  }
  if (match[1] !== archiveDigest) {
    fail(`sha256 mismatch for ${expectedArchiveName}`);
  }
}

function verifyArchiveAllowlist(archivePath, target) {
  const root = `dev-agent-executor-${target}`;
  const allowedEntries = new Set([
    root,
    `${root}/dev-agent-executor`,
    `${root}/README.md`,
  ]);

  let output;
  try {
    output = execFileSync("tar", ["-tzf", archivePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    fail(`could not read archive ${basename(archivePath)}: ${detail.trim()}`.trim());
  }

  const entries = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ""));
  const uniqueEntries = new Set(entries);
  const unexpectedEntries = entries.filter((entry) => !allowedEntries.has(entry));
  if (
    entries.length !== allowedEntries.size ||
    uniqueEntries.size !== allowedEntries.size ||
    unexpectedEntries.length > 0 ||
    [...allowedEntries].some((entry) => !uniqueEntries.has(entry))
  ) {
    fail(
      `archive contents violate allowlist for ${target}: ${entries.join(", ") || "<empty>"}`
    );
  }
}

function validateRepository(repository) {
  if (typeof repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    fail(`repository must be an owner/name value: ${repository ?? "<missing>"}`);
  }
  return repository;
}

export function buildRuntimeManifest({
  inputDir = "dist",
  outputPath,
  releaseTag,
  releaseVersion,
  repository,
} = {}) {
  const resolvedInputDir = resolve(inputDir);
  if (!statSync(resolvedInputDir, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`input directory does not exist: ${inputDir}`);
  }
  const resolvedRepository = validateRepository(repository);
  const resolvedRelease = resolveReleaseVersion({ releaseTag, releaseVersion });
  const inputs = collectRuntimeInputs(resolvedInputDir);

  const artifacts = EXPECTED_TARGETS.map((target) => {
    const input = inputs.get(target);
    const archiveName = basename(input.archive);
    const digest = sha256File(input.archive);
    verifySidecar(input.sidecar, input.archive, digest);
    verifyArchiveAllowlist(input.archive, target);

    return {
      target,
      ...TARGET_METADATA[target],
      archive: archiveName,
      binary: `dev-agent-executor-${target}/dev-agent-executor`,
      sha256: digest,
      size: statSync(input.archive).size,
    };
  });

  const manifest = {
    schemaVersion: 1,
    product: "dev-agent",
    runtime: "dev-agent-executor",
    releaseVersion: resolvedRelease.releaseVersion,
    releaseTag: resolvedRelease.releaseTag,
    repository: resolvedRepository,
    protocolVersion: 1,
    artifacts,
  };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const resolvedOutputPath = resolve(outputPath ?? join(resolvedInputDir, MANIFEST_FILENAME));
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, json, "utf8");
  return { manifest, outputPath: resolvedOutputPath, json };
}

function parseArgs(argv) {
  const values = {};
  const aliases = new Map([
    ["--input-dir", "inputDir"],
    ["--dist", "inputDir"],
    ["--output", "outputPath"],
    ["--tag", "releaseTag"],
    ["--release-tag", "releaseTag"],
    ["--version", "releaseVersion"],
    ["--release-version", "releaseVersion"],
    ["--repository", "repository"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalIndex = argument.indexOf("=");
    const flag = equalIndex === -1 ? argument : argument.slice(0, equalIndex);
    const key = aliases.get(flag);
    if (!key) {
      throw new Error(`unknown argument: ${argument}`);
    }
    if (key in values) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    const value = equalIndex === -1 ? argv[++index] : argument.slice(equalIndex + 1);
    if (!value) {
      throw new Error(`argument requires a value: ${flag}`);
    }
    values[key] = value;
  }

  return values;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  const result = buildRuntimeManifest({
    inputDir: options.inputDir ?? "dist",
    outputPath: options.outputPath,
    releaseTag: options.releaseTag,
    releaseVersion: options.releaseVersion,
    repository,
  });
  process.stdout.write(`${result.outputPath}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedFile === currentFile) {
  try {
    main();
  } catch (error) {
    console.error(`runtime manifest error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
