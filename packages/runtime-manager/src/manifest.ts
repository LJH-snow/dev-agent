import { RuntimeManagerError } from "./errors.js";
import { isRuntimeTarget, targetParts } from "./targets.js";
import { SUPPORTED_TARGETS } from "./types.js";
import type { ManifestPayload, RuntimeArtifact, RuntimeManifest, RuntimeTarget } from "./types.js";
import { assertValidReleaseVersion, isSafeArchiveName, isSafeRelativePath, stableStringify } from "./security.js";

const MANIFEST_KEYS = [
  "schemaVersion",
  "product",
  "runtime",
  "releaseVersion",
  "releaseTag",
  "repository",
  "protocolVersion",
  "artifacts",
] as const;

const ARTIFACT_KEYS = ["target", "os", "arch", "libc", "archive", "binary", "sha256", "size"] as const;
const RELEASE_REPOSITORY = "LJH-snow/dev-agent" as const;
const RELEASE_BASE = "https://github.com/LJH-snow/dev-agent/releases/download";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new RuntimeManagerError("INVALID_MANIFEST", `Manifest contains unsupported field at ${path}`);
  }
}

function invalid(message: string): never {
  throw new RuntimeManagerError("INVALID_MANIFEST", message);
}

function validateArtifact(input: unknown, index: number): RuntimeArtifact {
  if (!isRecord(input)) invalid(`Artifact ${index} must be an object`);
  exactKeys(input, ARTIFACT_KEYS, `artifacts[${index}]`);

  const target = input.target;
  if (!isRuntimeTarget(target)) invalid(`Artifact ${index} has an unsupported target`);
  const expected = targetParts(target);
  if (input.os !== expected.os || input.arch !== expected.arch || input.libc !== expected.libc) {
    invalid(`Artifact ${index} platform fields do not match its target`);
  }
  if (!isSafeArchiveName(input.archive)) invalid(`Artifact ${index} has an unsafe archive name`);
  if (!isSafeRelativePath(input.binary)) invalid(`Artifact ${index} has an unsafe binary path`);
  if (input.binary === "install.json" || input.binary === ".complete") {
    invalid(`Artifact ${index} targets a reserved cache file`);
  }
  if (typeof input.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(input.sha256)) {
    invalid(`Artifact ${index} has an invalid SHA-256`);
  }
  if (typeof input.size !== "number" || !Number.isSafeInteger(input.size) || input.size < 0) {
    invalid(`Artifact ${index} has an invalid size`);
  }

  return {
    target,
    os: expected.os,
    arch: expected.arch,
    libc: expected.libc,
    archive: input.archive,
    binary: input.binary,
    sha256: input.sha256.toLowerCase(),
    size: input.size,
  };
}

export function validateManifest(input: unknown, expectedVersion?: string): RuntimeManifest {
  if (!isRecord(input)) invalid("Manifest must be an object");
  exactKeys(input, MANIFEST_KEYS, "manifest");

  if (input.schemaVersion !== 1) invalid("Manifest schemaVersion must be 1");
  if (input.product !== "dev-agent") invalid("Manifest product is not dev-agent");
  if (input.runtime !== "dev-agent-executor") invalid("Manifest runtime is not dev-agent-executor");
  try {
    assertValidReleaseVersion(input.releaseVersion);
  } catch {
    invalid("Manifest releaseVersion is invalid");
  }
  if (expectedVersion !== undefined) {
    try {
      assertValidReleaseVersion(expectedVersion);
    } catch {
      throw new RuntimeManagerError("INVALID_VERSION", "Requested release version is invalid");
    }
    if (input.releaseVersion !== expectedVersion) {
      throw new RuntimeManagerError("MANIFEST_VERSION_MISMATCH", "Manifest releaseVersion does not match the requested version", {
        expectedVersion,
        manifestVersion: input.releaseVersion,
      });
    }
  }
  if (input.releaseTag !== `v${input.releaseVersion}`) invalid("Manifest releaseTag does not match releaseVersion");
  if (input.repository !== RELEASE_REPOSITORY) invalid("Manifest repository is not the trusted release repository");
  if (input.protocolVersion !== 1) invalid("Manifest protocolVersion must be 1");
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0 || input.artifacts.length > SUPPORTED_TARGETS.length) {
    invalid("Manifest artifacts must contain between one and four entries");
  }

  const seen = new Set<RuntimeTarget>();
  const artifacts = input.artifacts.map((artifact, index) => {
    const validated = validateArtifact(artifact, index);
    if (seen.has(validated.target)) invalid(`Manifest contains duplicate target ${validated.target}`);
    seen.add(validated.target);
    return validated;
  });

  return {
    schemaVersion: 1,
    product: "dev-agent",
    runtime: "dev-agent-executor",
    releaseVersion: input.releaseVersion,
    releaseTag: `v${input.releaseVersion}`,
    repository: RELEASE_REPOSITORY,
    protocolVersion: 1,
    artifacts,
  };
}

export function parseManifest(input: ManifestPayload): RuntimeManifest {
  if (typeof input === "string") {
    try {
      return validateManifest(JSON.parse(input));
    } catch (error) {
      if (error instanceof RuntimeManagerError) throw error;
      throw new RuntimeManagerError("INVALID_MANIFEST", "Manifest is not valid JSON");
    }
  }
  if (input instanceof Uint8Array) {
    try {
      return parseManifest(new TextDecoder().decode(input));
    } catch (error) {
      if (error instanceof RuntimeManagerError) throw error;
      throw new RuntimeManagerError("INVALID_MANIFEST", "Manifest bytes could not be decoded");
    }
  }
  return validateManifest(input);
}

export function canonicalizeManifest(manifest: RuntimeManifest): string {
  const validated = validateManifest(manifest);
  const order = new Map(SUPPORTED_TARGETS.map((target, index) => [target, index]));
  const normalized = {
    ...validated,
    artifacts: [...validated.artifacts].sort(
      (left, right) => (order.get(left.target) ?? 99) - (order.get(right.target) ?? 99)
    ),
  };
  return stableStringify(normalized);
}

export function getReleaseBaseUrl(version: string): string {
  try {
    assertValidReleaseVersion(version);
  } catch {
    throw new RuntimeManagerError("INVALID_VERSION", "Requested release version is invalid");
  }
  return `${RELEASE_BASE}/v${version}`;
}

export function getManifestDownloadUrl(version: string): string {
  return `${getReleaseBaseUrl(version)}/dev-agent-runtime-manifest.json`;
}

export function getArtifactDownloadUrl(version: string, artifact: RuntimeArtifact): string {
  const validated = validateManifest({
    schemaVersion: 1,
    product: "dev-agent",
    runtime: "dev-agent-executor",
    releaseVersion: version,
    releaseTag: `v${version}`,
    repository: RELEASE_REPOSITORY,
    protocolVersion: 1,
    artifacts: [artifact],
  }, version).artifacts[0];
  if (!validated) throw new RuntimeManagerError("INVALID_MANIFEST", "Artifact is missing");
  const encodedArchive = validated.archive.split("/").map(encodeURIComponent).join("/");
  return `${getReleaseBaseUrl(version)}/${encodedArchive}`;
}

export function findArtifact(manifest: RuntimeManifest, target: RuntimeTarget): RuntimeArtifact {
  const artifact = manifest.artifacts.find((candidate) => candidate.target === target);
  if (!artifact) {
    throw new RuntimeManagerError("TARGET_MISMATCH", "Manifest does not contain the requested runtime target", {
      target,
    });
  }
  return artifact;
}

export { RELEASE_REPOSITORY };
