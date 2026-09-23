export type AgentTaskStatus =
  | "queued"
  | "running"
  | "waiting-for-confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentTaskSnapshot {
  readonly id: string;
  readonly status: AgentTaskStatus;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly detail?: string;
}

export interface AgentTaskExecutionContext {
  readonly signal: AbortSignal;
  readonly setStatus: (
    status: "running" | "waiting-for-confirmation",
    detail?: string
  ) => AgentTaskSnapshot;
}

export interface AgentTaskScheduleOptions<T> {
  readonly id?: string;
  readonly run: (context: AgentTaskExecutionContext) => Promise<T> | T;
}

export interface AgentTaskSchedulerOptions {
  readonly concurrency?: number;
  readonly maxRetained?: number;
  readonly now?: () => string;
  readonly idFactory?: () => string;
}

interface TaskRecord<T> {
  readonly id: string;
  readonly run: (context: AgentTaskExecutionContext) => Promise<T> | T;
  readonly controller: AbortController;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  snapshot: AgentTaskSnapshot;
  cancelRequested: boolean;
  cancelReason?: string;
  settled: boolean;
}

export class AgentTaskCancelledError extends Error {
  readonly code = "task_cancelled";
  readonly taskId: string;

  constructor(taskId: string, reason = "task cancelled") {
    super(reason);
    this.name = "AgentTaskCancelledError";
    this.taskId = taskId;
  }
}

/**
 * Runs caller-owned local work with bounded concurrency and metadata-only
 * lifecycle snapshots. It does not persist work or detach it from the host.
 */
export class AgentTaskScheduler {
  private readonly concurrency: number;
  private readonly maxRetained: number;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly tasks = new Map<string, TaskRecord<unknown>>();
  private readonly queue: string[] = [];
  private activeCount = 0;
  private generatedId = 0;

  constructor(options: AgentTaskSchedulerOptions = {}) {
    this.concurrency = positiveInteger(options.concurrency, 1, "concurrency");
    this.maxRetained = positiveInteger(options.maxRetained, 64, "maxRetained");
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `task-${++this.generatedId}`);
  }

  schedule<T>(options: AgentTaskScheduleOptions<T>): Promise<T> {
    if (typeof options.run !== "function") {
      throw new TypeError("task runner must be a function");
    }
    const id = normalizeTaskId(options.id ?? this.nextId());
    if (this.tasks.has(id)) {
      throw new Error(`duplicate task id: ${id}`);
    }

    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((next, fail) => {
      resolve = next;
      reject = fail;
    });
    const record: TaskRecord<T> = {
      id,
      run: options.run,
      controller: new AbortController(),
      resolve,
      reject,
      snapshot: {
        id,
        status: "queued",
        createdAt: this.now(),
      },
      cancelRequested: false,
      settled: false,
    };
    this.tasks.set(id, record as TaskRecord<unknown>);
    this.queue.push(id);
    this.pump();
    return promise;
  }

  list(): readonly AgentTaskSnapshot[] {
    return [...this.tasks.values()].map((record) => ({ ...record.snapshot }));
  }

  get(id: string): AgentTaskSnapshot | undefined {
    const record = this.tasks.get(id);
    return record === undefined ? undefined : { ...record.snapshot };
  }

  cancel(id: string, reason = "task cancelled"): boolean {
    const record = this.tasks.get(id);
    if (record === undefined || isTerminal(record.snapshot.status)) {
      return false;
    }
    record.cancelRequested = true;
    record.cancelReason = safeDetail(reason) ?? "task cancelled";
    record.snapshot = {
      ...record.snapshot,
      status: "cancelled",
      finishedAt: this.now(),
      detail: record.cancelReason,
    };
    record.controller.abort(new AgentTaskCancelledError(id, record.cancelReason));
    this.rejectCancelled(record);
    this.pump();
    return true;
  }

  private nextId(): string {
    let id = this.idFactory();
    while (this.tasks.has(id)) {
      id = this.idFactory();
    }
    return id;
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      if (id === undefined) return;
      const record = this.tasks.get(id);
      if (record === undefined || record.cancelRequested) continue;
      this.activeCount += 1;
      record.snapshot = {
        ...record.snapshot,
        status: "running",
        startedAt: this.now(),
      };
      void this.execute(record);
    }
    this.prune();
  }

  private async execute<T>(record: TaskRecord<T>): Promise<void> {
    try {
      const value = await record.run({
        signal: record.controller.signal,
        setStatus: (status, detail) => this.setRunningStatus(record, status, detail),
      });
      if (record.cancelRequested) {
        this.rejectCancelled(record);
      } else {
        record.snapshot = {
          ...record.snapshot,
          status: "completed",
          finishedAt: this.now(),
        };
        this.settleResolve(record, value);
      }
    } catch (error) {
      if (record.cancelRequested || record.controller.signal.aborted) {
        record.cancelRequested = true;
        record.snapshot = {
          ...record.snapshot,
          status: "cancelled",
          finishedAt: record.snapshot.finishedAt ?? this.now(),
          detail: record.cancelReason ?? "task cancelled",
        };
        this.rejectCancelled(record);
      } else {
        record.snapshot = {
          ...record.snapshot,
          status: "failed",
          finishedAt: this.now(),
          detail: "runner_failed",
        };
        this.settleReject(record, error);
      }
    } finally {
      this.activeCount -= 1;
      this.prune();
      this.pump();
    }
  }

  private setRunningStatus<T>(
    record: TaskRecord<T>,
    status: "running" | "waiting-for-confirmation",
    detail?: string
  ): AgentTaskSnapshot {
    if (
      record.cancelRequested ||
      record.snapshot.status !== "running" &&
      record.snapshot.status !== "waiting-for-confirmation"
    ) {
      return { ...record.snapshot };
    }
    const safe = safeDetail(detail);
    record.snapshot = {
      ...record.snapshot,
      status,
      ...(safe === undefined ? {} : { detail: safe }),
    };
    return { ...record.snapshot };
  }

  private rejectCancelled<T>(record: TaskRecord<T>): void {
    this.settleReject(
      record,
      new AgentTaskCancelledError(record.id, record.cancelReason ?? "task cancelled"),
    );
  }

  private settleResolve<T>(record: TaskRecord<T>, value: T): void {
    if (record.settled) return;
    record.settled = true;
    record.resolve(value);
  }

  private settleReject<T>(record: TaskRecord<T>, error: unknown): void {
    if (record.settled) return;
    record.settled = true;
    record.reject(error);
  }

  private prune(): void {
    if (this.tasks.size <= this.maxRetained) return;
    for (const [id, record] of this.tasks) {
      if (this.tasks.size <= this.maxRetained) break;
      if (!isTerminal(record.snapshot.status)) continue;
      this.tasks.delete(id);
    }
  }
}

function isTerminal(status: AgentTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function normalizeTaskId(value: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error("task id must not be empty");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(normalized)) {
    throw new Error("task id must be a safe identifier");
  }
  return normalized;
}

function safeDetail(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (normalized === "") return undefined;
  return normalized
    .replace(/(^|\s)(?:\/|~\/|[A-Za-z]:[\\/])\S*/gu, "$1[path]")
    .slice(0, 160);
}
