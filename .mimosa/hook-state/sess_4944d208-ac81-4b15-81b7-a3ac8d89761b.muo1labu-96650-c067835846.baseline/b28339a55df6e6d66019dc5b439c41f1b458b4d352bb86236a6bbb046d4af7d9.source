/**
 * Pure provider/model profile resolution for the CLI.
 *
 * This module deliberately accepts a structural, CliConfig-like value instead
 * of importing the current config schema. The schema can therefore evolve in
 * a later CLI integration without making this resolver responsible for file
 * I/O, provider construction, credentials, or network calls.
 */

export const SUPPORTED_PROVIDER_IDS = ["ollama", "openai", "anthropic", "gemini"] as const;

export type ModelProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

export type ModelProfileErrorCode =
  | "invalid_config"
  | "unknown_provider"
  | "unknown_profile"
  | "unknown_alias"
  | "empty_provider"
  | "empty_model"
  | "selector_conflict"
  | "fallback_cycle";

const ERROR_MESSAGES: Readonly<Record<ModelProfileErrorCode, string>> = {
  invalid_config: "Model profile configuration is invalid.",
  unknown_provider: "Model provider is not supported.",
  unknown_profile: "Model profile is not defined.",
  unknown_alias: "Model alias is not defined.",
  empty_provider: "Model provider must not be empty.",
  empty_model: "Model name must not be empty.",
  selector_conflict: "Model profile and alias selectors cannot be combined.",
  fallback_cycle: "Model fallback configuration contains a cycle.",
};

/** Stable, value-free errors suitable for CLI/CI metadata. */
export class ModelProfileError extends Error {
  readonly code: ModelProfileErrorCode;

  constructor(code: ModelProfileErrorCode) {
    super(ModelProfileError.messageFor(code));
    this.name = "ModelProfileError";
    this.code = code;
  }

  static messageFor(code: ModelProfileErrorCode): string {
    return ERROR_MESSAGES[code];
  }
}

/** A structural subset of CliConfig. Extra config fields are intentionally ignored. */
export interface CliConfigLike {
  readonly defaultProvider?: unknown;
  readonly defaultModel?: unknown;
  readonly defaultProfile?: unknown;
  readonly defaultAlias?: unknown;
  readonly profile?: unknown;
  readonly alias?: unknown;
  readonly profiles?: unknown;
  readonly aliases?: unknown;
  readonly fallback?: unknown;
  readonly [key: string]: unknown;
}

export interface ModelProfileDefinitionLike {
  readonly provider?: unknown;
  readonly model?: unknown;
  readonly fallback?: unknown;
  readonly fallbacks?: unknown;
  readonly [key: string]: unknown;
}

export interface ModelProfileDefinition {
  readonly provider?: ModelProviderId;
  readonly model?: string;
  readonly fallbacks: readonly string[];
}

export interface ModelAliasDefinition {
  readonly provider?: ModelProviderId;
  readonly model?: string;
  readonly profile?: string;
  readonly alias?: string;
}

export interface ParsedModelProfiles {
  readonly profiles: Readonly<Record<string, ModelProfileDefinition>>;
  readonly aliases: Readonly<Record<string, ModelAliasDefinition>>;
  readonly fallback: {
    readonly enabled: boolean;
    readonly order: readonly string[];
  };
}

export type ModelSelectionReason =
  | "explicit"
  | "profile"
  | "alias"
  | "environment"
  | "config"
  | "default"
  | "fallback"
  | "fallback-disabled"
  | "fallback-exhausted";

export type ModelSelectionSource = "explicit" | "environment" | "config" | "default" | "fallback";

export type ModelFailureReason =
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "authentication"
  | "unknown";

export interface ModelSelection {
  readonly provider: ModelProviderId;
  readonly model?: string;
}

export interface ModelSelectionMetadata {
  readonly provider: ModelProviderId;
  readonly model?: string;
  readonly reason: ModelSelectionReason;
  readonly source: ModelSelectionSource;
  readonly profile?: string;
  readonly alias?: string;
  readonly failureReason?: ModelFailureReason;
  readonly fallback: {
    readonly enabled: boolean;
    readonly changed: boolean;
  };
  /** Zero is the primary choice; later values identify fallback attempts. */
  readonly fallbackIndex?: number;
}

export interface ModelSelectionResult {
  readonly selection: ModelSelection;
  readonly metadata: ModelSelectionMetadata;
  readonly changed: boolean;
}

export interface ResolveModelSelectionOptions {
  readonly config?: CliConfigLike;
  /** Explicit provider flag/value. It outranks every config and environment value. */
  readonly provider?: unknown;
  /** Explicit model flag/value. It outranks every config and environment value. */
  readonly model?: unknown;
  /** Explicit profile selector. */
  readonly profile?: unknown;
  /** Explicit alias selector. */
  readonly alias?: unknown;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ResolveFallbackSelectionOptions {
  readonly config?: CliConfigLike;
  readonly current: ModelSelectionResult;
  /** A bounded reason category; raw provider errors are never accepted or returned. */
  readonly failure: ModelFailureReason | string;
}

export interface ModelFallbackSelectionResult extends ModelSelectionResult {
  readonly changed: boolean;
}

interface NormalizedAlias {
  readonly kind: "reference" | "inline";
  readonly name?: string;
  readonly referenceKind?: "profile" | "alias" | "auto";
  readonly provider?: ModelProviderId;
  readonly model?: string;
}

interface NormalizedRegistry {
  readonly profiles: ReadonlyMap<string, ModelProfileDefinition>;
  readonly aliases: ReadonlyMap<string, NormalizedAlias>;
  readonly fallback: {
    readonly enabled: boolean;
    readonly order: readonly string[];
  };
}

interface ResolvedTarget {
  readonly provider?: ModelProviderId;
  readonly model?: string;
  readonly profile?: string;
  readonly alias?: string;
  readonly fallbackRefs: readonly string[];
  readonly identity: string;
}

type SelectorKind = "profile" | "alias";
type SelectorSource = "explicit" | "environment" | "config";

interface SelectorChoice {
  readonly kind: SelectorKind;
  readonly name: string;
  readonly source: SelectorSource;
}

const EMPTY_ENV: Readonly<Record<string, string | undefined>> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function invalidConfig(): never {
  throw new ModelProfileError("invalid_config");
}

function normalizeProvider(value: unknown): ModelProviderId {
  if (typeof value !== "string") {
    return invalidConfig();
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new ModelProfileError("empty_provider");
  }
  if ((SUPPORTED_PROVIDER_IDS as readonly string[]).includes(normalized)) {
    return normalized as ModelProviderId;
  }
  throw new ModelProfileError("unknown_provider");
}

function normalizeOptionalProvider(value: unknown): ModelProviderId | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeProvider(value);
}

function normalizeModel(value: unknown): string {
  if (typeof value !== "string") {
    return invalidConfig();
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ModelProfileError("empty_model");
  }
  return normalized;
}

function normalizeOptionalModel(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeModel(value);
}

function normalizeReference(value: unknown): string {
  if (typeof value !== "string") {
    return invalidConfig();
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return invalidConfig();
  }
  return normalized;
}

function normalizeReferenceList(value: unknown): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [normalizeReference(value)];
  }
  if (!Array.isArray(value)) {
    return invalidConfig();
  }
  return value.map(normalizeReference);
}

function readFallbackRefs(record: Record<string, unknown>): readonly string[] {
  if (hasOwn(record, "fallback")) {
    return normalizeReferenceList(record.fallback);
  }
  if (hasOwn(record, "fallbacks")) {
    return normalizeReferenceList(record.fallbacks);
  }
  return [];
}

function parseProfiles(raw: unknown): ReadonlyMap<string, ModelProfileDefinition> {
  if (raw === undefined) {
    return new Map();
  }
  if (!isRecord(raw)) {
    return invalidConfig();
  }

  const profiles = new Map<string, ModelProfileDefinition>();
  for (const [rawName, rawDefinition] of Object.entries(raw)) {
    const name = rawName.trim();
    if (name.length === 0 || !isRecord(rawDefinition)) {
      return invalidConfig();
    }
    profiles.set(name, {
      provider: normalizeOptionalProvider(rawDefinition.provider),
      model: normalizeOptionalModel(rawDefinition.model),
      fallbacks: readFallbackRefs(rawDefinition),
    });
  }
  return profiles;
}

function looksLikeProviderModel(value: string): boolean {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    return false;
  }
  const provider = value.slice(0, separator).trim().toLowerCase();
  return (SUPPORTED_PROVIDER_IDS as readonly string[]).includes(provider);
}

function parseAliasValue(rawValue: unknown, profiles: ReadonlyMap<string, ModelProfileDefinition>, aliases: ReadonlyMap<string, unknown>): NormalizedAlias {
  if (typeof rawValue === "string") {
    const value = rawValue.trim();
    if (value.length === 0) {
      throw new ModelProfileError("empty_model");
    }
    if (profiles.has(value) || aliases.has(value)) {
      return {
        kind: "reference",
        name: value,
        referenceKind: profiles.has(value) ? "profile" : "alias",
      };
    }
    if (looksLikeProviderModel(value)) {
      const separator = value.indexOf("/");
      return {
        kind: "inline",
        provider: normalizeProvider(value.slice(0, separator)),
        model: normalizeModel(value.slice(separator + 1)),
      };
    }
    return { kind: "inline", model: normalizeModel(value) };
  }

  if (!isRecord(rawValue)) {
    return invalidConfig();
  }

  if (hasOwn(rawValue, "profile")) {
    return {
      kind: "reference",
      name: normalizeReference(rawValue.profile),
      referenceKind: "profile",
    };
  }
  if (hasOwn(rawValue, "alias")) {
    return {
      kind: "reference",
      name: normalizeReference(rawValue.alias),
      referenceKind: "alias",
    };
  }

  const provider = normalizeOptionalProvider(rawValue.provider);
  const model = normalizeOptionalModel(rawValue.model);
  if (provider === undefined && model === undefined) {
    return invalidConfig();
  }
  return { kind: "inline", provider, model };
}

function parseAliases(
  raw: unknown,
  profiles: ReadonlyMap<string, ModelProfileDefinition>,
): ReadonlyMap<string, NormalizedAlias> {
  if (raw === undefined) {
    return new Map();
  }
  if (!isRecord(raw)) {
    return invalidConfig();
  }

  const rawAliases = new Map(Object.entries(raw));
  const aliases = new Map<string, NormalizedAlias>();
  for (const [rawName, rawValue] of rawAliases) {
    const name = rawName.trim();
    if (name.length === 0) {
      return invalidConfig();
    }
    aliases.set(name, parseAliasValue(rawValue, profiles, rawAliases));
  }
  return aliases;
}

function parseFallback(raw: unknown): { readonly enabled: boolean; readonly order: readonly string[] } {
  if (raw === undefined) {
    return { enabled: false, order: [] };
  }
  if (Array.isArray(raw)) {
    return { enabled: false, order: normalizeReferenceList(raw) };
  }
  if (typeof raw === "boolean") {
    return { enabled: raw, order: [] };
  }
  if (!isRecord(raw)) {
    return invalidConfig();
  }

  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    return invalidConfig();
  }

  let order: readonly string[] = [];
  for (const key of ["order", "chain", "profiles", "targets"]) {
    if (hasOwn(raw, key)) {
      order = normalizeReferenceList(raw[key]);
      break;
    }
  }
  return { enabled: raw.enabled === true, order };
}

function toRecord<T>(map: ReadonlyMap<string, T>): Readonly<Record<string, T>> {
  const record: Record<string, T> = {};
  for (const [key, value] of map) {
    record[key] = value;
  }
  return record;
}

function parseRegistry(config: CliConfigLike = {}): NormalizedRegistry {
  if (!isRecord(config)) {
    return invalidConfig();
  }
  const profiles = parseProfiles(config.profiles);
  const aliases = parseAliases(config.aliases, profiles);
  return {
    profiles,
    aliases,
    fallback: parseFallback(config.fallback),
  };
}

/** Parses only the profile/alias/fallback sections and returns safe normalized metadata. */
export function parseModelProfiles(config: CliConfigLike = {}): ParsedModelProfiles {
  const registry = parseRegistry(config);
  const aliases: Record<string, ModelAliasDefinition> = {};
  for (const [name, alias] of registry.aliases) {
    if (alias.kind === "reference") {
      if (alias.referenceKind === "profile") {
        aliases[name] = { profile: alias.name ?? "" };
      } else {
        aliases[name] = { alias: alias.name ?? "" };
      }
    } else {
      aliases[name] = { provider: alias.provider, model: alias.model };
    }
  }
  return {
    profiles: toRecord(registry.profiles),
    aliases,
    fallback: registry.fallback,
  };
}

function detectCycle(stack: readonly string[], key: string): void {
  if (stack.includes(key)) {
    throw new ModelProfileError("fallback_cycle");
  }
}

function resolveProfile(
  name: string,
  registry: NormalizedRegistry,
  stack: readonly string[],
): ResolvedTarget {
  const definition = registry.profiles.get(name);
  if (!definition) {
    throw new ModelProfileError("unknown_profile");
  }
  const key = `profile:${name}`;
  detectCycle(stack, key);
  return {
    provider: definition.provider,
    model: definition.model,
    profile: name,
    fallbackRefs: definition.fallbacks,
    identity: key,
  };
}

function resolveAlias(
  name: string,
  registry: NormalizedRegistry,
  stack: readonly string[],
): ResolvedTarget {
  const definition = registry.aliases.get(name);
  if (!definition) {
    throw new ModelProfileError("unknown_alias");
  }
  const key = `alias:${name}`;
  detectCycle(stack, key);

  if (definition.kind === "inline") {
    return {
      provider: definition.provider,
      model: definition.model,
      alias: name,
      fallbackRefs: [],
      identity: key,
    };
  }

  const nextStack = [...stack, key];
  const target = resolveReference(
    definition.name ?? "",
    registry,
    nextStack,
    definition.referenceKind ?? "auto",
  );
  return {
    ...target,
    alias: target.alias ?? name,
  };
}

function resolveReference(
  name: string,
  registry: NormalizedRegistry,
  stack: readonly string[],
  kind: "profile" | "alias" | "auto",
): ResolvedTarget {
  if (kind === "profile") {
    return resolveProfile(name, registry, stack);
  }
  if (kind === "alias") {
    return resolveAlias(name, registry, stack);
  }
  if (registry.profiles.has(name)) {
    return resolveProfile(name, registry, stack);
  }
  if (registry.aliases.has(name)) {
    return resolveAlias(name, registry, stack);
  }
  throw new ModelProfileError("unknown_profile");
}

function resolveSelectedTarget(
  choice: SelectorChoice | undefined,
  registry: NormalizedRegistry,
): ResolvedTarget | undefined {
  if (!choice) {
    return undefined;
  }
  return resolveReference(choice.name, registry, [], choice.kind);
}

function nonEmptyEnvValue(env: Readonly<Record<string, string | undefined>>, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function selectorFromValues(
  profileValue: unknown,
  aliasValue: unknown,
  source: SelectorSource,
): SelectorChoice | undefined {
  const hasProfile = profileValue !== undefined;
  const hasAlias = aliasValue !== undefined;
  if (!hasProfile && !hasAlias) {
    return undefined;
  }
  if (hasProfile && hasAlias) {
    throw new ModelProfileError("selector_conflict");
  }

  const value = hasProfile ? profileValue : aliasValue;
  if (typeof value !== "string") {
    return invalidConfig();
  }
  const name = value.trim();
  if (name.length === 0) {
    throw new ModelProfileError(hasProfile ? "unknown_profile" : "unknown_alias");
  }
  return { kind: hasProfile ? "profile" : "alias", name, source };
}

function configSelector(config: CliConfigLike): SelectorChoice | undefined {
  const profileValue = hasOwn(config, "defaultProfile") ? config.defaultProfile : config.profile;
  const aliasValue = hasOwn(config, "defaultAlias") ? config.defaultAlias : config.alias;
  return selectorFromValues(profileValue, aliasValue, "config");
}

function environmentSelector(env: Readonly<Record<string, string | undefined>>): SelectorChoice | undefined {
  return selectorFromValues(
    nonEmptyEnvValue(env, "DEV_AGENT_MODEL_PROFILE"),
    nonEmptyEnvValue(env, "DEV_AGENT_MODEL_ALIAS"),
    "environment",
  );
}

function readDirectValue(value: unknown, kind: "provider" | "model"): ModelProviderId | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return kind === "provider" ? normalizeProvider(value) : normalizeModel(value);
}

function createSelectionResult(
  target: ResolvedTarget,
  provider: ModelProviderId,
  model: string | undefined,
  reason: ModelSelectionReason,
  source: ModelSelectionSource,
  fallbackEnabled: boolean,
  changed: boolean,
  failureReason?: ModelFailureReason,
  fallbackIndex?: number,
): ModelSelectionResult {
  const selection: ModelSelection = model === undefined ? { provider } : { provider, model };
  const metadata: ModelSelectionMetadata = {
    provider,
    ...(model === undefined ? {} : { model }),
    reason,
    source,
    ...(target.profile === undefined ? {} : { profile: target.profile }),
    ...(target.alias === undefined ? {} : { alias: target.alias }),
    ...(failureReason === undefined ? {} : { failureReason }),
    fallback: { enabled: fallbackEnabled, changed },
    ...(fallbackIndex === undefined ? {} : { fallbackIndex }),
  };
  return { selection, metadata, changed };
}

function normalizeFailureReason(value: ModelFailureReason | string): ModelFailureReason {
  if (
    value === "rate_limited" ||
    value === "timeout" ||
    value === "unavailable" ||
    value === "authentication"
  ) {
    return value;
  }
  return "unknown";
}

/**
 * Resolves one provider/model choice without constructing a provider or
 * touching credentials. Direct provider/model values have the highest
 * priority, followed by explicit selectors, environment values, config, and
 * finally the legacy ollama default.
 */
export function resolveModelSelection(options: ResolveModelSelectionOptions = {}): ModelSelectionResult {
  const config = options.config ?? {};
  const env = options.env ?? EMPTY_ENV;
  const registry = parseRegistry(config);

  const explicitSelector = selectorFromValues(options.profile, options.alias, "explicit");
  const selector = explicitSelector ?? environmentSelector(env) ?? configSelector(config);
  const target = resolveSelectedTarget(selector, registry) ?? {
    fallbackRefs: [],
    identity: "default",
  };

  const directProvider = readDirectValue(options.provider, "provider") as ModelProviderId | undefined;
  const directModel = readDirectValue(options.model, "model") as string | undefined;

  const environmentProviderValue = nonEmptyEnvValue(env, "DEV_AGENT_MODEL_PROVIDER");
  const environmentModelValue = nonEmptyEnvValue(env, "DEV_AGENT_MODEL");

  const configProviderValue = config.defaultProvider;
  const configModelValue = config.defaultModel;

  let provider: ModelProviderId;
  if (directProvider !== undefined) {
    provider = directProvider;
  } else if (selector?.source === "explicit" && target.provider !== undefined) {
    provider = target.provider;
  } else if (environmentProviderValue !== undefined) {
    provider = normalizeProvider(environmentProviderValue);
  } else if (target.provider !== undefined) {
    provider = target.provider;
  } else if (configProviderValue !== undefined) {
    provider = normalizeProvider(configProviderValue);
  } else {
    provider = "ollama";
  }

  let model: string | undefined;
  if (directModel !== undefined) {
    model = directModel;
  } else if (selector?.source === "explicit" && target.model !== undefined) {
    model = target.model;
  } else if (environmentModelValue !== undefined) {
    model = normalizeModel(environmentModelValue);
  } else if (target.model !== undefined) {
    model = target.model;
  } else if (configModelValue !== undefined) {
    model = normalizeModel(configModelValue);
  }

  let reason: ModelSelectionReason;
  let source: ModelSelectionSource;
  if (directProvider !== undefined || directModel !== undefined || selector?.source === "explicit") {
    if (directProvider !== undefined || directModel !== undefined) {
      reason = "explicit";
    } else {
      reason = selector?.kind ?? "explicit";
    }
    source = "explicit";
  } else if (selector?.source === "environment") {
    reason = selector.kind;
    source = "environment";
  } else if (selector?.source === "config") {
    reason = selector.kind;
    source = "config";
  } else if (environmentProviderValue !== undefined || environmentModelValue !== undefined) {
    reason = "environment";
    source = "environment";
  } else if (configProviderValue !== undefined || configModelValue !== undefined) {
    reason = "config";
    source = "config";
  } else {
    reason = "default";
    source = "default";
  }

  return createSelectionResult(
    target,
    provider,
    model,
    reason,
    source,
    registry.fallback.enabled,
    false,
    undefined,
    registry.fallback.enabled ? 0 : undefined,
  );
}

function targetIdentity(target: ResolvedTarget | ModelSelectionResult): string {
  if ("identity" in target) {
    return target.identity;
  }
  if (target.metadata.profile !== undefined) {
    return `profile:${target.metadata.profile}`;
  }
  if (target.metadata.alias !== undefined) {
    return `alias:${target.metadata.alias}`;
  }
  return `inline:${target.selection.provider}:${target.selection.model ?? ""}`;
}

function resolvedFallbackOrder(
  current: ModelSelectionResult,
  registry: NormalizedRegistry,
): readonly ResolvedTarget[] {
  if (registry.fallback.order.length > 0) {
    const ordered: ResolvedTarget[] = [];
    const seen = new Set<string>();
    for (const reference of registry.fallback.order) {
      const target = resolveReference(reference, registry, [], "auto");
      if (seen.has(target.identity)) {
        throw new ModelProfileError("fallback_cycle");
      }
      seen.add(target.identity);
      ordered.push(target);
    }

    const currentId = targetIdentity(current);
    const currentPosition = ordered.findIndex((target) => target.identity === currentId);
    if (currentPosition > 0 && (current.metadata.fallbackIndex ?? 0) === 0) {
      throw new ModelProfileError("fallback_cycle");
    }
    return currentPosition >= 0 ? ordered.slice(currentPosition + 1) : ordered;
  }

  const initialIdentity = targetIdentity(current);
  const result: ResolvedTarget[] = [];
  const visited = new Set<string>([initialIdentity]);

  const walk = (references: readonly string[]): void => {
    for (const reference of references) {
      const target = resolveReference(reference, registry, [], "auto");
      if (visited.has(target.identity)) {
        throw new ModelProfileError("fallback_cycle");
      }
      visited.add(target.identity);
      result.push(target);
      walk(target.fallbackRefs);
    }
  };

  const currentProfile = current.metadata.profile;
  if (currentProfile !== undefined) {
    const profile = registry.profiles.get(currentProfile);
    if (!profile) {
      throw new ModelProfileError("unknown_profile");
    }
    walk(profile.fallbacks);
  }
  return result;
}

/**
 * Chooses the next fallback after a provider/model failure. No fallback is
 * selected unless `fallback.enabled` is exactly true. Raw errors are not part
 * of this API; callers provide only a bounded failure category.
 */
export function resolveFallbackSelection(
  options: ResolveFallbackSelectionOptions,
): ModelFallbackSelectionResult {
  const registry = parseRegistry(options.config ?? {});
  const failureReason = normalizeFailureReason(options.failure);

  if (!registry.fallback.enabled) {
    return {
      selection: options.current.selection,
      metadata: {
        ...options.current.metadata,
        reason: "fallback-disabled",
        source: "fallback",
        failureReason,
        fallback: { enabled: false, changed: false },
      },
      changed: false,
    };
  }

  const candidates = resolvedFallbackOrder(options.current, registry);
  if (candidates.length === 0) {
    return {
      selection: options.current.selection,
      metadata: {
        ...options.current.metadata,
        reason: "fallback-exhausted",
        source: "fallback",
        failureReason,
        fallback: { enabled: true, changed: false },
      },
      changed: false,
    };
  }

  const next = candidates[0];
  if (!next) {
    return {
      selection: options.current.selection,
      metadata: {
        ...options.current.metadata,
        reason: "fallback-exhausted",
        source: "fallback",
        failureReason,
        fallback: { enabled: true, changed: false },
      },
      changed: false,
    };
  }
  const nextIndex = (options.current.metadata.fallbackIndex ?? 0) + 1;
  const resolved = createSelectionResult(
    next,
    next.provider ?? options.current.selection.provider,
    next.model,
    "fallback",
    "fallback",
    true,
    true,
    failureReason,
    nextIndex,
  );
  return resolved;
}

/** Alias kept explicit for the later createProvider integration point. */
export const resolveModelProfile = resolveModelSelection;

/** Returns only safe provider/model metadata as a stable JSON object string. */
export function formatModelSelectionMetadata(result: ModelSelectionResult): string {
  const metadata: Record<string, unknown> = {
    provider: result.metadata.provider,
    ...(result.metadata.model === undefined ? {} : { model: result.metadata.model }),
    reason: result.metadata.reason,
    source: result.metadata.source,
    ...(result.metadata.profile === undefined ? {} : { profile: result.metadata.profile }),
    ...(result.metadata.alias === undefined ? {} : { alias: result.metadata.alias }),
    ...(result.metadata.failureReason === undefined
      ? {}
      : { failureReason: result.metadata.failureReason }),
    fallback: {
      enabled: result.metadata.fallback.enabled,
      changed: result.changed,
    },
  };
  return JSON.stringify(metadata);
}
