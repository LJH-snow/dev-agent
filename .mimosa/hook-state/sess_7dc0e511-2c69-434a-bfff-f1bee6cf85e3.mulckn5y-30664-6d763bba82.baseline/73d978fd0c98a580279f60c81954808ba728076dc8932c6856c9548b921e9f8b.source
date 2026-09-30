export type RuntimeRunStatus =
  | "ready"
  | "thinking"
  | "streaming"
  | "tool-running"
  | "waiting-approval"
  | "validating"
  | "done"
  | "error"
  | "interrupted";

export type RuntimeToolRisk = "read-only" | "mutating" | "dangerous";
export type RuntimeToolConfirmation = "never" | "on-risk" | "always";
export type RuntimeToolResultFormat = "text" | "json" | "diff";

export interface RuntimeToolMetadata {
  readonly risk: RuntimeToolRisk;
  readonly confirmation: RuntimeToolConfirmation;
  readonly resultFormat: RuntimeToolResultFormat;
  readonly supportsProgress: boolean;
}

export interface RuntimeUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cachedPromptTokens?: number;
  readonly cost?: number;
}

export interface RuntimeEventPayloads {
  "session.started": {
    readonly workingDirectory: string;
    readonly client?: "cli" | "desktop" | "api" | string;
  };
  "input.submitted": {
    readonly input: string;
    readonly source: "interactive" | "programmatic" | string;
  };
  "input.queued": {
    readonly input: string;
    readonly position: number;
    readonly queueSize: number;
  };
  "run.started": {
    readonly prompt: string;
    readonly model?: string;
  };
  "run.status": {
    readonly status: RuntimeRunStatus;
    readonly detail?: string;
  };
  "assistant.delta": {
    readonly text: string;
    readonly channel: "answer" | "reasoning";
  };
  "assistant.completed": {
    readonly text: string;
  };
  "usage.reported": RuntimeUsage;
  "tool.started": {
    readonly tool: string;
    readonly input?: unknown;
    readonly metadata?: RuntimeToolMetadata;
  };
  "tool.progress": {
    readonly tool: string;
    readonly progress: number;
    readonly total?: number;
    readonly detail?: string;
  };
  "tool.approval-requested": {
    readonly tool: string;
    readonly input?: unknown;
    readonly reason?: string;
    readonly review?: unknown;
    readonly metadata?: RuntimeToolMetadata;
  };
  "tool.approval-resolved": {
    readonly tool: string;
    readonly decision: "allow" | "deny" | string;
    readonly reason?: string;
  };
  "tool.sandbox-expansion-requested": {
    readonly tool: string;
    readonly capability: "network" | "path" | "unknown";
    readonly reason: string;
    readonly input?: unknown;
    readonly profile?: {
      readonly name: string;
      readonly network?: "enabled" | "disabled" | "loopback";
    };
  };
  "tool.sandbox-expansion-resolved": {
    readonly tool: string;
    readonly capability: "network" | "path" | "unknown";
    readonly decision: "allow" | "deny" | string;
    readonly reason?: string;
  };
  "tool.completed": {
    readonly tool: string;
    readonly output?: string;
    readonly durationMs?: number;
  };
  "tool.failed": {
    readonly tool: string;
    readonly error: string;
    readonly retryable?: boolean;
  };
  "validation.started": {
    readonly validationId?: string;
    readonly detail?: string;
  };
  "validation.completed": {
    readonly validationId?: string;
    readonly status: "passed" | "failed" | "blocked" | "skipped";
    readonly detail?: string;
  };
  "checkpoint.created": {
    readonly checkpointId: string;
    readonly entryCount: number;
    readonly changeSetIds: readonly string[];
  };
  "run.completed": {
    readonly turns: number;
  };
  "run.interrupted": {
    readonly reason: string;
  };
  "run.failed": {
    readonly error: string;
    readonly code?: string;
  };
}

export type RuntimeEventType = keyof RuntimeEventPayloads;

export interface RuntimeEventEnvelope<
  TType extends RuntimeEventType,
  TData extends RuntimeEventPayloads[TType],
> {
  readonly version: 1;
  readonly sequence: number;
  readonly emittedAt: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly type: TType;
  readonly data: TData;
}

export type RuntimeEventFor<TType extends RuntimeEventType> =
  RuntimeEventEnvelope<TType, RuntimeEventPayloads[TType]>;

export type RuntimeEvent = {
  [TType in RuntimeEventType]: RuntimeEventFor<TType>;
}[RuntimeEventType];

export type RuntimeEventSink = (event: RuntimeEvent) => void;

export interface RuntimeEventOptions {
  readonly runId?: string;
  readonly emittedAt?: string;
}

export function createRuntimeEvent<TType extends RuntimeEventType>(
  sequence: number,
  sessionId: string,
  type: TType,
  data: RuntimeEventPayloads[TType],
  options: RuntimeEventOptions = {},
  now: () => string = () => new Date().toISOString(),
): RuntimeEventFor<TType> {
  const copiedData = { ...data } as RuntimeEventPayloads[TType];
  return {
    version: 1,
    sequence,
    emittedAt: options.emittedAt ?? now(),
    sessionId,
    ...(options.runId === undefined ? {} : { runId: options.runId }),
    type,
    data: copiedData,
  } as RuntimeEventFor<TType>;
}

export class RuntimeEventSequence {
  private nextSequence = 0;

  constructor(
    private readonly sessionId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  create<TType extends RuntimeEventType>(
    type: TType,
    data: RuntimeEventPayloads[TType],
    options: RuntimeEventOptions = {},
  ): RuntimeEventFor<TType> {
    this.nextSequence += 1;
    return createRuntimeEvent(
      this.nextSequence,
      this.sessionId,
      type,
      data,
      options,
      this.now,
    );
  }

  get currentSequence(): number {
    return this.nextSequence;
  }
}
