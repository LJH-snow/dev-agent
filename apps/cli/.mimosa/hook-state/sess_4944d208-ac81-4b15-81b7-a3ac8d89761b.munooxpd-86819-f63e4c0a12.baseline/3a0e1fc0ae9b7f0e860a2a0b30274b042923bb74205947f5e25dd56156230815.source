/**
 * Building blocks for CI/non-interactive CLI entry points.
 *
 * This module intentionally has no dependency on AgentLoop, providers, tools,
 * stdin, or process-global output. Callers can wire these pure/injected pieces
 * into the CLI without changing the interactive execution path.
 */

export const EXIT_CODES = Object.freeze({
  success: 0,
  findings: 2,
  policy_denied: 3,
  config_error: 4,
  runtime_unavailable: 5,
  execution_error: 6,
  usage_error: 64,
} as const);

/** Backwards-compatible descriptive alias for integrations. */
export const NON_INTERACTIVE_EXIT_CODES = EXIT_CODES;
export const EXIT_CODE = EXIT_CODES;
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const EVENT_SCHEMA_VERSION = 1 as const;

export type Clock = () => number | Date;
export type EventIdGenerator = (sequence: number) => string;
export type EventWriter = (line: string) => void;

export interface EventEnvelope {
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly sequence: number;
  readonly type: string;
  readonly timestamp: string;
  readonly payload: unknown;
}

export interface EventEmitterOptions {
  readonly clock?: Clock;
  readonly idGenerator?: EventIdGenerator;
  readonly write?: EventWriter;
  /** Absolute working directory to redact in addition to common path shapes. */
  readonly cwd?: string;
}

export interface EventEmitter {
  readonly emit: (type: string, payload?: unknown) => EventEnvelope;
  readonly emitJsonEvent: (type: string, payload?: unknown) => string;
  readonly sequence: () => number;
}

const SECRET_KEY_PATTERN =
  /(?:api[-_ ]?key|access[-_ ]?(?:key|token)|auth(?:orization)?|cookie|credential|password|passphrase|private[-_ ]?key|secret|token)/i;
const COMMAND_OUTPUT_KEY_PATTERN =
  /^(?:stdout|stderr|output|raw(?:[-_ ]?(?:command|stdout|stderr))?[-_ ]?output|command[-_ ]?output)$/i;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+ PRIVATE KEY-----/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_SHAPE_PATTERN =
  /\b(?:sk|pk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /((?:api[-_ ]?key|access[-_ ]?(?:key|token)|auth(?:orization)?|cookie|credential|password|passphrase|private[-_ ]?key|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const POSIX_ABSOLUTE_PATH_PATTERN =
  /\/(?:Users|home|private|tmp|var|opt|etc|Volumes|Applications|System|workspace|root)\/[A-Za-z0-9._~+%:@=-]+(?:\/[A-Za-z0-9._~+%:@=-]+)*/g;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /\b[A-Za-z]:\\[^\s"'`,;}\]]+/g;

/** Redacts event data before it can become a machine-readable event. */
export function redactEventPayload(value: unknown, cwd?: string): unknown {
  const seen = new WeakSet<object>();
  return redactValue(value, cwd, undefined, seen);
}

function redactValue(
  value: unknown,
  cwd: string | undefined,
  key: string | undefined,
  seen: WeakSet<object>,
): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (key && COMMAND_OUTPUT_KEY_PATTERN.test(key)) return "[redacted-command-output]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactString(value, cwd);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return "[redacted-bigint]";
  if (typeof value === "function" || typeof value === "symbol") return "[redacted]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return "[redacted]";

  if (seen.has(value)) return "[redacted-circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, cwd, undefined, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    output[entryKey] = redactValue(entryValue, cwd, entryKey, seen);
  }
  return output;
}

function redactString(value: string, cwd?: string): string {
  let redacted = value;
  if (cwd && cwd.length > 0) redacted = redacted.split(cwd).join("[cwd]");
  const processCwd = process.cwd();
  if (processCwd.length > 0) redacted = redacted.split(processCwd).join("[cwd]");

  return redacted
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1[redacted]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(TOKEN_SHAPE_PATTERN, "[redacted-token]")
    .replace(POSIX_ABSOLUTE_PATH_PATTERN, "[absolute-path]")
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, "[absolute-path]");
}

function normalizeTimestamp(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("clock must return a valid time");
  return date.toISOString();
}

export function createEventEmitter(options: EventEmitterOptions = {}): EventEmitter {
  const clock = options.clock ?? (() => Date.now());
  const idGenerator = options.idGenerator ?? ((sequence: number) => `event-${sequence}`);
  const write = options.write;
  let currentSequence = 0;

  const emit = (type: string, payload?: unknown): EventEnvelope => {
    if (type.trim() === "") throw new TypeError("event type must not be empty");
    currentSequence += 1;
    const event: EventEnvelope = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: String(idGenerator(currentSequence)),
      sequence: currentSequence,
      type,
      timestamp: normalizeTimestamp(clock()),
      payload: redactEventPayload(payload ?? {}, options.cwd),
    };
    write?.(JSON.stringify(event));
    return event;
  };

  return {
    emit,
    emitJsonEvent: (type, payload) => JSON.stringify(emit(type, payload)),
    sequence: () => currentSequence,
  };
}

/** Convenience API for callers that only need one JSON event. */
export function emitJsonEvent(
  type: string,
  payload?: unknown,
  options: EventEmitterOptions = {},
): string {
  return createEventEmitter(options).emitJsonEvent(type, payload);
}

export type NonInteractiveRequest =
  | { readonly kind: "approval"; readonly action?: string }
  | { readonly kind: "input"; readonly prompt?: string }
  | { readonly kind: "unknown"; readonly state?: string }
  | { readonly kind: string; readonly [key: string]: unknown };

export type NonInteractiveDecision =
  | { readonly allowed: true; readonly interactive: boolean }
  | {
      readonly allowed: false;
      readonly kind: "policy_denied" | "needs_input";
      readonly exitCode: typeof EXIT_CODES.policy_denied;
      readonly reason:
        | "approval_required"
        | "interactive_input_required"
        | "unknown_interactive_state";
      readonly interactive: false;
    };

export interface NonInteractiveControllerOptions {
  /** Defaults to false. This flag only changes the decision, never reads stdin. */
  readonly interactive?: boolean;
}

export class NonInteractiveController {
  private readonly interactive: boolean;

  public constructor(options: NonInteractiveControllerOptions = {}) {
    this.interactive = options.interactive ?? false;
  }

  public guard(request: NonInteractiveRequest): NonInteractiveDecision {
    if (this.interactive) return { allowed: true, interactive: true };

    switch (request.kind) {
      case "approval":
        return {
          allowed: false,
          kind: "policy_denied",
          exitCode: EXIT_CODES.policy_denied,
          reason: "approval_required",
          interactive: false,
        };
      case "input":
        return {
          allowed: false,
          kind: "needs_input",
          exitCode: EXIT_CODES.policy_denied,
          reason: "interactive_input_required",
          interactive: false,
        };
      default:
        return {
          allowed: false,
          kind: "needs_input",
          exitCode: EXIT_CODES.policy_denied,
          reason: "unknown_interactive_state",
          interactive: false,
        };
    }
  }

  public check(request: NonInteractiveRequest): NonInteractiveDecision {
    return this.guard(request);
  }
}

/** Alias for integrations that prefer a verb over `guard`. */
export const guardNonInteractiveRequest = (
  controller: NonInteractiveController,
  request: NonInteractiveRequest,
): NonInteractiveDecision => controller.guard(request);

export function createNonInteractiveController(
  options: NonInteractiveControllerOptions = {},
): NonInteractiveController {
  return new NonInteractiveController(options);
}

export function createNonInteractiveGuard(
  options: NonInteractiveControllerOptions = {},
): (request: NonInteractiveRequest) => NonInteractiveDecision {
  const controller = createNonInteractiveController(options);
  return (request) => controller.guard(request);
}

export const guardNonInteractive = createNonInteractiveGuard;

export interface BudgetLimits {
  readonly maxTurns?: number;
  readonly maxTokens?: number;
  readonly maxDurationMs?: number;
  readonly maxOutputChars?: number;
}

export interface BudgetUsage {
  readonly turns: number;
  readonly tokens: number;
  readonly outputChars: number;
  readonly durationMs: number;
}

export interface BudgetSnapshot extends BudgetUsage {
  readonly limits: BudgetLimits;
}

export type BudgetCallKind = "model" | "tool";

export interface BudgetCallRequest {
  readonly turns?: number;
  readonly tokens?: number;
  readonly outputChars?: number;
}

export type BudgetDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly kind: "budget_exceeded";
      readonly exitCode: typeof EXIT_CODES.execution_error;
      readonly dimension: keyof BudgetLimits;
      readonly limit: number;
      readonly observed: number;
      readonly requested: number;
    };

export interface BudgetTrackerOptions {
  readonly clock?: Clock;
}

export class BudgetTracker {
  private readonly limits: BudgetLimits;
  private readonly clock: Clock;
  private readonly startedAt: number;
  private turns = 0;
  private tokens = 0;
  private outputChars = 0;

  public constructor(limits: BudgetLimits = {}, options: BudgetTrackerOptions = {}) {
    this.limits = validateBudgetLimits(limits);
    this.clock = options.clock ?? (() => Date.now());
    this.startedAt = readClock(this.clock());
  }

  public checkBeforeCall(kind: BudgetCallKind, request: BudgetCallRequest = {}): BudgetDecision {
    const normalized = normalizeCallRequest(kind, request);
    const durationMs = this.elapsedMs();

    if (this.limits.maxDurationMs !== undefined && durationMs >= this.limits.maxDurationMs) {
      return budgetExceeded("maxDurationMs", this.limits.maxDurationMs, durationMs, 0);
    }

    const checks: readonly [keyof BudgetLimits, number, number, number][] = [
      ["maxTurns", this.limits.maxTurns ?? Number.POSITIVE_INFINITY, this.turns, normalized.turns],
      ["maxTokens", this.limits.maxTokens ?? Number.POSITIVE_INFINITY, this.tokens, normalized.tokens],
      [
        "maxOutputChars",
        this.limits.maxOutputChars ?? Number.POSITIVE_INFINITY,
        this.outputChars,
        normalized.outputChars,
      ],
    ];

    for (const [dimension, limit, current, requested] of checks) {
      // Turns count model turns; tools belonging to the final allowed turn may
      // still run, while token/output exhaustion blocks every next call.
      if (dimension === "maxTurns" && requested === 0) continue;
      if (current >= limit || current + requested > limit) {
        return budgetExceeded(dimension, limit, current, requested);
      }
    }
    return { allowed: true };
  }

  public beginCall(kind: BudgetCallKind, request: BudgetCallRequest = {}): BudgetDecision {
    const normalized = normalizeCallRequest(kind, request);
    const decision = this.checkBeforeCall(kind, normalized);
    if (!decision.allowed) return decision;
    this.recordUsage(normalized);
    return decision;
  }

  public recordUsage(usage: Partial<BudgetUsage>): void {
    const turns = usage.turns ?? 0;
    const tokens = usage.tokens ?? 0;
    const outputChars = usage.outputChars ?? 0;
    validateNonNegativeFinite("turns", turns);
    validateNonNegativeFinite("tokens", tokens);
    validateNonNegativeFinite("outputChars", outputChars);
    this.turns += turns;
    this.tokens += tokens;
    this.outputChars += outputChars;
  }

  public recordTurn(count = 1): void {
    this.recordUsage({ turns: count });
  }

  public recordTokens(count: number): void {
    this.recordUsage({ tokens: count });
  }

  public recordOutputChars(count: number): void {
    this.recordUsage({ outputChars: count });
  }

  public consume = this.recordUsage.bind(this);

  public snapshot(): BudgetSnapshot {
    return {
      turns: this.turns,
      tokens: this.tokens,
      outputChars: this.outputChars,
      durationMs: this.elapsedMs(),
      limits: { ...this.limits },
    };
  }

  public isExceeded(kind: BudgetCallKind = "model", request: BudgetCallRequest = {}): boolean {
    return !this.checkBeforeCall(kind, request).allowed;
  }

  public beforeCall(kind: BudgetCallKind, request: BudgetCallRequest = {}): BudgetDecision {
    return this.checkBeforeCall(kind, request);
  }

  public record(usage: Partial<BudgetUsage>): void {
    this.recordUsage(usage);
  }

  private elapsedMs(): number {
    return Math.max(0, readClock(this.clock()) - this.startedAt);
  }

}


export function createBudgetTracker(
  limits: BudgetLimits = {},
  options: BudgetTrackerOptions = {},
): BudgetTracker {
  return new BudgetTracker(limits, options);
}

function budgetExceeded(
  dimension: keyof BudgetLimits,
  limit: number,
  observed: number,
  requested: number,
): BudgetDecision {
  return {
    allowed: false,
    kind: "budget_exceeded",
    exitCode: EXIT_CODES.execution_error,
    dimension,
    limit,
    observed,
    requested,
  };
}

function validateBudgetLimits(limits: BudgetLimits): BudgetLimits {
  const result: BudgetLimits = { ...limits };
  for (const key of ["maxTurns", "maxTokens", "maxDurationMs", "maxOutputChars"] as const) {
    const value = result[key];
    if (value !== undefined) validateNonNegativeFinite(key, value);
    if (value !== undefined && (key !== "maxDurationMs" && !Number.isInteger(value))) {
      throw new RangeError(`${key} must be an integer`);
    }
  }
  return result;
}

function normalizeCallRequest(kind: BudgetCallKind, request: BudgetCallRequest): Required<BudgetCallRequest> {
  const turns = request.turns ?? (kind === "model" ? 1 : 0);
  const tokens = request.tokens ?? 0;
  const outputChars = request.outputChars ?? 0;
  validateNonNegativeFinite("turns", turns);
  validateNonNegativeFinite("tokens", tokens);
  validateNonNegativeFinite("outputChars", outputChars);
  return { turns, tokens, outputChars };
}

function validateNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be non-negative`);
}

function readClock(value: number | Date): number {
  const result = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(result)) throw new RangeError("clock must return a finite time");
  return result;
}
