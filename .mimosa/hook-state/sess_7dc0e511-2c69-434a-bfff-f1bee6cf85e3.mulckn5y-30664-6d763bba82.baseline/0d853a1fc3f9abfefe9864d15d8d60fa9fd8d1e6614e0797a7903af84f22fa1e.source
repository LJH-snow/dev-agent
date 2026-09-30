import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/**
 * Resolves a tool path and, when requested, proves that its existing path
 * prefix remains inside the selected project directory. Checking the nearest
 * existing path catches both lexical traversal and symlink escapes while still
 * allowing writes to a new file or directory.
 */
export async function resolveWorkspacePath(
  workingDirectory: string,
  requestedPath: string,
  enforceWorkingDirectory: boolean
): Promise<string> {
  const target = resolve(workingDirectory, requestedPath);
  if (!enforceWorkingDirectory) {
    return target;
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(resolve(workingDirectory));
  } catch (error) {
    // Some tool unit tests use a virtual cwd. Preserve their lexical behavior
    // while still rejecting `..` and absolute paths that leave that cwd. The
    // CLI validates its cwd before tools run, so production paths take the
    // canonical/symlink-aware branch below.
    if (!isMissingPathError(error)) {
      throw error;
    }
    assertContained(resolve(workingDirectory), target, requestedPath);
    return target;
  }

  const existingPath = await nearestExistingPath(target);
  const canonicalExistingPath = await realpath(existingPath);
  assertContained(canonicalRoot, canonicalExistingPath, requestedPath);
  return target;
}

export async function canonicalWorkingDirectory(path: string): Promise<string> {
  try {
    return await realpath(resolve(path));
  } catch (error) {
    throw new Error(
      `filesystem working directory cannot be resolved: ${path} (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

function assertContained(root: string, target: string, requestedPath: string): void {
  const relativePath = relative(root, target);
  if (
    relativePath.startsWith(".." + "/") ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`filesystem path escapes the working directory: ${requestedPath}`);
  }
}

async function nearestExistingPath(path: string): Promise<string> {
  let candidate = path;
  while (true) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      candidate = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "ENOENT" ||
      (error as { code?: unknown }).code === "ENOTDIR")
  );
}
