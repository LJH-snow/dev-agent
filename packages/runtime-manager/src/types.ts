export const SUPPORTED_TARGETS = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu",
] as const;

export type RuntimeTarget = (typeof SUPPORTED_TARGETS)[number];
export type RuntimeOs = "darwin" | "linux";
export type RuntimeArch = "arm64" | "x64";
export type RuntimeLibc = "none" | "glibc" | "musl" | "unknown";

export interface TargetInput {
  readonly platform?: NodeJS.Platform | string;
  readonly arch?: string;
  readonly libc?: RuntimeLibc;
}

export interface SupportedTargetResolution {
  readonly supported: true;
  readonly target: RuntimeTarget;
  readonly os: RuntimeOs;
  readonly arch: RuntimeArch;
  readonly libc: "none" | "glibc";
}

export interface UnsupportedTargetResolution {
  readonly supported: false;
  readonly code: "UNSUPPORTED_PLATFORM";
  readonly platform: string;
  readonly arch: string;
  readonly libc: RuntimeLibc;
  readonly reason: string;
}

export type TargetResolution = SupportedTargetResolution | UnsupportedTargetResolution;

export interface RuntimeArtifact {
  readonly target: RuntimeTarget;
  readonly os: RuntimeOs;
  readonly arch: RuntimeArch;
  readonly libc: "none" | "glibc";
  readonly archive: string;
  /** Relative path inside the archive. This is never a download URL. */
  readonly binary: string;
  readonly sha256: string;
  readonly size: number;
}

export interface RuntimeManifest {
  readonly schemaVersion: 1;
  readonly product: "dev-agent";
  readonly runtime: "dev-agent-executor";
  readonly releaseVersion: string;
  readonly releaseTag: string;
  readonly repository: "LJH-snow/dev-agent";
  readonly protocolVersion: number;
  readonly artifacts: readonly RuntimeArtifact[];
}

export interface RuntimePaths {
  readonly root: string;
  readonly versionDir: string;
  readonly targetDir: string;
  readonly binaryPath: string;
  readonly installMetadataPath: string;
  readonly completePath: string;
}

export type RuntimeStatusState = "unsupported" | "missing" | "installed" | "corrupt";

export interface RuntimeStatus {
  readonly state: RuntimeStatusState;
  readonly version: string;
  readonly target?: RuntimeTarget;
  readonly binaryPath?: string;
  readonly reason?: string;
}

export type ManifestPayload =
  | string
  | Uint8Array
  | Readonly<Record<string, unknown>>;

export type ManifestDownloader = (
  version: string,
  signal?: AbortSignal
) => Promise<ManifestPayload>;

export type ArchiveDownloader = (
  url: string,
  signal?: AbortSignal
) => Promise<Uint8Array>;

export type HashVerifier = (filePath: string) => Promise<string>;

export type HealthVerifier = (
  binaryPath: string,
  signal?: AbortSignal
) => Promise<void>;

export type ArchiveExtractor = (
  archive: Uint8Array,
  destination: string
) => Promise<void>;

export interface RuntimeManagerOptions {
  readonly home?: string;
  readonly runtimeDir?: string;
  readonly platform?: NodeJS.Platform | string;
  readonly arch?: string;
  readonly libc?: RuntimeLibc;
  readonly manifestDownloader?: ManifestDownloader;
  readonly archiveDownloader?: ArchiveDownloader;
  readonly hashVerifier?: HashVerifier;
  readonly healthVerifier?: HealthVerifier;
  readonly archiveExtractor?: ArchiveExtractor;
}

export interface InstallOptions {
  readonly target?: RuntimeTarget;
  readonly manifest?: RuntimeManifest | ManifestPayload;
  readonly signal?: AbortSignal;
}

export interface InstallResult {
  readonly version: string;
  readonly target: RuntimeTarget;
  readonly binaryPath: string;
  readonly reused: boolean;
}

export interface RemoveResult {
  readonly version: string;
  readonly target?: RuntimeTarget;
  readonly removed: boolean;
  readonly removedPaths: readonly string[];
}
