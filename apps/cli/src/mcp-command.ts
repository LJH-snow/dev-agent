import type {
  McpClientConfig,
  McpServerCapabilities,
  McpServerInfo,
} from "@dev-agent/mcp";

const DEFAULT_MCP_TIMEOUT_MS = 30_000;
const MCP_FIELDS = new Set(["name", "command", "args", "env", "timeoutMs"]);
const CAPABILITY_FIELDS = [
  "tools",
  "resources",
  "prompts",
  "logging",
  "roots",
  "sampling",
  "experimental",
  "toolCount",
  "resourceCount",
  "promptCount",
] as const;
const ABSOLUTE_PATH_PATTERN = /[\\/]|^~(?:$|[\\/])|^[A-Za-z]:/;
const REDACTED_PATH = "<redacted-path>";

type ExtendedMcpServerCapabilities = McpServerCapabilities & {
  readonly roots?: unknown;
  readonly sampling?: unknown;
};

export interface McpManagementConfig {
  readonly mcpServers?: readonly unknown[];
}

export type McpCommandAction = "list" | "status" | "validate" | "test";
export type McpCommandName = `mcp ${McpCommandAction}`;

export type McpServerState =
  | "configured"
  | "invalid"
  | "skipped"
  | "ready"
  | "timeout"
  | "failed"
  | "changed";

export type McpManagementReason =
  | "no_servers"
  | "invalid_config"
  | "probe_not_configured"
  | "timeout"
  | "connection_failed"
  | "capability_changed"
  | "probe_failed"
  | "cancelled";

export interface McpCapabilitySummary {
  readonly tools: boolean;
  readonly resources: boolean;
  readonly prompts: boolean;
  readonly logging: boolean;
  readonly roots: boolean;
  readonly sampling: boolean;
  readonly experimental: boolean;
  readonly toolCount: number;
  readonly resourceCount: number;
  readonly promptCount: number;
}

export interface McpCapabilityChange {
  readonly changed: boolean;
  readonly fields: readonly (typeof CAPABILITY_FIELDS[number])[];
}

export interface McpServerInfoSummary {
  readonly name: string;
  readonly version: string | null;
}

export interface McpServerMetadata {
  readonly name: string;
  readonly state: McpServerState;
  readonly reason: McpManagementReason | null;
  readonly commandConfigured: boolean;
  readonly argumentCount: number;
  readonly environmentVariableCount: number;
  readonly timeoutMs: number;
  readonly latencyMs: number | null;
  readonly capabilities: McpCapabilitySummary | null;
  readonly serverInfo: McpServerInfoSummary | null;
  readonly capabilityChange: McpCapabilityChange | null;
  readonly validationCodes: readonly string[];
}

export interface McpServerSummary {
  readonly total: number;
  readonly ready: number;
  readonly configured: number;
  readonly invalid: number;
  readonly skipped: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly changed: number;
}

export interface McpManagementResult {
  readonly ok: boolean;
  readonly command: McpCommandName;
  readonly status: "ok" | "empty" | "invalid" | "skipped" | "failed" | "degraded";
  readonly reason: McpManagementReason | null;
  readonly servers: readonly McpServerMetadata[];
  readonly summary: McpServerSummary;
}

export interface McpProbeContext {
  /** The original config is available only to an injected connector/probe. */
  readonly server: McpClientConfig;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface McpProbeCounts {
  readonly tools?: number;
  readonly resources?: number;
  readonly prompts?: number;
}

export interface McpProbeSnapshot {
  readonly serverInfo?: Partial<McpServerInfo>;
  readonly capabilities?: McpServerCapabilities;
  readonly counts?: McpProbeCounts;
  /** Optional raw list shapes make adapters easy to write without being returned. */
  readonly tools?: readonly unknown[];
  readonly resources?: readonly unknown[];
  readonly prompts?: readonly unknown[];
}

export interface McpProbeResult {
  readonly ok?: boolean;
  readonly snapshot?: McpProbeSnapshot;
  /** This value is mapped to a stable reason and is never returned verbatim. */
  readonly reason?: string;
}

export type McpProbeResponse = McpProbeSnapshot | McpProbeResult;
export type McpProbe = (
  context: McpProbeContext
) => McpProbeResponse | Promise<McpProbeResponse>;

export interface McpManagementOptions {
  readonly config?: McpManagementConfig;
  /** A connector takes precedence over a probe and is never created by default. */
  readonly connector?: McpProbe;
  /** A probe takes precedence over no probe and is never created by default. */
  readonly probe?: McpProbe;
  readonly capabilityBaselines?: Readonly<Record<string, McpCapabilitySummary>>;
  readonly signal?: AbortSignal;
  /** Injected clock for deterministic callers and tests. */
  readonly now?: () => number;
}

interface NormalizedServer {
  readonly index: number;
  readonly displayName: string;
  readonly config: McpClientConfig;
  readonly valid: boolean;
  readonly validationCodes: readonly string[];
  readonly rawName?: string;
}

interface ProbeOutcome {
  readonly state: "ready" | "timeout" | "failed" | "changed";
  readonly reason: McpManagementReason | null;
  readonly latencyMs: number | null;
  readonly capabilities: McpCapabilitySummary | null;
  readonly serverInfo: McpServerInfoSummary | null;
  readonly capabilityChange: McpCapabilityChange | null;
}

const TIMEOUT = Symbol("mcp-timeout");
const ABORTED = Symbol("mcp-aborted");

export function listMcpServers(options: McpManagementOptions = {}): McpManagementResult {
  const normalized = normalizeServers(options.config);
  const servers = normalized.map((server) => metadataFor(server, server.valid ? "configured" : "invalid"));
  return createResult("mcp list", servers, "list");
}

export function validateMcpServers(options: McpManagementOptions = {}): McpManagementResult {
  const normalized = normalizeServers(options.config);
  const servers = normalized.map((server) => metadataFor(server, server.valid ? "configured" : "invalid"));
  return createResult("mcp validate", servers, "validate");
}

export async function statusMcpServers(
  options: McpManagementOptions = {}
): Promise<McpManagementResult> {
  return inspectMcpServers("mcp status", options);
}

export async function testMcpServers(
  options: McpManagementOptions = {}
): Promise<McpManagementResult> {
  return inspectMcpServers("mcp test", options);
}

export async function executeMcpCommand(
  action: McpCommandAction,
  options: McpManagementOptions = {}
): Promise<McpManagementResult> {
  switch (action) {
    case "list":
      return listMcpServers(options);
    case "validate":
      return validateMcpServers(options);
    case "status":
      return statusMcpServers(options);
    case "test":
      return testMcpServers(options);
  }
}

async function inspectMcpServers(
  command: "mcp status" | "mcp test",
  options: McpManagementOptions
): Promise<McpManagementResult> {
  const normalized = normalizeServers(options.config);
  if (normalized.length === 0) {
    return createResult(command, [], "inspect");
  }

  const checker = options.connector ?? options.probe;
  const servers: McpServerMetadata[] = [];
  for (const server of normalized) {
    if (!server.valid) {
      servers.push(metadataFor(server, "invalid"));
      continue;
    }
    if (!checker) {
      servers.push({
        ...metadataFor(server, "skipped"),
        reason: "probe_not_configured",
      });
      continue;
    }

    const outcome = await runProbe(server, checker, options);
    servers.push({
      ...metadataFor(server, outcome.state),
      reason: outcome.reason,
      latencyMs: outcome.latencyMs,
      capabilities: outcome.capabilities,
      serverInfo: outcome.serverInfo,
      capabilityChange: outcome.capabilityChange,
    });
  }
  return createResult(command, servers, "inspect");
}

function normalizeServers(config: McpManagementConfig | undefined): NormalizedServer[] {
  const rawServers = config?.mcpServers;
  if (rawServers === undefined) {
    return [];
  }
  if (!Array.isArray(rawServers)) {
    return [invalidSyntheticServer("mcp-servers", 0, ["invalid_type"])];
  }

  return rawServers.map((raw, index) => normalizeServer(raw, index));
}

function normalizeServer(raw: unknown, index: number): NormalizedServer {
  const fallbackName = `mcp-${index + 1}`;
  if (!isPlainRecord(raw)) {
    return invalidSyntheticServer(fallbackName, index, ["invalid_type"]);
  }

  const validationCodes: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!MCP_FIELDS.has(key)) {
      validationCodes.push("unknown_field");
    }
  }

  const command = raw.command;
  if (typeof command !== "string") {
    validationCodes.push("missing_or_invalid_command");
  } else if (command.trim() === "") {
    validationCodes.push("invalid_command");
  }

  let name: string | undefined;
  let rawName: string | undefined;
  if (raw.name !== undefined) {
    if (typeof raw.name !== "string") {
      validationCodes.push("invalid_name");
    } else if (raw.name.trim() === "") {
      validationCodes.push("invalid_name");
    } else {
      rawName = raw.name;
      name = safeLabel(raw.name, fallbackName);
    }
  }

  const args = raw.args;
  if (args !== undefined && (!Array.isArray(args) || !args.every((entry) => typeof entry === "string"))) {
    validationCodes.push("invalid_args");
  }

  const env = raw.env;
  if (env !== undefined && (!isPlainRecord(env) || !Object.values(env).every((value) => typeof value === "string"))) {
    validationCodes.push("invalid_env");
  }

  const timeoutMs = raw.timeoutMs;
  if (timeoutMs !== undefined && !isPositiveSafeInteger(timeoutMs)) {
    validationCodes.push("invalid_timeout");
  }

  const valid = validationCodes.length === 0;
  const clientConfig: McpClientConfig = {
    name: name ?? fallbackName,
    command: typeof command === "string" ? command : "",
    args: Array.isArray(args) && args.every((entry) => typeof entry === "string")
      ? args as string[]
      : undefined,
    env: isPlainRecord(env) && Object.values(env).every((value) => typeof value === "string")
      ? env as Record<string, string>
      : undefined,
    timeoutMs: isPositiveSafeInteger(timeoutMs) ? timeoutMs : DEFAULT_MCP_TIMEOUT_MS,
  };

  return {
    index,
    displayName: name ?? fallbackName,
    rawName,
    config: clientConfig,
    valid,
    validationCodes: stableUnique(validationCodes),
  };
}

function invalidSyntheticServer(
  displayName: string,
  index: number,
  validationCodes: readonly string[]
): NormalizedServer {
  return {
    index,
    displayName: safeLabel(displayName, `mcp-${index + 1}`),
    config: {
      name: displayName,
      command: "",
      timeoutMs: DEFAULT_MCP_TIMEOUT_MS,
    },
    valid: false,
    validationCodes,
  };
}

function metadataFor(
  server: NormalizedServer,
  state: McpServerState,
  reason: McpManagementReason | null = null
): McpServerMetadata {
  const args = server.config.args;
  const env = server.config.env;
  return {
    name: server.displayName,
    state,
    reason,
    commandConfigured: server.config.command.trim().length > 0,
    argumentCount: args?.length ?? 0,
    environmentVariableCount: env ? Object.keys(env).length : 0,
    timeoutMs: server.config.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
    latencyMs: null,
    capabilities: null,
    serverInfo: null,
    capabilityChange: null,
    validationCodes: server.validationCodes,
  };
}

async function runProbe(
  server: NormalizedServer,
  checker: McpProbe,
  options: McpManagementOptions
): Promise<ProbeOutcome> {
  const timeoutMs = server.config.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
  const startedAt = options.now?.() ?? Date.now();
  if (options.signal?.aborted) {
    return {
      state: "failed",
      reason: "cancelled",
      latencyMs: 0,
      capabilities: null,
      serverInfo: null,
      capabilityChange: null,
    };
  }
  const controller = new AbortController();
  let removeAbortListener: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      const abort = () => controller.abort();
      options.signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => options.signal?.removeEventListener("abort", abort);
    }
  }

  try {
    const response = await Promise.race([
      Promise.resolve(checker({ server: server.config, timeoutMs, signal: controller.signal })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(TIMEOUT);
        }, timeoutMs);
      }),
      new Promise<never>((_, reject) => {
        const check = (): void => {
          if (controller.signal.aborted) {
            reject(options.signal?.aborted ? ABORTED : TIMEOUT);
          }
        };
        if (controller.signal.aborted) {
          check();
        } else {
          controller.signal.addEventListener("abort", check, { once: true });
        }
      }),
    ]);

    const latencyMs = Math.max(0, (options.now?.() ?? Date.now()) - startedAt);
    const normalized = normalizeProbeResponse(response);
    if (!normalized.ok) {
      return {
        state: normalized.reason === "timeout" ? "timeout" : "failed",
        reason: normalized.reason,
        latencyMs,
        capabilities: null,
        serverInfo: null,
        capabilityChange: null,
      };
    }

    const capabilities = summarizeCapabilities(normalized.snapshot);
    const serverInfo = sanitizeServerInfo(normalized.snapshot.serverInfo);
    const capabilityChange = compareCapabilities(
      capabilities,
      server.rawName ?? server.displayName,
      options.capabilityBaselines
    );
    if (capabilityChange?.changed) {
      return {
        state: "changed",
        reason: "capability_changed",
        latencyMs,
        capabilities,
        serverInfo,
        capabilityChange,
      };
    }
    return {
      state: "ready",
      reason: null,
      latencyMs,
      capabilities,
      serverInfo,
      capabilityChange,
    };
  } catch (error) {
    const latencyMs = Math.max(0, (options.now?.() ?? Date.now()) - startedAt);
    const reason = error === TIMEOUT
      ? "timeout"
      : error === ABORTED
        ? "cancelled"
        : "connection_failed";
    return {
      state: reason === "timeout" ? "timeout" : "failed",
      reason,
      latencyMs,
      capabilities: null,
      serverInfo: null,
      capabilityChange: null,
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    removeAbortListener?.();
    controller.abort();
  }
}

function normalizeProbeResponse(response: McpProbeResponse):
  | { readonly ok: true; readonly snapshot: McpProbeSnapshot }
  | { readonly ok: false; readonly reason: McpManagementReason } {
  if (!isPlainRecord(response)) {
    return { ok: false, reason: "connection_failed" };
  }

  const record = response as Record<string, unknown>;
  const hasExplicitOk = typeof record.ok === "boolean";
  if (hasExplicitOk && record.ok === false) {
    return { ok: false, reason: normalizeFailureReason(record.reason) };
  }

  const snapshot = isPlainRecord(record.snapshot)
    ? record.snapshot as McpProbeSnapshot
    : response as McpProbeSnapshot;
  return { ok: true, snapshot };
}

function normalizeFailureReason(value: unknown): McpManagementReason {
  switch (value) {
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    case "capability_changed":
      return "capability_changed";
    case "probe_failed":
      return "probe_failed";
    default:
      return "connection_failed";
  }
}

function summarizeCapabilities(snapshot: McpProbeSnapshot): McpCapabilitySummary {
  const capabilities = (snapshot.capabilities ?? {}) as ExtendedMcpServerCapabilities;
  return {
    tools: capabilities.tools !== undefined,
    resources: capabilities.resources !== undefined,
    prompts: capabilities.prompts !== undefined,
    logging: capabilities.logging !== undefined,
    roots: capabilities.roots !== undefined,
    sampling: capabilities.sampling !== undefined,
    experimental: capabilities.experimental !== undefined,
    toolCount: resolveCount(snapshot.counts?.tools, snapshot.tools),
    resourceCount: resolveCount(snapshot.counts?.resources, snapshot.resources),
    promptCount: resolveCount(snapshot.counts?.prompts, snapshot.prompts),
  };
}

function resolveCount(value: number | undefined, entries: readonly unknown[] | undefined): number {
  if (isNonNegativeSafeInteger(value)) {
    return value;
  }
  return entries?.length ?? 0;
}

function sanitizeServerInfo(info: Partial<McpServerInfo> | undefined): McpServerInfoSummary | null {
  if (!info || typeof info !== "object") {
    return null;
  }
  const name = typeof info.name === "string" ? safeLabel(info.name, REDACTED_PATH) : REDACTED_PATH;
  const version = typeof info.version === "string" ? sanitizeVersion(info.version) : null;
  return { name, version };
}

function sanitizeVersion(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || ABSOLUTE_PATH_PATTERN.test(trimmed) || trimmed.length > 64) {
    return "<redacted>";
  }
  return /^[A-Za-z0-9._+\-]+$/.test(trimmed) ? trimmed : "<redacted>";
}

function compareCapabilities(
  current: McpCapabilitySummary,
  key: string,
  baselines: Readonly<Record<string, McpCapabilitySummary>> | undefined
): McpCapabilityChange | null {
  if (!baselines) {
    return null;
  }
  const baseline = baselines[key];
  if (!baseline) {
    return null;
  }
  const fields = CAPABILITY_FIELDS.filter((field) => current[field] !== baseline[field]);
  return { changed: fields.length > 0, fields };
}

function createResult(
  command: McpCommandName,
  servers: readonly McpServerMetadata[],
  mode: "list" | "validate" | "inspect"
): McpManagementResult {
  const summary = summarizeServers(servers);
  if (summary.total === 0) {
    return {
      ok: true,
      command,
      status: "empty",
      reason: "no_servers",
      servers: [],
      summary,
    };
  }

  if (summary.invalid > 0 && mode !== "list") {
    return {
      ok: false,
      command,
      status: "invalid",
      reason: "invalid_config",
      servers,
      summary,
    };
  }

  if (mode === "list" || mode === "validate") {
    return {
      ok: summary.invalid === 0,
      command,
      status: summary.invalid > 0 ? "invalid" : "ok",
      reason: summary.invalid > 0 ? "invalid_config" : null,
      servers,
      summary,
    };
  }

  if (summary.changed > 0) {
    return {
      ok: false,
      command,
      status: "degraded",
      reason: "capability_changed",
      servers,
      summary,
    };
  }
  if (summary.timedOut > 0) {
    return {
      ok: false,
      command,
      status: "failed",
      reason: "timeout",
      servers,
      summary,
    };
  }
  if (summary.failed > 0) {
    const reason = servers.find((server) => server.state === "failed")?.reason ?? "connection_failed";
    return {
      ok: false,
      command,
      status: "failed",
      reason,
      servers,
      summary,
    };
  }
  if (summary.skipped > 0) {
    return {
      ok: true,
      command,
      status: "skipped",
      reason: "probe_not_configured",
      servers,
      summary,
    };
  }
  return {
    ok: true,
    command,
    status: "ok",
    reason: null,
    servers,
    summary,
  };
}

function summarizeServers(servers: readonly McpServerMetadata[]): McpServerSummary {
  return {
    total: servers.length,
    ready: servers.filter((server) => server.state === "ready").length,
    configured: servers.filter((server) => server.state === "configured").length,
    invalid: servers.filter((server) => server.state === "invalid").length,
    skipped: servers.filter((server) => server.state === "skipped").length,
    failed: servers.filter((server) => server.state === "failed").length,
    timedOut: servers.filter((server) => server.state === "timeout").length,
    changed: servers.filter((server) => server.state === "changed").length,
  };
}

function safeLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed || ABSOLUTE_PATH_PATTERN.test(trimmed)) {
    return fallback;
  }
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 79)}…`;
}

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
