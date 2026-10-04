import { resolve, sep } from "node:path";

export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  if (value.includes("\\")) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function isSafeArchiveName(value: unknown): value is string {
  return (
    isSafeRelativePath(value) &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.includes("//") &&
    !value.startsWith(".")
  );
}

export function resolveWithin(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, relativePath);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  if (candidate !== resolvedRoot && !candidate.startsWith(prefix)) {
    throw new Error("path escapes destination");
  }
  return candidate;
}

export function isWithin(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(prefix);
}

export function assertValidReleaseVersion(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  ) {
    throw new Error("invalid release version");
  }
}

/**
 * POSIX ownership gate for runtime cache directories. The cache must stay
 * owned by the invoking user and not be group/world writable, so another
 * local user cannot pre-plant (or later tamper with) a version directory that
 * would otherwise pass the metadata/hash consistency checks. Windows has no
 * comparable uid model, so the check is a no-op there.
 */
export function isPrivatelyOwned(info: { uid: number; mode: number }): boolean {
  if (process.platform === "win32" || typeof process.getuid !== "function") {
    return true;
  }
  if (info.uid !== process.getuid()) return false;
  return (info.mode & 0o022) === 0;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

