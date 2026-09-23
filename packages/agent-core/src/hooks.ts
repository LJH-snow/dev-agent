import type { ChatUsage, ProviderTiming } from "@dev-agent/model";

export type AgentHookName =
  | "session.start"
  | "before.model"
  | "after.model"
  | "before.tool"
  | "after.tool"
  | "session.end";

export interface AgentHookContext {
  readonly sessionId: string;
  readonly runId?: string;
  readonly turn?: number;
  readonly inputSummary?: string;
  readonly toolName?: string;
  readonly toolInputSummary?: string;
  readonly outputPreview?: string;
  readonly status?: string;
  readonly error?: string;
  /** ISO timestamp captured at the lifecycle boundary. */
  readonly occurredAt?: string;
  /** Correlates the before/after hook pair for one model or tool operation. */
  readonly operationId?: string;
  /** Usage reported by the model call, when the provider supplied it. */
  readonly usage?: ChatUsage;
  readonly providerTiming?: ProviderTiming;
  readonly signal?: AbortSignal;
}

export interface AgentHookError {
  readonly hook: AgentHookName;
  readonly message: string;
  readonly occurredAt: string;
}

export type AgentHook = (context: AgentHookContext) => void | Promise<void>;
export type RemoveAgentHook = () => void;

interface RegisteredHook {
  readonly id: number;
  readonly observer: AgentHook;
}

/**
 * Runs local observers in a deterministic order. Observer failures are
 * retained for diagnostics but never become agent failures; abort signals are
 * the one exception and propagate between observers.
 */
export class AgentHookRegistry {
  private readonly observers = new Map<AgentHookName, RegisteredHook[]>();
  private readonly hookErrors: AgentHookError[] = [];
  private nextId = 0;

  register(name: AgentHookName, observer: AgentHook): RemoveAgentHook {
    const entry: RegisteredHook = { id: ++this.nextId, observer };
    const list = this.observers.get(name) ?? [];
    list.push(entry);
    this.observers.set(name, list);
    return () => {
      const current = this.observers.get(name);
      if (!current) return;
      const remaining = current.filter((candidate) => candidate.id !== entry.id);
      if (remaining.length === 0) {
        this.observers.delete(name);
      } else {
        this.observers.set(name, remaining);
      }
    };
  }

  async run(name: AgentHookName, context: AgentHookContext, signal?: AbortSignal): Promise<void> {
    const observers = [...(this.observers.get(name) ?? [])];
    for (const { observer } of observers) {
      throwIfAborted(signal);
      try {
        await observer({ ...context, signal });
      } catch (error) {
        if (signal?.aborted) {
          throw signal.reason ?? error;
        }
        this.hookErrors.push({
          hook: name,
          message: error instanceof Error ? error.message : String(error),
          occurredAt: new Date().toISOString(),
        });
      }
      throwIfAborted(signal);
    }
  }

  errors(): readonly AgentHookError[] {
    return this.hookErrors.map((error) => ({ ...error }));
  }

  clearErrors(): void {
    this.hookErrors.length = 0;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("The operation was aborted");
  }
}
