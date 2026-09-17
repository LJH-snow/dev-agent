import type { ChatUsage } from "@dev-agent/model";

export type BudgetPhase = "model" | "tool";
export type BudgetName = "maxTurns" | "maxTokens" | "maxDurationMs" | "maxOutputChars";

export type BudgetClock = () => number;

/** Limits applied to one AgentLoop.run() execution. */
export interface AgentLoopBudget {
  readonly maxTurns?: number;
  readonly maxTokens?: number;
  readonly maxDurationMs?: number;
  readonly maxOutputChars?: number;
  /** Injectable monotonic clock for tests and embedders. Defaults to Date.now. */
  readonly clock?: BudgetClock;
}

export interface BudgetSnapshot {
  readonly turns: number;
  readonly tokens: number;
  readonly outputChars: number;
  readonly elapsedMs: number;
}

export interface BudgetExceededPayload {
  readonly code: "budget_exceeded";
  readonly budget: BudgetName;
  readonly phase: BudgetPhase;
  readonly limit: number;
  readonly observed: number;
}

/** Stable, serializable error raised at a model/tool execution boundary. */
export class BudgetExceededError extends Error {
  readonly code = "budget_exceeded" as const;
  readonly budget: BudgetName;
  readonly phase: BudgetPhase;
  readonly limit: number;
  readonly observed: number;

  constructor(payload: Omit<BudgetExceededPayload, "code">) {
    const fullPayload: BudgetExceededPayload = {
      code: "budget_exceeded",
      ...payload,
    };
    super(JSON.stringify(fullPayload));
    this.name = "BudgetExceededError";
    this.budget = payload.budget;
    this.phase = payload.phase;
    this.limit = payload.limit;
    this.observed = payload.observed;
  }

  toJSON(): BudgetExceededPayload {
    return {
      code: this.code,
      budget: this.budget,
      phase: this.phase,
      limit: this.limit,
      observed: this.observed,
    };
  }
}

export function isBudgetExceededError(error: unknown): error is BudgetExceededError {
  return error instanceof BudgetExceededError;
}

export function formatBudgetError(error: BudgetExceededError): string {
  return JSON.stringify(error.toJSON());
}

/**
 * Tracks one loop execution and enforces limits before the next model/tool call.
 * Exact counter boundaries are accepted for the current call and rejected before
 * a subsequent call; an observed value above a limit fails the current run.
 */
export class BudgetTracker {
  private readonly maxTurns?: number;
  private readonly maxTokens?: number;
  private readonly maxDurationMs?: number;
  private readonly maxOutputChars?: number;
  private readonly clock: BudgetClock;
  private readonly startedAt: number;
  private turns = 0;
  private tokens = 0;
  private outputChars = 0;

  constructor(options: AgentLoopBudget = {}) {
    this.maxTurns = validateLimit("maxTurns", options.maxTurns);
    this.maxTokens = validateLimit("maxTokens", options.maxTokens);
    this.maxDurationMs = validateLimit("maxDurationMs", options.maxDurationMs);
    this.maxOutputChars = validateLimit("maxOutputChars", options.maxOutputChars);
    this.clock = options.clock ?? (() => Date.now());
    this.startedAt = this.clock();
  }

  /**
   * Checks the boundary before a model call. Internal model calls such as
   * context summarization can pass countTurn=false so they consume tokens,
   * duration, and output without changing the user-visible turn count.
   */
  beforeModelCall(options: { readonly countTurn?: boolean } = {}): void {
    const countTurn = options.countTurn !== false;
    this.assertBefore("model", countTurn);
    if (countTurn) {
      this.turns += 1;
    }
  }

  /** Checks the boundary immediately before executing a tool. */
  beforeToolCall(): void {
    this.assertBefore("tool", false);
  }

  /** Records a model response and the provider-reported token usage. */
  recordModelOutput(content: string, usage?: ChatUsage): void {
    this.outputChars += content.length;
    this.tokens += usage?.totalTokens ?? 0;
    this.assertAfter("model");
  }

  /** Records the serialized tool result returned to the model. */
  recordToolOutput(output: string): void {
    this.outputChars += output.length;
    this.assertAfter("tool");
  }

  snapshot(): BudgetSnapshot {
    return {
      turns: this.turns,
      tokens: this.tokens,
      outputChars: this.outputChars,
      elapsedMs: this.elapsedMs(),
    };
  }

  private assertBefore(phase: BudgetPhase, countTurn: boolean): void {
    if (countTurn && this.maxTurns !== undefined && this.turns >= this.maxTurns) {
      throw this.error("maxTurns", phase, this.maxTurns, this.turns);
    }
    if (this.maxTokens !== undefined && this.tokens >= this.maxTokens) {
      throw this.error("maxTokens", phase, this.maxTokens, this.tokens);
    }
    if (this.maxDurationMs !== undefined) {
      const elapsed = this.elapsedMs();
      if (elapsed >= this.maxDurationMs) {
        throw this.error("maxDurationMs", phase, this.maxDurationMs, elapsed);
      }
    }
    if (this.maxOutputChars !== undefined && this.outputChars >= this.maxOutputChars) {
      throw this.error("maxOutputChars", phase, this.maxOutputChars, this.outputChars);
    }
  }

  private assertAfter(phase: BudgetPhase): void {
    if (this.maxTokens !== undefined && this.tokens > this.maxTokens) {
      throw this.error("maxTokens", phase, this.maxTokens, this.tokens);
    }
    if (this.maxDurationMs !== undefined) {
      const elapsed = this.elapsedMs();
      if (elapsed > this.maxDurationMs) {
        throw this.error("maxDurationMs", phase, this.maxDurationMs, elapsed);
      }
    }
    if (this.maxOutputChars !== undefined && this.outputChars > this.maxOutputChars) {
      throw this.error("maxOutputChars", phase, this.maxOutputChars, this.outputChars);
    }
  }

  private elapsedMs(): number {
    return Math.max(0, this.clock() - this.startedAt);
  }

  private error(
    budget: BudgetName,
    phase: BudgetPhase,
    limit: number,
    observed: number
  ): BudgetExceededError {
    return new BudgetExceededError({ budget, phase, limit, observed });
  }
}

function validateLimit(name: BudgetName, value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0 || (name === "maxTurns" && !Number.isInteger(value))) {
    throw new RangeError(
      name === "maxTurns"
        ? `${name} must be a finite non-negative integer`
        : `${name} must be a finite non-negative number`
    );
  }
  return value;
}
