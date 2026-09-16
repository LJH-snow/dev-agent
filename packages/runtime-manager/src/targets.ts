import { SUPPORTED_TARGETS } from "./types.js";
import type {
  RuntimeArch,
  RuntimeLibc,
  RuntimeOs,
  RuntimeTarget,
  SupportedTargetResolution,
  TargetInput,
  TargetResolution,
  UnsupportedTargetResolution,
} from "./types.js";

const TARGET_INFO: Record<RuntimeTarget, SupportedTargetResolution> = {
  "aarch64-apple-darwin": {
    supported: true,
    target: "aarch64-apple-darwin",
    os: "darwin",
    arch: "arm64",
    libc: "none",
  },
  "x86_64-apple-darwin": {
    supported: true,
    target: "x86_64-apple-darwin",
    os: "darwin",
    arch: "x64",
    libc: "none",
  },
  "aarch64-unknown-linux-gnu": {
    supported: true,
    target: "aarch64-unknown-linux-gnu",
    os: "linux",
    arch: "arm64",
    libc: "glibc",
  },
  "x86_64-unknown-linux-gnu": {
    supported: true,
    target: "x86_64-unknown-linux-gnu",
    os: "linux",
    arch: "x64",
    libc: "glibc",
  },
};

export function getTargetInfo(target: RuntimeTarget): SupportedTargetResolution {
  return { ...TARGET_INFO[target] };
}

export function isRuntimeTarget(value: unknown): value is RuntimeTarget {
  return typeof value === "string" && (SUPPORTED_TARGETS as readonly string[]).includes(value);
}

function detectLinuxLibc(): RuntimeLibc {
  try {
    const report = process.report?.getReport?.() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    if (report?.header?.glibcVersionRuntime) return "glibc";
  } catch {
    // An unavailable process report is treated as unknown, never as glibc.
  }
  return "unknown";
}

function unsupported(
  platform: string,
  arch: string,
  libc: RuntimeLibc,
  reason: string
): UnsupportedTargetResolution {
  return { supported: false, code: "UNSUPPORTED_PLATFORM", platform, arch, libc, reason };
}

export function resolveTarget(input: TargetInput = {}): TargetResolution {
  const platform = String(input.platform ?? process.platform);
  const arch = String(input.arch ?? process.arch);

  if (platform === "darwin") {
    if (arch !== "arm64" && arch !== "x64") {
      return unsupported(platform, arch, input.libc ?? "none", `Unsupported macOS architecture: ${arch}`);
    }
    if (input.libc !== undefined && input.libc !== "none") {
      return unsupported(platform, arch, input.libc, `Unsupported macOS libc: ${input.libc}`);
    }
    const target = arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    return getTargetInfo(target);
  }

  if (platform === "linux") {
    const libc = input.libc ?? detectLinuxLibc();
    if (libc !== "glibc") {
      return unsupported(platform, arch, libc, `Linux runtime requires glibc; detected ${libc}`);
    }
    if (arch !== "arm64" && arch !== "x64") {
      return unsupported(platform, arch, libc, `Unsupported Linux architecture: ${arch}`);
    }
    const target = arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
    return getTargetInfo(target);
  }

  return unsupported(platform, arch, input.libc ?? "unknown", `Unsupported platform: ${platform}`);
}

export function targetResolutionFor(target: RuntimeTarget): SupportedTargetResolution {
  return getTargetInfo(target);
}

export function targetParts(target: RuntimeTarget): {
  readonly os: RuntimeOs;
  readonly arch: RuntimeArch;
  readonly libc: "none" | "glibc";
} {
  const info = TARGET_INFO[target];
  return { os: info.os, arch: info.arch, libc: info.libc };
}
