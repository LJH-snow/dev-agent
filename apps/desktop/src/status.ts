import { isAbsolute } from "node:path";

import type { ExecutorMode } from "@dev-agent/executor";
import type { ModelProviderId } from "@dev-agent/model";
import type { ValidationPolicy } from "@dev-agent/tools";

import type { DesktopApprovalMode } from "./chat-session.js";

export const DESKTOP_STATUS_SCHEMA_VERSION = 1 as const;

export type DesktopStatusExecutorMode = ExecutorMode | "unknown";
export type DesktopStatusProviderId = ModelProviderId | "unknown";
export type DesktopStatusApprovalMode = DesktopApprovalMode | "unknown";
export type DesktopStatusValidationPolicy = ValidationPolicy | "unknown";
export type DesktopStatusValidationResult = "passed" | "failed" | "skipped" | "blocked" | "unknown";

export interface DesktopStatusSnapshot {
  readonly schemaVersion: typeof DESKTOP_STATUS_SCHEMA_VERSION;
  readonly metadataOnly: true;
  readonly session: {
    readonly id: string;
    readonly running: boolean;
  };
  readonly executor: {
    readonly mode: DesktopStatusExecutorMode;
  };
  readonly runtime: {
    readonly kind: "node";
    readonly version: string;
    readonly platform: string;
  };
  readonly provider: {
    readonly id: DesktopStatusProviderId;
    readonly state: "ready" | "unknown";
  };
  readonly model: {
    readonly id: string;
    readonly state: "ready" | "unknown";
  };
  readonly approval: {
    readonly mode: DesktopStatusApprovalMode;
    readonly guarded: boolean;
  };
  readonly validation: {
    readonly policy: DesktopStatusValidationPolicy;
    readonly enabled: boolean;
    readonly lastResult: DesktopStatusValidationResult;
  };
}

export interface DesktopStatusOptions {
  readonly sessionId?: string;
  readonly running?: boolean;
  readonly executorMode?: ExecutorMode;
  readonly providerId?: ModelProviderId;
  readonly model?: string;
  readonly approvalMode?: DesktopApprovalMode;
  readonly validationPolicy?: ValidationPolicy;
  readonly validationResult?: DesktopStatusValidationResult;
  readonly nodeVersion?: string;
  readonly platform?: string;
}

const providerIds: readonly DesktopStatusProviderId[] = ["ollama", "openai", "anthropic", "gemini", "unknown"];
const executorModes: readonly DesktopStatusExecutorMode[] = [
  "local",
  "sandboxed-macos",
  "sandboxed-linux",
  "unsupported",
  "unknown",
];
const approvalModes: readonly DesktopStatusApprovalMode[] = [
  "allow",
  "deny-dangerous",
  "ask",
  "review-writes",
  "unknown",
];
const validationPolicies: readonly DesktopStatusValidationPolicy[] = ["fast", "default", "strict", "unknown"];
const runtimePlatforms = new Set([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "openbsd",
  "sunos",
  "win32",
]);

/**
 * Builds the public desktop status payload. This is intentionally an
 * allowlisted metadata surface: it never accepts or returns keys, paths,
 * source text, command arguments, or raw error details.
 */
export function createDesktopStatus(options: DesktopStatusOptions = {}): DesktopStatusSnapshot {
  const providerId = allowlisted(options.providerId, providerIds, "unknown");
  const executorMode = allowlisted(options.executorMode, executorModes, "unknown");
  const approvalMode = allowlisted(options.approvalMode, approvalModes, "unknown");
  const validationPolicy = allowlisted(options.validationPolicy, validationPolicies, "unknown");
  const validationResult = allowlisted(
    options.validationResult,
    ["passed", "failed", "skipped", "blocked", "unknown"] as const,
    "unknown"
  );
  const model = safeModelLabel(options.model);
  const sessionId = safeSessionId(options.sessionId);

  return {
    schemaVersion: DESKTOP_STATUS_SCHEMA_VERSION,
    metadataOnly: true,
    session: {
      id: sessionId,
      running: options.running === true,
    },
    executor: { mode: executorMode },
    runtime: {
      kind: "node",
      version: safeRuntimeVersion(options.nodeVersion ?? process.version),
      platform: safeRuntimePlatform(options.platform ?? process.platform),
    },
    provider: {
      id: providerId,
      state: providerId === "unknown" ? "unknown" : "ready",
    },
    model: {
      id: model,
      state: model === "unknown" || model === "redacted" ? "unknown" : "ready",
    },
    approval: {
      mode: approvalMode,
      guarded: approvalMode !== "allow" && approvalMode !== "unknown",
    },
    validation: {
      policy: validationPolicy,
      enabled: validationPolicy !== "unknown",
      lastResult: validationResult,
    },
  };
}

/** Adds the current server-side running bit without changing static metadata. */
export function withDesktopStatusSession(
  status: DesktopStatusSnapshot,
  sessionId: string,
  running: boolean
): DesktopStatusSnapshot {
  return {
    ...status,
    session: {
      id: safeSessionId(sessionId),
      running,
    },
  };
}

function allowlisted<T extends string>(value: T | undefined, allowed: readonly T[], fallback: T): T {
  return value !== undefined && allowed.includes(value) ? value : fallback;
}

function safeSessionId(value: string | undefined): string {
  if (typeof value !== "string") {
    return "desktop-default";
  }
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized.replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "desktop-default";
}

function safeModelLabel(value: string | undefined): string {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim().replace(/[\u0000\r\n\t]/g, " ");
  if (!normalized || normalized.length > 128) {
    return "unknown";
  }
  if (
    isAbsolute(normalized) ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    /^\\\\/.test(normalized) ||
    /(?:api[-_ ]?key|access[-_ ]?token|password|secret|bearer|sk-[a-z0-9])/i.test(normalized)
  ) {
    return "redacted";
  }
  return normalized;
}

function safeRuntimeVersion(value: string): string {
  return /^v\d+(?:\.\d+){1,2}(?:[-+][a-z0-9.-]+)?$/i.test(value) ? value : "unknown";
}

function safeRuntimePlatform(value: string): string {
  return runtimePlatforms.has(value) ? value : "unknown";
}
