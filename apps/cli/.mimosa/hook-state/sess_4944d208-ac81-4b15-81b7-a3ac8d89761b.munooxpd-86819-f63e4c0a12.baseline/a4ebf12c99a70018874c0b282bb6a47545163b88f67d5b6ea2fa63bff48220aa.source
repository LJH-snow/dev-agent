import type { ModelProviderId, ProviderConfig } from "@dev-agent/model";

/** Provider identifiers supported by the model package and the CLI. */
export const PROVIDER_IDS = ["ollama", "openai", "anthropic", "gemini"] as const;

export type SupportedProviderId = (typeof PROVIDER_IDS)[number] & ModelProviderId;

export type ProviderAuth = "none" | "api-key";
export type ProviderState = "ready" | "missing_config" | "disabled";
export type ProviderTestState = "passed" | "failed" | "skipped";
export type ModelSource = "default" | "config" | "environment";

export type ProviderErrorReason =
  | "api_key_missing"
  | "provider_disabled"
  | "invalid_provider"
  | "invalid_base_url"
  | "probe_not_configured"
  | "network_error"
  | "authentication_failed"
  | "endpoint_not_found"
  | "rate_limited"
  | "server_error"
  | "http_error"
  | "probe_failed";

/**
 * Provider-specific settings accepted by this module.
 *
 * The shape deliberately mirrors the shared model package's ProviderConfig
 * while keeping every field optional so a project can configure only the
 * provider-specific values it needs.
 */
export interface ProviderSettings extends Partial<Pick<ProviderConfig, "model" | "apiKey" | "baseUrl">> {
  readonly enabled?: boolean;
  readonly models?: readonly string[];
}

/**
 * Configuration input for provider/model management. It is intentionally
 * compatible with the CLI's existing defaultProvider/defaultModel fields and
 * adds optional provider-scoped values for the v0.3 API.
 */
export interface ProviderManagementConfig {
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly providers?: Partial<Record<SupportedProviderId, ProviderSettings>>;
  readonly models?: Partial<Record<SupportedProviderId, readonly string[]>>;
  readonly apiKeys?: Partial<Record<SupportedProviderId, string>>;
  readonly baseUrls?: Partial<Record<SupportedProviderId, string>>;
}

export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProviderProbeContext {
  readonly id: SupportedProviderId;
  readonly model: string;
  /** The raw configured URL is available to an injected probe, never to output metadata. */
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface ProviderProbeResult {
  readonly ok: boolean;
  readonly status?: number;
  /** Accepted for probe implementations, but never copied to command output. */
  readonly detail?: string;
}

export type ProviderProbe = (
  context: ProviderProbeContext
) => ProviderProbeResult | Promise<ProviderProbeResult>;

export interface ProviderManagementOptions {
  readonly config?: ProviderManagementConfig;
  readonly env?: ProviderEnvironment;
  /** Supplying this function opts into the built-in, provider-specific probe. */
  readonly fetch?: typeof fetch;
  /** A supplied probe takes precedence over the built-in fetch probe. */
  readonly probes?: Partial<Record<SupportedProviderId, ProviderProbe>>;
  readonly signal?: AbortSignal;
  /** Injected clock for deterministic tests and consumers that need repeatability. */
  readonly now?: () => number;
  /** Optional provider filter. Invalid values become a stable invalid_provider result. */
  readonly provider?: string;
}

export interface ProviderInfo {
  readonly id: SupportedProviderId;
  readonly name: string;
  readonly auth: ProviderAuth;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly state: ProviderState;
  readonly reason: ProviderErrorReason | null;
  readonly model: string;
  readonly defaultModel: string;
  /** Origin-only representation; credentials, query strings, and paths are never returned. */
  readonly baseUrl: string;
}

export interface ProviderTestInfo extends Omit<ProviderInfo, "state" | "reason"> {
  readonly state: ProviderTestState;
  readonly reason: ProviderErrorReason | null;
  readonly checked: boolean;
  readonly latencyMs: number;
  readonly httpStatus: number | null;
}

export interface ModelInfo {
  readonly provider: SupportedProviderId;
  readonly model: string;
  readonly source: ModelSource;
  readonly current: boolean;
}

export interface ProviderCommandError {
  readonly reason: ProviderErrorReason;
  readonly message: string;
}

export interface ProvidersListResult {
  readonly ok: boolean;
  readonly command: "providers list";
  readonly providers: readonly ProviderInfo[];
  readonly error: ProviderCommandError | null;
}

export interface ProvidersStatusResult {
  readonly ok: boolean;
  readonly command: "providers status";
  readonly providers: readonly ProviderInfo[];
  readonly error: ProviderCommandError | null;
}

export interface ProvidersTestResult {
  readonly ok: boolean;
  readonly command: "providers test";
  readonly providers: readonly ProviderTestInfo[];
  readonly error: ProviderCommandError | null;
}

export interface ModelsListResult {
  readonly ok: boolean;
  readonly command: "models list";
  readonly currentProvider: SupportedProviderId | null;
  readonly models: readonly ModelInfo[];
  readonly error: ProviderCommandError | null;
}

export interface CurrentModelResult {
  readonly ok: boolean;
  readonly command: "models current";
  readonly provider: SupportedProviderId | null;
  readonly model: string | null;
  readonly source: ModelSource | null;
  readonly error: ProviderCommandError | null;
}

export type ProviderCommand =
  | {
      readonly resource: "providers";
      readonly action: "list" | "status" | "test";
      readonly provider?: string;
    }
  | {
      readonly resource: "models";
      readonly action: "list" | "current";
      readonly provider?: string;
    };

export type ProviderCommandName =
  | "providers list"
  | "providers status"
  | "providers test"
  | "models list"
  | "models current";

/** A single JSON-safe envelope suitable for a future CLI adapter. */
export interface ProviderCommandResult {
  readonly ok: boolean;
  readonly command: ProviderCommandName;
  readonly providers: readonly (ProviderInfo | ProviderTestInfo)[];
  readonly models: readonly ModelInfo[];
  readonly currentProvider: SupportedProviderId | null;
  readonly provider: SupportedProviderId | null;
  readonly model: string | null;
  readonly source: ModelSource | null;
  readonly error: ProviderCommandError | null;
}

interface ProviderDefinition {
  readonly id: SupportedProviderId;
  readonly name: string;
  readonly auth: ProviderAuth;
  readonly defaultModel: string;
  readonly defaultBaseUrl: string;
}

interface ResolvedProvider {
  readonly definition: ProviderDefinition;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly state: ProviderState;
  readonly reason: ProviderErrorReason | null;
  readonly model: string;
  readonly modelSource: ModelSource;
  readonly baseUrl: string;
  readonly safeBaseUrl: string;
  readonly apiKey?: string;
}

interface ProbeOutcome {
  readonly state: ProviderTestState;
  readonly checked: boolean;
  readonly reason: ProviderErrorReason | null;
  readonly httpStatus: number | null;
}

const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: "ollama",
    name: "Ollama",
    auth: "none",
    defaultModel: "qwen3:4b-instruct",
    defaultBaseUrl: "http://localhost:11434",
  },
  {
    id: "openai",
    name: "OpenAI",
    auth: "api-key",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    auth: "api-key",
    defaultModel: "claude-sonnet-4-20250514",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  {
    id: "gemini",
    name: "Gemini",
    auth: "api-key",
    defaultModel: "gemini-2.0-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
  },
];

const REASON_MESSAGES: Readonly<Record<ProviderErrorReason, string>> = {
  api_key_missing: "The provider API key is not configured.",
  provider_disabled: "The provider is disabled by configuration.",
  invalid_provider: "The requested provider is not supported.",
  invalid_base_url: "The provider base URL is invalid.",
  probe_not_configured: "No probe was configured; no network request was made.",
  network_error: "The provider probe could not connect.",
  authentication_failed: "The provider rejected the configured credentials.",
  endpoint_not_found: "The provider probe endpoint was not found.",
  rate_limited: "The provider rate-limited the probe.",
  server_error: "The provider returned a server error.",
  http_error: "The provider probe returned an HTTP error.",
  probe_failed: "The provider probe failed.",
};

export function listProviders(options: ProviderManagementOptions = {}): ProvidersListResult {
  const selected = selectProviderIds(options.provider, "providers list");
  if (selected.error) {
    return { ok: false, command: "providers list", providers: [], error: selected.error };
  }

  const currentProvider = resolveEffectiveProvider(options);
  const providers = selected.ids.map((id) =>
    toProviderInfo(resolveProvider(id, options, currentProvider))
  );
  return { ok: true, command: "providers list", providers, error: null };
}

export function getProviderStatuses(options: ProviderManagementOptions = {}): ProvidersStatusResult {
  const selected = selectProviderIds(options.provider, "providers status");
  if (selected.error) {
    return { ok: false, command: "providers status", providers: [], error: selected.error };
  }

  const currentProvider = resolveEffectiveProvider(options);
  const providers = selected.ids.map((id) =>
    toProviderInfo(resolveProvider(id, options, currentProvider))
  );
  return { ok: true, command: "providers status", providers, error: null };
}

export async function testProviders(
  options: ProviderManagementOptions = {}
): Promise<ProvidersTestResult> {
  const selected = selectProviderIds(options.provider, "providers test");
  if (selected.error) {
    return { ok: false, command: "providers test", providers: [], error: selected.error };
  }

  const currentProvider = resolveEffectiveProvider(options);
  const providers = await Promise.all(
    selected.ids.map(async (id) => {
      const resolved = resolveProvider(id, options, currentProvider);
      const startedAt = safeNow(options.now);
      const outcome = await probeProvider(resolved, options);
      const finishedAt = safeNow(options.now);
      return toProviderTestInfo(resolved, outcome, Math.max(0, finishedAt - startedAt));
    })
  );
  return { ok: true, command: "providers test", providers, error: null };
}

export function listModels(options: ProviderManagementOptions = {}): ModelsListResult {
  const selected = selectProviderIds(options.provider, "models list");
  if (selected.error) {
    return {
      ok: false,
      command: "models list",
      currentProvider: null,
      models: [],
      error: selected.error,
    };
  }

  const currentProvider = resolveEffectiveProvider(options);
  const models: ModelInfo[] = [];
  for (const id of selected.ids) {
    const resolved = resolveProvider(id, options, currentProvider);
    for (const candidate of resolveModelCandidates(id, options, currentProvider)) {
      if (models.some((item) => item.provider === id && item.model === candidate.model)) {
        continue;
      }
      models.push({
        provider: id,
        model: candidate.model,
        source: candidate.source,
        current: id === currentProvider && candidate.model === resolved.model,
      });
    }
  }

  return { ok: true, command: "models list", currentProvider, models, error: null };
}

export function getCurrentModel(options: ProviderManagementOptions = {}): CurrentModelResult {
  const selected = selectRequestedProvider(options.provider, options, "models current");
  if (selected.error) {
    return {
      ok: false,
      command: "models current",
      provider: null,
      model: null,
      source: null,
      error: selected.error,
    };
  }

  const resolved = resolveProvider(selected.id, options, selected.id);
  return {
    ok: true,
    command: "models current",
    provider: selected.id,
    model: resolved.model,
    source: resolved.modelSource,
    error: null,
  };
}

export async function executeProviderCommand(
  command: ProviderCommand,
  options: ProviderManagementOptions = {}
): Promise<ProviderCommandResult> {
  const commandOptions: ProviderManagementOptions = {
    ...options,
    ...(command.provider !== undefined ? { provider: command.provider } : {}),
  };

  if (command.resource === "providers" && command.action === "list") {
    return toCommandResult(listProviders(commandOptions));
  }
  if (command.resource === "providers" && command.action === "status") {
    return toCommandResult(getProviderStatuses(commandOptions));
  }
  if (command.resource === "providers" && command.action === "test") {
    return toCommandResult(await testProviders(commandOptions));
  }
  if (command.resource === "models" && command.action === "list") {
    return toCommandResult(listModels(commandOptions));
  }
  return toCommandResult(getCurrentModel(commandOptions));
}

function resolveProvider(
  id: SupportedProviderId,
  options: ProviderManagementOptions,
  currentProvider: SupportedProviderId
): ResolvedProvider {
  const definition = PROVIDER_DEFINITIONS.find((item) => item.id === id) as ProviderDefinition;
  const config = options.config ?? {};
  const env = options.env ?? {};
  const providerConfig = config.providers?.[id] ?? {};
  const environment = providerEnvironment(id, env);

  const modelCandidates = resolveModelCandidates(id, options, currentProvider);
  const model = modelCandidates[0]?.model ?? definition.defaultModel;
  const modelSource = modelCandidates[0]?.source ?? "default";

  const baseUrl = firstNonEmpty(
    environment.baseUrl,
    providerConfig.baseUrl,
    config.baseUrls?.[id],
    definition.defaultBaseUrl
  ) as string;
  const safeBaseUrl = sanitizeBaseUrl(baseUrl);
  const validBaseUrl = isValidBaseUrl(baseUrl);
  const enabled = providerConfig.enabled !== false;
  const apiKey = firstNonEmpty(environment.apiKey, providerConfig.apiKey, config.apiKeys?.[id]);

  let reason: ProviderErrorReason | null = null;
  let state: ProviderState = "ready";
  if (!enabled) {
    state = "disabled";
    reason = "provider_disabled";
  } else if (!validBaseUrl) {
    state = "missing_config";
    reason = "invalid_base_url";
  } else if (definition.auth === "api-key" && !apiKey) {
    state = "missing_config";
    reason = "api_key_missing";
  }

  return {
    definition,
    enabled,
    configured: state === "ready",
    state,
    reason,
    model,
    modelSource,
    baseUrl,
    safeBaseUrl,
    ...(apiKey ? { apiKey } : {}),
  };
}

function resolveModelCandidates(
  id: SupportedProviderId,
  options: ProviderManagementOptions,
  currentProvider: SupportedProviderId
): readonly { readonly model: string; readonly source: ModelSource }[] {
  const config = options.config ?? {};
  const env = options.env ?? {};
  const providerConfig = config.providers?.[id] ?? {};
  const environment = providerEnvironment(id, env);
  const candidates: { model: string; source: ModelSource }[] = [];
  const add = (value: unknown, source: ModelSource): void => {
    if (typeof value !== "string" || value.trim() === "") return;
    const model = value.trim();
    if (candidates.some((candidate) => candidate.model === model)) return;
    candidates.push({ model, source });
  };

  add(environment.model, "environment");
  if (id === currentProvider) {
    add(env.DEV_AGENT_MODEL, "environment");
  }
  add(providerConfig.model, "config");
  for (const model of providerConfig.models ?? []) add(model, "config");
  for (const model of config.models?.[id] ?? []) add(model, "config");
  if (id === currentProvider) {
    add(config.defaultModel, "config");
  }

  const definition = PROVIDER_DEFINITIONS.find((item) => item.id === id) as ProviderDefinition;
  add(definition.defaultModel, "default");
  return candidates;
}

function providerEnvironment(
  id: SupportedProviderId,
  env: ProviderEnvironment
): { readonly apiKey?: string; readonly baseUrl?: string; readonly model?: string } {
  const upper = id.toUpperCase();
  const model = firstNonEmpty(env[`DEV_AGENT_${upper}_MODEL`], env[`${upper}_MODEL`]);
  const baseUrl = firstNonEmpty(
    env[`DEV_AGENT_${upper}_BASE_URL`],
    env[`${upper}_BASE_URL`]
  );
  const apiKey =
    id === "ollama"
      ? undefined
      : firstNonEmpty(env[`${upper}_API_KEY`], env[`DEV_AGENT_${upper}_API_KEY`]);
  return {
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function toProviderInfo(resolved: ResolvedProvider): ProviderInfo {
  return {
    id: resolved.definition.id,
    name: resolved.definition.name,
    auth: resolved.definition.auth,
    enabled: resolved.enabled,
    configured: resolved.configured,
    state: resolved.state,
    reason: resolved.reason,
    model: resolved.model,
    defaultModel: resolved.definition.defaultModel,
    baseUrl: resolved.safeBaseUrl,
  };
}

function toProviderTestInfo(
  resolved: ResolvedProvider,
  outcome: ProbeOutcome,
  latencyMs: number
): ProviderTestInfo {
  return {
    ...toProviderInfo(resolved),
    state: outcome.state,
    checked: outcome.checked,
    latencyMs: Number.isFinite(latencyMs) ? Math.floor(latencyMs) : 0,
    httpStatus: outcome.httpStatus,
    reason: outcome.reason,
  };
}

async function probeProvider(
  resolved: ResolvedProvider,
  options: ProviderManagementOptions
): Promise<ProbeOutcome> {
  if (!resolved.configured) {
    return {
      state: "skipped",
      checked: false,
      reason: resolved.reason,
      httpStatus: null,
    };
  }

  const customProbe = options.probes?.[resolved.definition.id];
  if (customProbe) {
    try {
      const result = await customProbe({
        id: resolved.definition.id,
        model: resolved.model,
        baseUrl: resolved.baseUrl,
        ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (result.ok) {
        return { state: "passed", checked: true, reason: null, httpStatus: result.status ?? null };
      }
      return {
        state: "failed",
        checked: true,
        reason: reasonForStatus(result.status) ?? "probe_failed",
        httpStatus: safeStatus(result.status),
      };
    } catch {
      return { state: "failed", checked: true, reason: "probe_failed", httpStatus: null };
    }
  }

  if (!options.fetch) {
    return {
      state: "skipped",
      checked: false,
      reason: "probe_not_configured",
      httpStatus: null,
    };
  }

  const request = buildProbeRequest(resolved);
  try {
    const response = await options.fetch(request.url, {
      method: "GET",
      headers: request.headers,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.ok) {
      return { state: "passed", checked: true, reason: null, httpStatus: response.status };
    }
    return {
      state: "failed",
      checked: true,
      reason: reasonForStatus(response.status) ?? "http_error",
      httpStatus: safeStatus(response.status),
    };
  } catch {
    return { state: "failed", checked: true, reason: "network_error", httpStatus: null };
  }
}

function buildProbeRequest(
  resolved: ResolvedProvider
): { readonly url: string; readonly headers: Record<string, string> } {
  const id = resolved.definition.id;
  if (id === "ollama") {
    return { url: appendPath(resolved.baseUrl, "/api/tags"), headers: { Accept: "application/json" } };
  }
  if (id === "openai") {
    return {
      url: appendPath(resolved.baseUrl, "/models"),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${resolved.apiKey ?? ""}`,
      },
    };
  }
  if (id === "anthropic") {
    return {
      url: appendPath(resolved.baseUrl, "/v1/models"),
      headers: {
        Accept: "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": resolved.apiKey ?? "",
      },
    };
  }
  return {
    url: appendPath(resolved.baseUrl, "/v1beta/models"),
    headers: {
      Accept: "application/json",
      "x-goog-api-key": resolved.apiKey ?? "",
    },
  };
}

function appendPath(baseUrl: string, suffix: string): string {
  const base = baseUrl.replace(/\/$/, "");
  if (base.endsWith("/v1") && suffix.startsWith("/v1/")) {
    return `${base}${suffix.slice(3)}`;
  }
  if (base.endsWith("/v1beta") && suffix.startsWith("/v1beta/")) {
    return `${base}${suffix.slice(7)}`;
  }
  return `${base}${suffix}`;
}

function reasonForStatus(status: number | undefined): ProviderErrorReason | null {
  if (!Number.isInteger(status) || (status as number) < 400) return null;
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 404) return "endpoint_not_found";
  if (status === 429) return "rate_limited";
  if ((status as number) >= 500) return "server_error";
  return "http_error";
}

function safeStatus(status: number | undefined): number | null {
  return Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599
    ? (status as number)
    : null;
}

function selectProviderIds(
  requested: string | undefined,
  command: ProviderCommandName
): { readonly ids: readonly SupportedProviderId[]; readonly error: ProviderCommandError | null } {
  if (requested === undefined || requested.trim() === "") {
    return { ids: PROVIDER_IDS, error: null };
  }
  const normalized = normalizeProviderId(requested);
  if (!normalized) {
    return { ids: [], error: createError("invalid_provider") };
  }
  return { ids: [normalized], error: null };
}

function selectRequestedProvider(
  requested: string | undefined,
  options: ProviderManagementOptions,
  _command: ProviderCommandName
): { readonly id: SupportedProviderId; readonly error: ProviderCommandError | null } {
  if (requested !== undefined && requested.trim() !== "") {
    const normalized = normalizeProviderId(requested);
    if (!normalized) return { id: "ollama", error: createError("invalid_provider") };
    return { id: normalized, error: null };
  }
  const effective = resolveEffectiveProvider(options);
  return { id: effective, error: null };
}

function resolveEffectiveProvider(options: ProviderManagementOptions): SupportedProviderId {
  const config = options.config ?? {};
  const env = options.env ?? {};
  const candidate = firstNonEmpty(env.DEV_AGENT_MODEL_PROVIDER, config.defaultProvider) ?? "ollama";
  return normalizeProviderId(candidate) ?? "ollama";
}

function normalizeProviderId(value: string): SupportedProviderId | undefined {
  const normalized = value.trim().toLowerCase();
  return (PROVIDER_IDS as readonly string[]).includes(normalized)
    ? (normalized as SupportedProviderId)
    : undefined;
}

function createError(reason: ProviderErrorReason): ProviderCommandError {
  return { reason, message: REASON_MESSAGES[reason] };
}

function toCommandResult(
  result: ProvidersListResult | ProvidersStatusResult | ProvidersTestResult | ModelsListResult | CurrentModelResult
): ProviderCommandResult {
  const isModelList = result.command === "models list";
  const isCurrentModel = result.command === "models current";
  const models = isModelList ? result.models : [];
  const currentProvider = isModelList ? result.currentProvider : null;
  const provider = isCurrentModel ? result.provider : null;
  const model = isCurrentModel ? result.model : null;
  const source = isCurrentModel ? result.source : null;
  return {
    ok: result.ok,
    command: result.command,
    providers: "providers" in result ? result.providers : [],
    models,
    currentProvider,
    provider,
    model,
    source,
    error: result.error,
  };
}

function firstNonEmpty(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "configured";
  }
}

function safeNow(now: (() => number) | undefined): number {
  const value = now?.() ?? Date.now();
  return Number.isFinite(value) ? value : Date.now();
}
