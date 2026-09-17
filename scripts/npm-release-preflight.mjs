import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = join(repositoryRoot, "apps", "cli");
const registry = "https://registry.npmjs.org";
const packageName = "@agent_cli/cli";
const expectedPackedFiles = Object.freeze([
  "dist/cli.js",
  "dist/cli.js.map",
  "LICENSE",
  "package.json",
  "README.md",
]);
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const maxBuffer = 4 * 1024 * 1024;

/**
 * Checks the local package manifest and the checked-in release-state record.
 * The result deliberately returns error codes rather than raw values so it can
 * be used in CI logs without exposing local paths or package metadata.
 */
export function validateReleaseCandidateMetadata(packageJson, releaseState) {
  const errors = [];
  if (packageJson?.name !== packageName || releaseState?.package !== packageName) {
    errors.push("package_name_mismatch");
  }
  if (packageJson?.private !== false) {
    errors.push("package_is_private");
  }
  if (packageJson?.version !== releaseState?.candidateVersion) {
    errors.push("candidate_version_mismatch");
  }

  const candidate = parseStableVersion(packageJson?.version);
  const published = parseStableVersion(releaseState?.publishedVersion);
  if (candidate === undefined || published === undefined) {
    errors.push("invalid_version");
  } else if (compareVersions(candidate, published) <= 0) {
    errors.push("candidate_not_newer");
  }

  const files = Array.isArray(packageJson?.files) ? packageJson.files : [];
  if (!expectedPackedFiles.slice(0, 3).every((file) => files.includes(file))) {
    errors.push("package_files_missing");
  }

  return errors.length === 0
    ? { ok: true }
    : { ok: false, errors: [...new Set(errors)] };
}

/**
 * Validates the allowlisted files reported by `npm pack --dry-run --json`.
 * Paths are treated as opaque metadata and are never echoed in failures.
 */
export function inspectPackedFiles(files) {
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
    return { ok: false, errors: ["unexpected_files"] };
  }

  const uniqueFiles = new Set(files);
  const hasUnsafeOrUnexpectedFile = files.some((file) => {
    const normalized = file.replaceAll("\\", "/");
    return (
      normalized.startsWith("/") ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.includes("/../") ||
      !expectedPackedFiles.includes(normalized)
    );
  });
  const missingExpectedFile = expectedPackedFiles.some((file) => !uniqueFiles.has(file));
  const errors = [];
  if (hasUnsafeOrUnexpectedFile || uniqueFiles.size !== files.length) {
    errors.push("unexpected_files");
  }
  if (missingExpectedFile) {
    errors.push("missing_files");
  }

  return errors.length === 0
    ? { ok: true, fileCount: files.length }
    : { ok: false, errors };
}

/**
 * Runs release checks with injectable command and artifact readers so the
 * contract can be tested without network access or a real npm credential.
 */
export async function runReleasePreflight(options = {}) {
  const packageJson = options.packageJson ?? await readJson(join(cliRoot, "package.json"));
  const releaseState = options.releaseState ?? await readJson(join(repositoryRoot, "docs", "release-state.json"));
  const metadata = validateReleaseCandidateMetadata(packageJson, releaseState);
  const base = {
    command: "release preflight",
    ok: false,
    package: safeString(packageJson?.name, "unknown"),
    candidateVersion: safeString(packageJson?.version, "unknown"),
    publishedVersion: safeString(releaseState?.publishedVersion, "unknown"),
  };

  if (!metadata.ok) {
    return {
      ...base,
      auth: { status: "unknown" },
      registry: { status: "unknown" },
      artifact: { status: "unknown" },
      errors: metadata.errors,
      nextAction: "fix_release_metadata",
    };
  }

  const runCommand = options.runCommand ?? defaultRunCommand;
  const readPackedFiles = options.readPackedFiles ?? defaultReadPackedFiles;
  const auth = await probeAuth(runCommand);
  const registryResult = await probeRegistry(
    runCommand,
    packageJson.name,
    releaseState.publishedVersion,
  );
  const artifact = await probeArtifact(readPackedFiles);
  const errors = [];
  if (auth.status !== "authenticated") errors.push("auth_required");
  if (registryResult.status !== "matched") errors.push(`registry_${registryResult.status}`);
  if (artifact.status !== "ready") errors.push(`artifact_${artifact.status}`);

  return {
    ...base,
    auth,
    registry: registryResult,
    artifact,
    ...(errors.length === 0
      ? { ok: true, nextAction: "publish_candidate" }
      : { errors, nextAction: chooseNextAction(auth, registryResult, artifact) }),
  };
}

export function formatPreflightResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

async function probeAuth(runCommand) {
  try {
    await runCommand("whoami", ["--registry", registry]);
    return { status: "authenticated" };
  } catch {
    return { status: "missing" };
  }
}

async function probeRegistry(runCommand, name, expectedVersion) {
  try {
    const result = await runCommand("view", [
      `${name}@${expectedVersion}`,
      "version",
      "--registry",
      registry,
      "--json",
    ]);
    const version = parseVersionOutput(result?.stdout);
    if (version === expectedVersion) {
      return { status: "matched", version };
    }
    return { status: "mismatch" };
  } catch {
    return { status: "unavailable" };
  }
}

async function probeArtifact(readPackedFiles) {
  try {
    const inspected = inspectPackedFiles(await readPackedFiles());
    return inspected.ok
      ? { status: "ready", fileCount: inspected.fileCount }
      : { status: "invalid" };
  } catch {
    return { status: "unavailable" };
  }
}

function chooseNextAction(auth, registryResult, artifact) {
  if (auth.status !== "authenticated") return "npm_login_required";
  if (registryResult.status !== "matched") return "verify_registry";
  if (artifact.status !== "ready") return "rebuild_package";
  return "review_preflight_errors";
}

async function defaultRunCommand(operation, args) {
  const result = await execFileAsync("npm", [operation, ...args], {
    cwd: repositoryRoot,
    env: process.env,
    maxBuffer,
  });
  return { stdout: String(result.stdout ?? "") };
}

async function defaultReadPackedFiles() {
  const result = await execFileAsync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: cliRoot, env: process.env, maxBuffer },
  );
  const parsed = parseJson(result.stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = Array.isArray(entry?.files) ? entry.files : [];
  return files.map((file) => file?.path).filter((path) => typeof path === "string");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseJson(value) {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseVersionOutput(value) {
  const parsed = parseJson(value);
  const candidate = typeof parsed === "string" ? parsed : typeof value === "string" ? value.trim() : "";
  return stableVersionPattern.test(candidate) ? candidate : undefined;
}

function parseStableVersion(value) {
  if (typeof value !== "string" || !stableVersionPattern.test(value)) return undefined;
  const [, major, minor, patch] = value.match(stableVersionPattern);
  return [Number(major), Number(minor), Number(patch)];
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function safeString(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedFile === currentFile) {
  try {
    const result = await runReleasePreflight();
    process.stdout.write(formatPreflightResult(result));
    if (!result.ok) process.exitCode = 1;
  } catch {
    process.stdout.write(formatPreflightResult({
      command: "release preflight",
      ok: false,
      nextAction: "fix_release_metadata",
      errors: ["preflight_failed"],
    }));
    process.exitCode = 1;
  }
}
