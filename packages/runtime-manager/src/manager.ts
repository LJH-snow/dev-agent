import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { extractTarGz, hashFile, verifyExecutableFile } from "./archive.js";
import {
  RuntimeManagerError,
  isAbortError,
  isRuntimeManagerError,
  statusError,
} from "./errors.js";
import {
  findArtifact,
  getArtifactDownloadUrl,
  getManifestDownloadUrl,
  parseManifest,
  validateManifest,
} from "./manifest.js";
import { getRuntimePaths, getRuntimeRoot } from "./paths.js";
import { isSafeArchiveName, isWithin, resolveWithin, stableStringify } from "./security.js";
import { isRuntimeTarget, resolveTarget, targetResolutionFor } from "./targets.js";
import type {
  ArchiveDownloader,
  ArchiveExtractor,
  HashVerifier,
  HealthVerifier,
  InstallOptions,
  InstallResult,
  ManifestDownloader,
  RemoveResult,
  RuntimeManagerOptions,
  RuntimeManifest,
  RuntimePaths,
  RuntimeStatus,
  RuntimeTarget,
  TargetResolution,
} from "./types.js";

interface InstallMetadata {
  readonly schemaVersion: 1;
  readonly product: "dev-agent";
  readonly runtime: "dev-agent-executor";
  readonly releaseVersion: string;
  readonly target: RuntimeTarget;
  readonly binary: "dev-agent-executor";
  readonly archive: string;
  readonly archiveSha256: string;
  readonly archiveSize: number;
  readonly binarySha256: string;
  readonly binarySize: number;
  readonly protocolVersion: 1;
}

const INSTALL_METADATA_KEYS = [
  "schemaVersion",
  "product",
  "runtime",
  "releaseVersion",
  "target",
  "binary",
  "archive",
  "archiveSha256",
  "archiveSize",
  "binarySha256",
  "binarySize",
  "protocolVersion",
] as const;

const EMPTY_MARKER = "";

async function defaultManifestDownloader(version: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(getManifestDownloadUrl(version), { signal });
    if (!response.ok) throw new Error("manifest request failed");
    return await response.text();
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    throw new Error("manifest request failed");
  }
}

async function defaultArchiveDownloader(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("archive request failed");
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    throw new Error("archive request failed");
  }
}

function safeStatusReason(error: unknown, fallback: string): string {
  if (error instanceof RuntimeManagerError) return error.message;
  return fallback;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function isDirectoryEmpty(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    return isNotFound(error);
  }
}

async function removePathSafely(path: string): Promise<boolean> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    await rm(path, { force: true });
  } else {
    await rm(path, { recursive: true, force: true });
  }
  return true;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new RuntimeManagerError("INSTALL_FAILED", "Runtime cache directory is not a private directory");
    }
    return;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
}

function ensureUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new RuntimeManagerError("DOWNLOAD_FAILED", "Runtime archive download returned invalid data");
}

function completeMarker(metadata: InstallMetadata): string {
  return stableStringify({
    releaseVersion: metadata.releaseVersion,
    target: metadata.target,
    binary: metadata.binary,
    binarySha256: metadata.binarySha256,
  });
}

function parseInstallMetadata(input: string): InstallMetadata | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => !(INSTALL_METADATA_KEYS as readonly string[]).includes(key))) return undefined;
  if (
    record.schemaVersion !== 1 ||
    record.product !== "dev-agent" ||
    record.runtime !== "dev-agent-executor" ||
    typeof record.releaseVersion !== "string" ||
    !isRuntimeTarget(record.target) ||
    record.binary !== "dev-agent-executor" ||
    !isSafeArchiveName(record.archive) ||
    typeof record.archiveSha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(record.archiveSha256) ||
    typeof record.archiveSize !== "number" ||
    !Number.isSafeInteger(record.archiveSize) ||
    record.archiveSize < 0 ||
    typeof record.binarySha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(record.binarySha256) ||
    typeof record.binarySize !== "number" ||
    !Number.isSafeInteger(record.binarySize) ||
    record.binarySize < 0 ||
    record.protocolVersion !== 1
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    product: "dev-agent",
    runtime: "dev-agent-executor",
    releaseVersion: record.releaseVersion,
    target: record.target,
    binary: "dev-agent-executor",
    archive: record.archive,
    archiveSha256: record.archiveSha256.toLowerCase(),
    archiveSize: record.archiveSize,
    binarySha256: record.binarySha256.toLowerCase(),
    binarySize: record.binarySize,
    protocolVersion: 1,
  };
}

export class RuntimeManager {
  private readonly options: RuntimeManagerOptions;
  private readonly root: string;
  private readonly manifestDownloader: ManifestDownloader;
  private readonly archiveDownloader: ArchiveDownloader;
  private readonly hashVerifier: HashVerifier;
  private readonly healthVerifier: HealthVerifier;
  private readonly archiveExtractor: ArchiveExtractor;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: RuntimeManagerOptions = {}) {
    this.options = { ...options };
    this.root = getRuntimeRoot(options);
    this.manifestDownloader = options.manifestDownloader ?? defaultManifestDownloader;
    this.archiveDownloader = options.archiveDownloader ?? defaultArchiveDownloader;
    this.hashVerifier = options.hashVerifier ?? hashFile;
    this.healthVerifier = options.healthVerifier ?? verifyExecutableFile;
    this.archiveExtractor = options.archiveExtractor ?? extractTarGz;
  }

  resolveTarget(): TargetResolution {
    return resolveTarget({
      platform: this.options.platform,
      arch: this.options.arch,
      libc: this.options.libc,
    });
  }

  async status(version: string, target?: RuntimeTarget): Promise<RuntimeStatus> {
    const selected = this.selectTarget(target);
    if (!selected.supported) {
      return { state: "unsupported", version, reason: selected.reason };
    }
    const paths = getRuntimePaths(this.root, version, selected.target);
    return this.inspect(paths, version, selected.target);
  }

  async path(version: string, target?: RuntimeTarget): Promise<string> {
    const status = await this.status(version, target);
    if (status.state === "installed") {
      if (status.binaryPath) return status.binaryPath;
      throw new RuntimeManagerError("RUNTIME_CORRUPT", "Runtime binary path is missing");
    }
    throw statusError(status.state, version, status.target);
  }

  async install(version: string, options: InstallOptions = {}): Promise<InstallResult> {
    const selected = this.selectTarget(options.target);
    if (!selected.supported) {
      throw new RuntimeManagerError("UNSUPPORTED_PLATFORM", selected.reason);
    }
    const paths = getRuntimePaths(this.root, version, selected.target);
    const lockKey = `${version}/${selected.target}`;
    return this.withLock(lockKey, async () => this.installLocked(version, selected.target, paths, options));
  }

  async remove(version: string, target?: RuntimeTarget): Promise<RemoveResult> {
    const targetResolution = target === undefined ? undefined : this.selectTarget(target);
    if (targetResolution && !targetResolution.supported) {
      throw new RuntimeManagerError("TARGET_MISMATCH", "Requested runtime target is unsupported");
    }
    const versionDir = getRuntimePaths(this.root, version, SUPPORTED_TARGETS_FALLBACK[0]!).versionDir;
    let versionInfo;
    try {
      versionInfo = await lstat(versionDir);
    } catch (error) {
      if (isNotFound(error)) return { version, ...(target ? { target } : {}), removed: false, removedPaths: [] };
      throw new RuntimeManagerError("INSTALL_FAILED", "Runtime cache could not be inspected before removal");
    }
    if (versionInfo.isSymbolicLink()) {
      if (target !== undefined) {
        throw new RuntimeManagerError("RUNTIME_CORRUPT", "Cannot remove one target through a version symlink");
      }
      const removed = await removePathSafely(versionDir);
      return { version, removed, removedPaths: removed ? [versionDir] : [] };
    }
    if (!versionInfo.isDirectory()) {
      return { version, ...(target ? { target } : {}), removed: false, removedPaths: [] };
    }
    const targets = targetResolution ? [targetResolution.target] : SUPPORTED_TARGETS_FALLBACK;
    const removedPaths: string[] = [];
    for (const candidate of targets) {
      const paths = getRuntimePaths(this.root, version, candidate);
      if (await removePathSafely(paths.targetDir)) removedPaths.push(paths.targetDir);
    }
    if (await isDirectoryEmpty(versionDir)) await removePathSafely(versionDir);
    return { version, ...(target ? { target } : {}), removed: removedPaths.length > 0, removedPaths };
  }

  private selectTarget(target?: RuntimeTarget): TargetResolution {
    if (target !== undefined) {
      if (!isRuntimeTarget(target)) {
        throw new RuntimeManagerError("TARGET_MISMATCH", "Requested runtime target is unsupported");
      }
      return targetResolutionFor(target);
    }
    return this.resolveTarget();
  }

  private async inspect(paths: RuntimePaths, version: string, target: RuntimeTarget): Promise<RuntimeStatus> {
    let versionInfo;
    try {
      versionInfo = await lstat(paths.versionDir);
    } catch (error) {
      if (isNotFound(error)) return { state: "missing", version, target };
      return { state: "corrupt", version, target, reason: "Runtime version directory could not be inspected" };
    }
    if (!versionInfo.isDirectory() || versionInfo.isSymbolicLink()) {
      return { state: "corrupt", version, target, reason: "Runtime version directory is not private" };
    }

    let targetInfo;
    try {
      targetInfo = await lstat(paths.targetDir);
    } catch (error) {
      if (isNotFound(error)) return { state: "missing", version, target };
      return { state: "corrupt", version, target, reason: "Runtime cache could not be inspected" };
    }
    if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
      return { state: "corrupt", version, target, reason: "Runtime cache directory is not a private directory" };
    }

    let metadata: InstallMetadata | undefined;
    try {
      const metadataInfo = await lstat(paths.installMetadataPath);
      const completeInfo = await lstat(paths.completePath);
      if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || !completeInfo.isFile() || completeInfo.isSymbolicLink()) {
        return { state: "corrupt", version, target, reason: "Runtime completion markers are invalid" };
      }
      metadata = parseInstallMetadata(await readFile(paths.installMetadataPath, "utf8"));
      if (!metadata) return { state: "corrupt", version, target, reason: "Runtime metadata is invalid" };
      const marker = (await readFile(paths.completePath, "utf8")).trim();
      if (marker !== EMPTY_MARKER && marker !== completeMarker(metadata)) {
        return { state: "corrupt", version, target, reason: "Runtime completion marker is invalid" };
      }
    } catch (error) {
      if (isNotFound(error)) return { state: "corrupt", version, target, reason: "Runtime completion markers are incomplete" };
      return { state: "corrupt", version, target, reason: safeStatusReason(error, "Runtime metadata is unreadable") };
    }

    if (metadata.releaseVersion !== version || metadata.target !== target) {
      return { state: "corrupt", version, target, reason: "Runtime metadata does not match its cache location" };
    }

    try {
      const binaryInfo = await lstat(paths.binaryPath);
      if (!binaryInfo.isFile() || binaryInfo.isSymbolicLink() || (binaryInfo.mode & 0o111) === 0) {
        return { state: "corrupt", version, target, reason: "Runtime binary is missing or not executable" };
      }
      if (binaryInfo.size !== metadata.binarySize) {
        return { state: "corrupt", version, target, reason: "Runtime binary size does not match metadata" };
      }
      const digest = await hashFile(paths.binaryPath);
      if (digest !== metadata.binarySha256) {
        return { state: "corrupt", version, target, reason: "Runtime binary checksum does not match metadata" };
      }
    } catch (error) {
      return { state: "corrupt", version, target, reason: safeStatusReason(error, "Runtime binary could not be inspected") };
    }

    return { state: "installed", version, target, binaryPath: paths.binaryPath };
  }

  private async installLocked(
    version: string,
    target: RuntimeTarget,
    paths: RuntimePaths,
    options: InstallOptions
  ): Promise<InstallResult> {
    this.ensureNotCancelled(options.signal);
    const existing = await this.inspect(paths, version, target);
    if (existing.state === "installed" && existing.binaryPath) {
      return { version, target, binaryPath: existing.binaryPath, reused: true };
    }

    const manifestReleaseVersion = options.manifestReleaseVersion ?? version;
    const manifest = await this.loadManifest(manifestReleaseVersion, options);
    const artifact = findArtifact(manifest, target);
    this.ensureNotCancelled(options.signal);

    await ensurePrivateDirectory(this.root);
    await ensurePrivateDirectory(paths.versionDir);
    let temporaryDir: string | undefined;
    try {
      temporaryDir = await mkdtemp(join(paths.versionDir, `.install-${target}-`));
      const archivePath = join(temporaryDir, "runtime.archive");
      const extractedDir = join(temporaryDir, "extracted");
      let archive: Uint8Array;
      try {
        archive = ensureUint8Array(await this.archiveDownloader(getArtifactDownloadUrl(manifestReleaseVersion, artifact), options.signal));
      } catch (error) {
        this.ensureNotCancelled(options.signal, error);
        throw new RuntimeManagerError("DOWNLOAD_FAILED", "Runtime archive download failed");
      }
      this.ensureNotCancelled(options.signal);
      if (archive.byteLength !== artifact.size) {
        throw new RuntimeManagerError("CHECKSUM_MISMATCH", "Runtime archive size does not match the manifest");
      }
      await writeFile(archivePath, archive, { mode: 0o600 });

      let actualArchiveSha256: string;
      try {
        actualArchiveSha256 = (await this.hashVerifier(archivePath)).toLowerCase();
      } catch {
        throw new RuntimeManagerError("CHECKSUM_MISMATCH", "Runtime archive checksum could not be calculated");
      }
      if (actualArchiveSha256 !== artifact.sha256) {
        throw new RuntimeManagerError("CHECKSUM_MISMATCH", "Runtime archive checksum does not match the manifest");
      }

      await mkdir(extractedDir, { recursive: true, mode: 0o700 });
      try {
        await this.archiveExtractor(archive, extractedDir);
      } catch (error) {
        this.ensureNotCancelled(options.signal, error);
        if (isRuntimeManagerError(error) && error.code === "ARCHIVE_INVALID") throw error;
        throw new RuntimeManagerError("ARCHIVE_INVALID", "Runtime archive could not be safely extracted");
      }
      this.ensureNotCancelled(options.signal);

      const sourceBinary = resolveWithin(extractedDir, artifact.binary);
      const sourceRealPath = await realpath(sourceBinary);
      const extractedRealPath = await realpath(extractedDir);
      if (!isWithin(extractedRealPath, sourceRealPath)) {
        throw new RuntimeManagerError("ARCHIVE_INVALID", "Runtime binary escapes the extraction directory");
      }
      const sourceInfo = await lstat(sourceRealPath);
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
        throw new RuntimeManagerError("ARCHIVE_INVALID", "Runtime archive binary is not a regular file");
      }

      const stagedBinary = join(temporaryDir, "dev-agent-executor");
      await copyFile(sourceRealPath, stagedBinary);
      await chmod(stagedBinary, (sourceInfo.mode & 0o777) | 0o111 || 0o755);
      this.ensureNotCancelled(options.signal);

      const binaryInfo = await stat(stagedBinary);
      const binarySha256 = await hashFile(stagedBinary);
      const metadata: InstallMetadata = {
        schemaVersion: 1,
        product: "dev-agent",
        runtime: "dev-agent-executor",
        releaseVersion: version,
        target,
        binary: "dev-agent-executor",
        archive: artifact.archive,
        archiveSha256: artifact.sha256,
        archiveSize: artifact.size,
        binarySha256,
        binarySize: binaryInfo.size,
        protocolVersion: 1,
      };

      try {
        await this.healthVerifier(stagedBinary, options.signal);
      } catch (error) {
        this.ensureNotCancelled(options.signal, error);
        if (isRuntimeManagerError(error) && error.code === "HEALTH_CHECK_FAILED") throw error;
        throw new RuntimeManagerError("HEALTH_CHECK_FAILED", "Runtime health verification failed");
      }
      this.ensureNotCancelled(options.signal);

      await writeFile(join(temporaryDir, "install.json"), canonicalizeInstallMetadata(metadata), { mode: 0o600 });
      await writeFile(join(temporaryDir, ".complete"), completeMarker(metadata), { mode: 0o600 });
      await rm(extractedDir, { recursive: true, force: true });
      await rm(archivePath, { force: true });
      this.ensureNotCancelled(options.signal);

      await removePathSafely(paths.targetDir);
      await rename(temporaryDir, paths.targetDir);
      temporaryDir = undefined;
      return { version, target, binaryPath: paths.binaryPath, reused: false };
    } catch (error) {
      this.ensureNotCancelled(options.signal, error);
      if (isRuntimeManagerError(error)) throw error;
      throw new RuntimeManagerError("INSTALL_FAILED", "Runtime installation failed");
    } finally {
      if (temporaryDir) await removePathSafely(temporaryDir).catch(() => undefined);
      if (await isDirectoryEmpty(paths.versionDir)) await removePathSafely(paths.versionDir).catch(() => undefined);
    }
  }

  private async loadManifest(version: string, options: InstallOptions): Promise<RuntimeManifest> {
    if (options.manifest !== undefined) {
      try {
        return validateManifest(options.manifest, version);
      } catch (error) {
        if (error instanceof RuntimeManagerError) throw error;
        throw new RuntimeManagerError("INVALID_MANIFEST", "Runtime manifest is invalid");
      }
    }
    let payload;
    try {
      payload = await this.manifestDownloader(version, options.signal);
    } catch (error) {
      this.ensureNotCancelled(options.signal, error);
      throw new RuntimeManagerError("DOWNLOAD_FAILED", "Runtime manifest download failed");
    }
    try {
      return validateManifest(parseManifest(payload), version);
    } catch (error) {
      if (error instanceof RuntimeManagerError) throw error;
      throw new RuntimeManagerError("INVALID_MANIFEST", "Runtime manifest is invalid");
    }
  }

  private ensureNotCancelled(signal?: AbortSignal, error?: unknown): void {
    if (signal?.aborted || isAbortError(error)) {
      throw new RuntimeManagerError("INSTALL_CANCELLED", "Runtime installation was cancelled");
    }
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key);
    const current = (previous ?? Promise.resolve()).then(operation, operation);
    this.locks.set(key, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

function canonicalizeInstallMetadata(metadata: InstallMetadata): string {
  return stableStringify(metadata);
}

const SUPPORTED_TARGETS_FALLBACK: RuntimeTarget[] = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu",
];

export function createRuntimeManager(options?: RuntimeManagerOptions): RuntimeManager {
  return new RuntimeManager(options);
}
