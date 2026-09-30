export const MCP_HEALTH_SCHEMA_VERSION = 1 as const;
export const MAX_MCP_HEALTH_SERVERS = 64;
export const MAX_MCP_HEALTH_NAME_CHARS = 64;
export const MAX_MCP_HEALTH_COUNT = 10_000;
export const MAX_MCP_HEALTH_LATENCY_MS = 60_000;

export type McpHealthState = "connected" | "degraded" | "disconnected";
export type McpHealthError = "not-connected" | "connect-failed" | "ping-timeout" | "ping-failed";

export interface McpHealthServerSnapshot {
  readonly name: string;
  readonly state: McpHealthState;
  readonly tools: number;
  readonly resources: number;
  readonly prompts: number;
  readonly latencyMs?: number;
  readonly lastCheckedAt?: string;
  readonly error?: McpHealthError;
}

export interface McpHealthSnapshot {
  readonly schemaVersion: typeof MCP_HEALTH_SCHEMA_VERSION;
  readonly metadataOnly: true;
  readonly configured: number;
  readonly connected: number;
  readonly degraded: number;
  readonly checkedAt?: string;
  readonly servers: readonly McpHealthServerSnapshot[];
}

export interface McpHealthServerInput {
  readonly name: string;
  readonly state: McpHealthState;
  readonly tools?: number;
  readonly resources?: number;
  readonly prompts?: number;
  readonly latencyMs?: number;
  readonly lastCheckedAt?: string;
  readonly error?: McpHealthError;
}

export function createMcpHealthSnapshot(
  servers: readonly McpHealthServerInput[] = [],
  checkedAt?: string,
): McpHealthSnapshot {
  const normalizedServers = normalizeServers(servers);
  const safeCheckedAt = normalizeTimestamp(checkedAt);
  return {
    schemaVersion: MCP_HEALTH_SCHEMA_VERSION,
    metadataOnly: true,
    configured: normalizedServers.length,
    connected: normalizedServers.filter((server) => server.state === "connected").length,
    degraded: normalizedServers.filter((server) => server.state === "degraded").length,
    ...(safeCheckedAt === undefined ? {} : { checkedAt: safeCheckedAt }),
    servers: normalizedServers,
  };
}

export function normalizeMcpHealthSnapshot(value: unknown): McpHealthSnapshot {
  if (!isRecord(value)) {
    return createMcpHealthSnapshot();
  }
  const rawServers = Array.isArray(value.servers) ? value.servers : [];
  const servers: McpHealthServerInput[] = [];
  for (const raw of rawServers.slice(0, MAX_MCP_HEALTH_SERVERS)) {
    if (!isRecord(raw) || typeof raw.name !== "string") continue;
    const state = normalizeState(raw.state);
    if (!state) continue;
    servers.push({
      name: raw.name,
      state,
      tools: typeof raw.tools === "number" ? raw.tools : undefined,
      resources: typeof raw.resources === "number" ? raw.resources : undefined,
      prompts: typeof raw.prompts === "number" ? raw.prompts : undefined,
      latencyMs: typeof raw.latencyMs === "number" ? raw.latencyMs : undefined,
      lastCheckedAt: typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : undefined,
      error: normalizeError(raw.error),
    });
  }
  return createMcpHealthSnapshot(servers, typeof value.checkedAt === "string" ? value.checkedAt : undefined);
}

function normalizeServers(input: readonly McpHealthServerInput[]): McpHealthServerSnapshot[] {
  const result: McpHealthServerSnapshot[] = [];
  const seen = new Set<string>();
  for (const server of input.slice(0, MAX_MCP_HEALTH_SERVERS)) {
    const name = normalizeName(server.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const state = normalizeState(server.state) ?? "disconnected";
    const error = normalizeError(server.error);
    result.push({
      name,
      state,
      tools: safeCount(server.tools),
      resources: safeCount(server.resources),
      prompts: safeCount(server.prompts),
      ...(safeLatency(server.latencyMs) === undefined ? {} : { latencyMs: safeLatency(server.latencyMs) }),
      ...(normalizeTimestamp(server.lastCheckedAt) === undefined ? {} : { lastCheckedAt: normalizeTimestamp(server.lastCheckedAt) }),
      ...(error === undefined ? {} : { error }),
    });
  }
  return result;
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (
    !normalized
    || normalized.length > MAX_MCP_HEALTH_NAME_CHARS
    || normalized.includes("/")
    || normalized.includes("\\")
    || normalized.includes("..")
    || /(?:api[-_ ]?key|access[-_ ]?token|password|secret|bearer|sk-[a-z0-9])/iu.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeState(value: unknown): McpHealthState | undefined {
  return value === "connected" || value === "degraded" || value === "disconnected" ? value : undefined;
}

function normalizeError(value: unknown): McpHealthError | undefined {
  return value === "not-connected" || value === "connect-failed" || value === "ping-timeout" || value === "ping-failed"
    ? value
    : undefined;
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, MAX_MCP_HEALTH_COUNT)
    : 0;
}

function safeLatency(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, MAX_MCP_HEALTH_LATENCY_MS)
    : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  const normalized = value.trim();
  if (!normalized || Number.isNaN(Date.parse(normalized))) return undefined;
  return new Date(normalized).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
