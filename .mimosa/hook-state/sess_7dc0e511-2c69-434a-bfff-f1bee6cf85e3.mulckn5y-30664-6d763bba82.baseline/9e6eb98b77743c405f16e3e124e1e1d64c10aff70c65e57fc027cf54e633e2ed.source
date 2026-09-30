import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { RuntimeManagerError } from "./errors.js";
import { isRuntimeTarget } from "./targets.js";
import type { RuntimeManagerOptions, RuntimePaths, RuntimeTarget } from "./types.js";
import { assertValidReleaseVersion } from "./security.js";

const DEFAULT_RUNTIME_DIRECTORY = ".dev-agent/runtimes";
const CACHE_BINARY_NAME = "dev-agent-executor";

export function getRuntimeRoot(options: Pick<RuntimeManagerOptions, "home" | "runtimeDir"> = {}): string {
  if (options.runtimeDir !== undefined) return resolve(options.runtimeDir);
  return resolve(options.home ?? homedir(), DEFAULT_RUNTIME_DIRECTORY);
}

export function getRuntimePaths(root: string, version: string, target: RuntimeTarget): RuntimePaths {
  try {
    assertValidReleaseVersion(version);
  } catch {
    throw new RuntimeManagerError("INVALID_VERSION", "Requested release version is invalid");
  }
  if (!isRuntimeTarget(target)) {
    throw new RuntimeManagerError("TARGET_MISMATCH", "Requested runtime target is unsupported");
  }
  const safeRoot = resolve(root);
  const versionDir = join(safeRoot, version);
  const targetDir = join(versionDir, target);
  return {
    root: safeRoot,
    versionDir,
    targetDir,
    binaryPath: join(targetDir, CACHE_BINARY_NAME),
    installMetadataPath: join(targetDir, "install.json"),
    completePath: join(targetDir, ".complete"),
  };
}

export function isAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

export { CACHE_BINARY_NAME };
