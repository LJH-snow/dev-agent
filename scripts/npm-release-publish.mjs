import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runReleasePreflight } from "./npm-release-preflight.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = join(repositoryRoot, "apps", "cli");
const registry = "https://registry.npmjs.org";
const packageName = "@agent_cli/cli";
const maxBuffer = 4 * 1024 * 1024;

/**
 * Publishes only after the same preflight used by the release checklist has
 * passed. `publish: true` is deliberately required so an accidental invocation
 * can never turn a status check into a remote mutation.
 */
export async function publishReleaseCandidate(options = {}) {
  const preflight = options.preflight
    ? await options.preflight()
    : await runReleasePreflight({ runCommand: options.runCommand });
  const base = {
    command: "release publish",
    package: safeString(preflight?.package, packageName),
    candidateVersion: safeString(preflight?.candidateVersion, "unknown"),
  };

  if (options.publish !== true) {
    return {
      ...base,
      ok: false,
      reason: "confirmation_required",
      nextAction: "explicit_publish_confirmation",
    };
  }

  if (preflight?.ok !== true) {
    return {
      ...base,
      ok: false,
      reason: "preflight_failed",
      ...(Array.isArray(preflight?.errors) ? { errors: preflight.errors } : {}),
      nextAction: safeString(preflight?.nextAction, "run_preflight"),
    };
  }

  const runCommand = options.runCommand ?? defaultRunCommand;
  try {
    await runCommand("publish", ["--access", "public", "--registry", registry]);
  } catch {
    return {
      ...base,
      ok: false,
      reason: "publish_failed",
      nextAction: "review_publish_error",
    };
  }

  try {
    const verification = await runCommand("view", [
      `${base.package}@${base.candidateVersion}`,
      "version",
      "--registry",
      registry,
      "--json",
    ]);
    if (parseVersionOutput(verification?.stdout) !== base.candidateVersion) {
      return {
        ...base,
        ok: false,
        reason: "verification_mismatch",
        nextAction: "review_registry",
      };
    }
  } catch {
    return {
      ...base,
      ok: false,
      reason: "verification_failed",
      nextAction: "review_registry",
    };
  }

  return {
    ...base,
    ok: true,
    status: "published",
    nextAction: "verify_install",
  };
}

export function formatPublishResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

async function defaultRunCommand(operation, args) {
  const result = await execFileAsync("npm", [operation, ...args], {
    cwd: operation === "publish" ? cliRoot : repositoryRoot,
    env: process.env,
    maxBuffer,
  });
  return { stdout: String(result.stdout ?? "") };
}

function parseVersionOutput(value) {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
  } catch {
    // npm may return a plain version string when JSON output is unavailable.
  }
  const candidate = value.trim();
  return /^\d+\.\d+\.\d+$/.test(candidate) ? candidate : undefined;
}

function safeString(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function parsePublishArgs(argv) {
  const options = { publish: false };
  for (const argument of argv) {
    if (argument === "--") {
      continue;
    }
    if (argument === "--publish") {
      options.publish = true;
      continue;
    }
    if (argument === "--json") {
      continue;
    }
    throw new Error("unknown_argument");
  }
  return options;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedFile === currentFile) {
  try {
    const options = parsePublishArgs(process.argv.slice(2));
    const result = await publishReleaseCandidate(options);
    process.stdout.write(formatPublishResult(result));
    if (!result.ok) process.exitCode = 1;
  } catch {
    process.stdout.write(formatPublishResult({
      command: "release publish",
      ok: false,
      reason: "invalid_invocation",
      nextAction: "run_release_preflight",
    }));
    process.exitCode = 1;
  }
}
