import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

// @ts-ignore The RED phase intentionally runs before dist/index.js exists.
const api = await import("../dist/index.js");
const archiveModule = await import("../dist/archive.js");

const VERSION = "0.2.0";
const MANIFEST_RELEASE_VERSION = "0.1.6";
const OTHER_VERSION = "0.2.1";
const REPOSITORY = "LJH-snow/dev-agent";
const SHA = "a".repeat(64);
const TARGET = "aarch64-apple-darwin";
const OTHER_TARGET = "x86_64-unknown-linux-gnu";
const MANIFEST_DOWNLOAD_LIMIT = 1024 * 1024;
const ARCHIVE_DOWNLOAD_LIMIT = 16 * 1024 * 1024;
const DECOMPRESSED_ARCHIVE_LIMIT = 32 * 1024 * 1024;
const COMPLETION_METADATA_READ_LIMIT = 1024 * 1024;

function artifactFor(target = TARGET, sha256 = SHA): any {
  const targetInfo = {
    "aarch64-apple-darwin": { os: "darwin", arch: "arm64", libc: "none" },
    "x86_64-apple-darwin": { os: "darwin", arch: "x64", libc: "none" },
    "aarch64-unknown-linux-gnu": { os: "linux", arch: "arm64", libc: "glibc" },
    "x86_64-unknown-linux-gnu": { os: "linux", arch: "x64", libc: "glibc" },
  }[target];

  if (!targetInfo) throw new Error(`unknown fixture target: ${target}`);

  return {
    target,
    ...targetInfo,
    archive: `dev-agent-executor-${target}.tar.gz`,
    binary: `dev-agent-executor-${target}/dev-agent-executor`,
    sha256,
    size: Buffer.byteLength("archive-bytes"),
  };
}

function manifestFor({
  releaseVersion = VERSION,
  target = TARGET,
  artifact = artifactFor(target),
  ...overrides
}: { releaseVersion?: string; target?: string; artifact?: Record<string, unknown>; [key: string]: unknown } = {}): any {
  return {
    schemaVersion: 1,
    product: "dev-agent",
    runtime: "dev-agent-executor",
    releaseVersion,
    releaseTag: `v${releaseVersion}`,
    repository: REPOSITORY,
    protocolVersion: 1,
    artifacts: [artifact],
    ...overrides,
  };
}

function assertRuntimeError(error: unknown, code: string) {
  assert.equal(error && typeof error === "object" ? (error as { code?: string }).code : undefined, code);
  return true;
}

function streamedResponse(chunks: Uint8Array[]) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { status: 200 }),
    wasCancelled: () => cancelled,
  };
}

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "dev-agent-runtime-manager-test-"));
}

function makeInstallDependencies({
  manifest = manifestFor(),
  onArchiveDownload,
  onManifestDownload,
  onExtract,
  onHealth,
  onHash,
}: {
  manifest?: Record<string, unknown>;
  onArchiveDownload?: (url: string) => void;
  onManifestDownload?: (version: string) => void;
  onExtract?: (archive: Uint8Array, destination: string) => Promise<void>;
  onHealth?: (binaryPath: string, signal?: AbortSignal) => Promise<void>;
  onHash?: (filePath: string) => Promise<string>;
} = {}) {
  return {
    manifestDownloader: async (version: string) => {
      onManifestDownload?.(version);
      return JSON.stringify(manifest);
    },
    archiveDownloader: async (url: string) => {
      onArchiveDownload?.(url);
      return Buffer.from("archive-bytes");
    },
    archiveExtractor:
      onExtract ??
      (async (_archive: Uint8Array, destination: string) => {
        for (const candidate of [
          "aarch64-apple-darwin",
          "x86_64-apple-darwin",
          "aarch64-unknown-linux-gnu",
          "x86_64-unknown-linux-gnu",
        ]) {
          const binaryPath = join(destination, artifactFor(candidate).binary);
          await mkdir(join(binaryPath, ".."), { recursive: true });
          await writeFile(binaryPath, "binary", { mode: 0o600 });
        }
      }),
    hashVerifier: onHash ?? (async (_filePath: string) => SHA),
    healthVerifier: onHealth ?? (async (binaryPath: string) => {
      assert.notEqual((await stat(binaryPath)).mode & 0o111, 0);
    }),
  };
}

test("resolves the four supported platform targets", () => {
  assert.deepEqual(api.resolveTarget({ platform: "darwin", arch: "arm64" }), {
    supported: true,
    target: "aarch64-apple-darwin",
    os: "darwin",
    arch: "arm64",
    libc: "none",
  });
  assert.deepEqual((api.resolveTarget({ platform: "darwin", arch: "x64" }) as any).target, "x86_64-apple-darwin");
  assert.deepEqual((api.resolveTarget({ platform: "linux", arch: "arm64", libc: "glibc" }) as any).target, "aarch64-unknown-linux-gnu");
  assert.deepEqual((api.resolveTarget({ platform: "linux", arch: "x64", libc: "glibc" }) as any).target, "x86_64-unknown-linux-gnu");
});

test("returns explicit unsupported results for Windows, musl, and unknown platforms", () => {
  for (const input of [
    { platform: "win32", arch: "x64" },
    { platform: "linux", arch: "x64", libc: "musl" },
    { platform: "linux", arch: "x64", libc: "unknown" },
    { platform: "freebsd", arch: "x64" },
  ]) {
    const result = api.resolveTarget(input as any);
    assert.equal(result.supported, false);
    assert.equal(result.code, "UNSUPPORTED_PLATFORM");
    assert.match(result.reason, /Windows|musl|glibc|unsupported|unknown/i);
  }
});

test("canonicalizes and parses the frozen manifest shape deterministically", () => {
  const manifest = manifestFor();
  const reordered = {
    artifacts: manifest.artifacts,
    protocolVersion: 1,
    repository: REPOSITORY,
    releaseTag: `v${VERSION}`,
    releaseVersion: VERSION,
    runtime: "dev-agent-executor",
    product: "dev-agent",
    schemaVersion: 1,
  };

  const canonicalA = api.canonicalizeManifest(manifest);
  const canonicalB = api.canonicalizeManifest(reordered as any);
  assert.equal(canonicalA, canonicalB);
  assert.equal(canonicalA.includes(" "), false);
  assert.deepEqual(api.parseManifest(new TextEncoder().encode(canonicalA)), manifest);
});

test("rejects unknown, duplicate, malformed, mismatched, and URL-bearing manifest fields", () => {
  assert.throws(
    () => api.validateManifest({ ...manifestFor(), artifacts: [{ ...artifactFor(), target: "freebsd-x64" }] }),
    (error: unknown) => assertRuntimeError(error, "INVALID_MANIFEST")
  );
  assert.throws(
    () => api.validateManifest({ ...manifestFor(), artifacts: [artifactFor(), artifactFor()] }),
    (error: unknown) => assertRuntimeError(error, "INVALID_MANIFEST")
  );
  assert.throws(
    () => api.validateManifest({ ...manifestFor(), artifacts: [{ ...artifactFor(), binary: "/tmp/dev-agent-executor" }] }),
    (error: unknown) => assertRuntimeError(error, "INVALID_MANIFEST")
  );
  assert.throws(
    () => api.validateManifest({ ...manifestFor(), artifacts: [{ ...artifactFor(), binary: "nested/../dev-agent-executor" }] }),
    (error: unknown) => assertRuntimeError(error, "INVALID_MANIFEST")
  );
  assert.throws(
    () => api.validateManifest({ ...manifestFor(), artifacts: [{ ...artifactFor(), sha256: "not-a-sha" }] }),
    (error: unknown) => assertRuntimeError(error, "INVALID_MANIFEST")
  );
  assert.throws(
    () => api.validateManifest({ ...manifestFor(), releaseVersion: OTHER_VERSION }, VERSION),
    (error: unknown) => assertRuntimeError(error, "MANIFEST_VERSION_MISMATCH")
  );
  assert.throws(
    () => api.validateManifest({ ...manifestFor(), downloadUrl: "https://evil.example/runtime.tar.gz" }),
    (error: unknown) => assertRuntimeError(error, "INVALID_MANIFEST")
  );
  assert.throws(
    () => api.validateManifest({ ...manifestFor(), artifacts: [{ ...artifactFor(), url: "https://evil.example/runtime.tar.gz" }] }),
    (error: unknown) => assertRuntimeError(error, "INVALID_MANIFEST")
  );
});

test("builds download URLs only from the fixed release repository and artifact filename", () => {
  assert.equal(
    api.getManifestDownloadUrl(VERSION),
    "https://github.com/LJH-snow/dev-agent/releases/download/v0.2.0/dev-agent-runtime-manifest.json"
  );
  assert.equal(
    api.getArtifactDownloadUrl(VERSION, artifactFor()),
    "https://github.com/LJH-snow/dev-agent/releases/download/v0.2.0/dev-agent-executor-aarch64-apple-darwin.tar.gz"
  );
});

test("status and path report missing without network, execution, or half-installed state", async () => {
  const root = await tempRoot();
  let networkCalls = 0;
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    manifestDownloader: async () => {
      networkCalls += 1;
      throw new Error("network must not be used by status/path");
    },
    healthVerifier: async () => {
      throw new Error("health must not be used by status/path");
    },
  });

  const status = await manager.status(VERSION, TARGET);
  assert.equal(status.state, "missing");
  await assert.rejects(() => manager.path(VERSION, TARGET), (error: unknown) => assertRuntimeError(error, "RUNTIME_NOT_INSTALLED"));
  assert.equal(networkCalls, 0);
});

test("status marks incomplete and corrupt cache entries unusable", async () => {
  const root = await tempRoot();
  const manager = new api.RuntimeManager({ runtimeDir: root });
  const paths = api.getRuntimePaths(root, VERSION, TARGET);
  await mkdir(paths.targetDir, { recursive: true });
  await writeFile(paths.binaryPath, "binary", { mode: 0o755 });

  assert.equal((await manager.status(VERSION, TARGET)).state, "corrupt");
  await assert.rejects(() => manager.path(VERSION, TARGET), (error: unknown) => assertRuntimeError(error, "RUNTIME_CORRUPT"));

  await writeFile(paths.installMetadataPath, JSON.stringify({ version: VERSION, target: TARGET }), { mode: 0o600 });
  await writeFile(paths.completePath, "not-json", { mode: 0o600 });
  assert.equal((await manager.status(VERSION, TARGET)).state, "corrupt");
});

test("installs with fixed URLs, checksum, executable bit, health, and atomic completion", async () => {
  const root = await tempRoot();
  const calls: string[] = [];
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies({
      onManifestDownload: (version) => calls.push(`manifest:${version}`),
      onArchiveDownload: (url) => calls.push(`archive:${url}`),
      onHealth: async (binaryPath) => {
        calls.push(`health:${binaryPath}`);
        assert.notEqual((await stat(binaryPath)).mode & 0o111, 0);
      },
    }),
  });

  const result = await manager.install(VERSION);
  assert.equal(result.target, TARGET);
  assert.equal(result.reused, false);
  assert.deepEqual(calls.slice(0, 2), [
    `manifest:${VERSION}`,
    "archive:https://github.com/LJH-snow/dev-agent/releases/download/v0.2.0/dev-agent-executor-aarch64-apple-darwin.tar.gz",
  ]);
  assert.match(calls[2], /health:/);
  assert.equal(await manager.path(VERSION, TARGET), result.binaryPath);
  assert.equal((await stat(result.binaryPath)).isFile(), true);
  assert.notEqual((await stat(result.binaryPath)).mode & 0o111, 0);
  assert.equal((await manager.status(VERSION, TARGET)).state, "installed");
  assert.deepEqual((await readdir(join(root, VERSION, TARGET))).sort(), [
    ".complete",
    "dev-agent-executor",
    "install.json",
  ]);
});

test("installs a runtime from the official release that carries its manifest", async () => {
  const root = await tempRoot();
  const calls: string[] = [];
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies({
      manifest: manifestFor({ releaseVersion: MANIFEST_RELEASE_VERSION }),
      onManifestDownload: (version) => calls.push(`manifest:${version}`),
      onArchiveDownload: (url) => calls.push(`archive:${url}`),
    }),
  });

  const result = await manager.install(VERSION, {
    manifestReleaseVersion: MANIFEST_RELEASE_VERSION,
  });
  assert.deepEqual(calls, [
    `manifest:${MANIFEST_RELEASE_VERSION}`,
    `archive:https://github.com/LJH-snow/dev-agent/releases/download/v${MANIFEST_RELEASE_VERSION}/dev-agent-executor-aarch64-apple-darwin.tar.gz`,
  ]);
  assert.equal(result.binaryPath, api.getRuntimePaths(root, VERSION, TARGET).binaryPath);
  assert.equal((await manager.status(VERSION, TARGET)).state, "installed");
  assert.deepEqual((await readdir(join(root, VERSION, TARGET))).sort(), [
    ".complete",
    "dev-agent-executor",
    "install.json",
  ]);
});

test("rejects checksum errors and removes every temporary artifact", async () => {
  const root = await tempRoot();
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies({ onHash: async () => "b".repeat(64) }),
  });

  await assert.rejects(
    () => manager.install(VERSION),
    (error: unknown) => assertRuntimeError(error, "CHECKSUM_MISMATCH")
  );
  assert.equal((await manager.status(VERSION, TARGET)).state, "missing");
  assert.deepEqual(await readdir(join(root, VERSION)).catch(() => []), []);
});

test("rejects a manifest version mismatch before downloading the archive", async () => {
  const root = await tempRoot();
  let archiveCalls = 0;
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies({
      manifest: manifestFor({ releaseVersion: OTHER_VERSION }),
      onArchiveDownload: () => {
        archiveCalls += 1;
      },
    }),
  });

  await assert.rejects(
    () => manager.install(VERSION),
    (error: unknown) => assertRuntimeError(error, "MANIFEST_VERSION_MISMATCH")
  );
  assert.equal(archiveCalls, 0);
  assert.deepEqual(await readdir(join(root, VERSION)).catch(() => []), []);
});

test("cleans temporary state after extractor, health, or downloader failure", async () => {
  for (const failure of ["extract", "health", "download"]) {
    const root = await tempRoot();
    const manager = new api.RuntimeManager({
      runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
      ...makeInstallDependencies({
        onExtract:
          failure === "extract"
            ? async () => {
                throw new Error("extractor secret=do-not-leak");
              }
            : undefined,
        onHealth:
          failure === "health"
            ? async () => {
                throw new Error("health secret=do-not-leak");
              }
            : undefined,
      }),
      archiveDownloader:
        failure === "download"
          ? async () => {
              throw new Error("download secret=do-not-leak");
            }
          : undefined,
    });

    await assert.rejects(() => manager.install(VERSION), (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.equal((error as { message: string }).message.includes("do-not-leak"), false);
      return true;
    });
    assert.deepEqual(await readdir(join(root, VERSION)).catch(() => []), []);
  }
});

test("rejects a runtime manifest above the fixed 1 MiB download limit", async () => {
  const root = await tempRoot();
  let archiveCalls = 0;
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies({
      onArchiveDownload: () => (archiveCalls += 1),
    }),
    manifestDownloader: async () =>
      JSON.stringify(manifestFor()) + " ".repeat(MANIFEST_DOWNLOAD_LIMIT + 1),
  });

  await assert.rejects(
    () => manager.install(VERSION),
    (error: unknown) => assertRuntimeError(error, "DOWNLOAD_FAILED")
  );
  assert.equal(archiveCalls, 0);
  assert.deepEqual(await readdir(join(root, VERSION)).catch(() => []), []);
});

test("rejects a runtime archive above the fixed 16 MiB download limit", async () => {
  const root = await tempRoot();
  const oversizedArchive = new Uint8Array(ARCHIVE_DOWNLOAD_LIMIT + 1);
  const oversizedManifest = manifestFor({
    artifact: { ...artifactFor(), size: oversizedArchive.byteLength },
  });
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies({ manifest: oversizedManifest }),
    archiveDownloader: async () => oversizedArchive,
  });

  await assert.rejects(
    () => manager.install(VERSION),
    (error: unknown) => assertRuntimeError(error, "DOWNLOAD_FAILED")
  );
  assert.deepEqual(await readdir(join(root, VERSION)).catch(() => []), []);
});

test("streams and bounds an oversized runtime manifest download", async () => {
  const root = await tempRoot();
  const oversizedPayload = Buffer.concat([
    Buffer.from(JSON.stringify(manifestFor())),
    Buffer.alloc(MANIFEST_DOWNLOAD_LIMIT + 1, 0x20),
  ]);
  const oversizedManifest = streamedResponse([oversizedPayload]);
  const normalArchive = streamedResponse([Buffer.from("archive-bytes")]);
  const originalFetch = globalThis.fetch;
  let archiveCalls = 0;

  try {
    globalThis.fetch = (async (url: unknown) => {
      return String(url).includes("/releases/download/v0.2.0/dev-agent-runtime-manifest.json")
        ? oversizedManifest.response
        : normalArchive.response;
    }) as typeof fetch;

    const manager = new api.RuntimeManager({
      runtimeDir: root,
      platform: "darwin",
      arch: "arm64",
      ...makeInstallDependencies({
        onArchiveDownload: () => (archiveCalls += 1),
      }),
      manifestDownloader: undefined,
    });

    await assert.rejects(
      () => manager.install(VERSION),
      (error: unknown) => assertRuntimeError(error, "DOWNLOAD_FAILED")
    );
    assert.equal(oversizedManifest.wasCancelled(), true);
    assert.equal(archiveCalls, 0);
    assert.deepEqual(await readdir(join(root, VERSION)).catch(() => []), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streams and bounds an oversized runtime archive download", async () => {
  const root = await tempRoot();
  const oversizedManifest = manifestFor({
    artifact: { ...artifactFor(), size: ARCHIVE_DOWNLOAD_LIMIT },
  });
  const oversizedArchive = streamedResponse([
    Buffer.alloc(ARCHIVE_DOWNLOAD_LIMIT + 1),
  ]);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (url: unknown) => {
      return String(url).includes("/dev-agent-runtime-manifest.json")
        ? oversizedManifest.response
        : oversizedArchive.response;
    }) as typeof fetch;

    const manager = new api.RuntimeManager({
      runtimeDir: root,
      platform: "darwin",
      arch: "arm64",
      ...makeInstallDependencies(),
      archiveDownloader: undefined,
    });

    await assert.rejects(
      () => manager.install(VERSION),
      (error: unknown) => assertRuntimeError(error, "DOWNLOAD_FAILED")
    );
    assert.equal(oversizedArchive.wasCancelled(), true);
    assert.deepEqual(await readdir(join(root, VERSION)).catch(() => []), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a runtime archive above the fixed 32 MiB decompressed limit", async () => {
  const root = await tempRoot();
  const destination = join(root, "extracted");
  const bomb = gzipSync(Buffer.alloc(DECOMPRESSED_ARCHIVE_LIMIT + 1), { level: 9 });

  await assert.rejects(
    () => archiveModule.extractTarGz(bomb, destination),
    (error: unknown) => {
      assertRuntimeError(error, "ARCHIVE_INVALID");
      assert.match((error as { message?: string }).message ?? "", /32 MiB/);
      return true;
    }
  );
  const destinationExists = await stat(destination).then(() => true).catch(() => false);
  assert.equal(destinationExists, false);
});

test("cancellation cleans temporary state and returns a structured cancellation error", async () => {
  const root = await tempRoot();
  const controller = new AbortController();
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies({
      onExtract: async (_archive, destination) => {
        const artifact = manifestFor().artifacts[0];
        const binaryPath = join(destination, String(artifact.binary));
        await mkdir(join(binaryPath, ".."), { recursive: true });
        await writeFile(binaryPath, "binary", { mode: 0o600 });
        controller.abort();
      },
    }),
  });

  await assert.rejects(
    () => manager.install(VERSION, { signal: controller.signal }),
    (error: unknown) => assertRuntimeError(error, "INSTALL_CANCELLED")
  );
  assert.deepEqual(await readdir(join(root, VERSION)).catch(() => []), []);
});

test("repeated installation is idempotent and does not redownload a complete runtime", async () => {
  const root = await tempRoot();
  let archiveCalls = 0;
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies({ onArchiveDownload: () => (archiveCalls += 1) }),
  });

  const first = await manager.install(VERSION);
  const second = await manager.install(VERSION);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.binaryPath, first.binaryPath);
  assert.equal(archiveCalls, 1);
});

test("marks a runtime with an oversized completion marker as corrupt", async () => {
  const root = await tempRoot();
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies(),
  });

  await manager.install(VERSION);
  const paths = api.getRuntimePaths(root, VERSION, TARGET);
  const marker = await readFile(paths.completePath, "utf8");
  await writeFile(paths.completePath, `${marker}${" ".repeat(COMPLETION_METADATA_READ_LIMIT + 1)}`);

  const status = await manager.status(VERSION, TARGET);
  assert.equal(status.state, "corrupt");
  assert.equal(status.reason, "Runtime metadata is unreadable");
});

test("marks a runtime with oversized install metadata as corrupt", async () => {
  const root = await tempRoot();
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies(),
  });

  await manager.install(VERSION);
  const paths = api.getRuntimePaths(root, VERSION, TARGET);
  const metadata = await readFile(paths.installMetadataPath, "utf8");
  await writeFile(paths.installMetadataPath, `${metadata}${" ".repeat(COMPLETION_METADATA_READ_LIMIT + 1)}`);

  const status = await manager.status(VERSION, TARGET);
  assert.equal(status.state, "corrupt");
  assert.equal(status.reason, "Runtime metadata is unreadable");
});

test("remove is isolated to the requested version and target", async () => {
  const root = await tempRoot();
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies(),
  });
  await manager.install(VERSION, { target: TARGET });
  await manager.install(VERSION, { target: OTHER_TARGET, manifest: manifestFor({ target: OTHER_TARGET }) });
  await manager.install(OTHER_VERSION, { target: TARGET, manifest: manifestFor({ releaseVersion: OTHER_VERSION }) });

  const removed = await manager.remove(VERSION, TARGET);
  assert.equal(removed.removed, true);
  assert.equal((await manager.status(VERSION, TARGET)).state, "missing");
  assert.equal((await manager.status(VERSION, OTHER_TARGET)).state, "installed");
  assert.equal((await manager.status(OTHER_VERSION, TARGET)).state, "installed");
});

test("remove waits for an active installation of the same runtime version", async () => {
  const root = await tempRoot();
  let releaseArchive: ((value: Uint8Array) => void) | undefined;
  let archiveStartedResolve: (() => void) | undefined;
  const archiveStarted = new Promise<void>((resolve) => {
    archiveStartedResolve = resolve;
  });
  const archiveDownload = new Promise<Uint8Array>((resolve) => {
    releaseArchive = resolve;
  });
  const manager = new api.RuntimeManager({
    runtimeDir: root,
    platform: "darwin",
    arch: "arm64",
    ...makeInstallDependencies(),
    archiveDownloader: async () => {
      archiveStartedResolve?.();
      return await archiveDownload;
    },
  });

  try {
    const installPromise = manager.install(VERSION);
    await archiveStarted;
    const removePromise = manager.remove(VERSION, TARGET);
    let removeReturned = false;
    const settled = await Promise.race([
      removePromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    void removePromise.then(() => {
      removeReturned = true;
    });

    assert.equal(settled, false, "remove must wait while install is pending");
    assert.equal(removeReturned, false);

    releaseArchive?.(Buffer.from("archive-bytes"));
    const [installed, removed] = await Promise.all([installPromise, removePromise]);
    assert.equal(installed.reused, false);
    assert.equal(removed.removed, true);
    assert.equal((await manager.status(VERSION, TARGET)).state, "missing");
  } finally {
    releaseArchive?.(Buffer.from("archive-bytes"));
  }
});
