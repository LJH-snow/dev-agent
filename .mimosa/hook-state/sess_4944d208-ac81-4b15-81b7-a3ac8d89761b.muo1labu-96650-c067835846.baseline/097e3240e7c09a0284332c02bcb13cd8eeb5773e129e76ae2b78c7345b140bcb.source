import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const STATE_VERSION = 1;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_DEFINITIONS = 64;
const MAX_RUNS_PER_DEFINITION = 20;
const MAX_RUN_BYTES = 8 * 1024;
const MAX_TITLE_CHARS = 120;
const MAX_REPO_CHARS = 512;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_ID_PATTERN = /^sched-[a-z0-9]{6,16}-[a-z0-9]{6,16}$/iu;
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T[^\r\n]{1,48}Z$/u;

export type ScheduleCadence = "interval" | "daily";
export type ScheduleJobKind = "ci-watch";

export interface ScheduleDefinition {
  readonly id: string;
  readonly title: string;
  readonly job: ScheduleJobKind;
  readonly repo?: string;
  readonly kind: ScheduleCadence;
  readonly intervalMinutes?: number;
  readonly timeOfDay?: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly lastRunAt?: string;
  readonly nextRunAt?: string;
}

export interface ScheduleRunRecord {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly ok: boolean;
  readonly trigger: "schedule" | "manual";
  readonly summary: Record<string, unknown>;
}

export interface ScheduleDefinitionPatch {
  readonly title?: string;
  readonly repo?: string;
  readonly intervalMinutes?: number;
  readonly timeOfDay?: string;
  readonly enabled?: boolean;
}

export type ScheduleMutationResult =
  | { readonly ok: true; readonly schedule: ScheduleDefinition }
  | { readonly ok: false; readonly code: "invalid-title" | "invalid-job" | "invalid-repo" | "invalid-cadence" | "invalid-definition" | "unknown-schedule" | "schedule-limit" | "state-unavailable" };

function boundedText(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim().slice(0, maxChars) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIso(value: unknown): string | undefined {
  return typeof value === "string" && ISO_PATTERN.test(value) ? value : undefined;
}

export function normalizeScheduleTimeOfDay(value: unknown): string | undefined {
  return typeof value === "string" && TIME_OF_DAY_PATTERN.test(value.trim()) ? value.trim() : undefined;
}

/** Validates the mutable fields of a schedule definition for create and update. */
export function validateScheduleInput(value: unknown): {
  ok: true;
  title?: string;
  job?: ScheduleJobKind;
  repo?: string;
  kind?: ScheduleCadence;
  intervalMinutes?: number;
  timeOfDay?: string;
  enabled?: boolean;
} | { ok: false; code: "invalid-title" | "invalid-job" | "invalid-repo" | "invalid-cadence" } {
  if (!isRecord(value)) return { ok: false, code: "invalid-cadence" };
  const out: { title?: string; job?: ScheduleJobKind; repo?: string; kind?: ScheduleCadence; intervalMinutes?: number; timeOfDay?: string; enabled?: boolean } = {};
  if (value.title !== undefined) {
    const title = boundedText(value.title, MAX_TITLE_CHARS);
    if (!title) return { ok: false, code: "invalid-title" };
    out.title = title;
  }
  if (value.job !== undefined) {
    if (value.job !== "ci-watch") return { ok: false, code: "invalid-job" };
    out.job = value.job;
  }
  if (value.repo !== undefined) {
    const repo = boundedText(value.repo, MAX_REPO_CHARS);
    if (!repo) return { ok: false, code: "invalid-repo" };
    out.repo = repo;
  }
  if (value.kind !== undefined) {
    if (value.kind !== "interval" && value.kind !== "daily") return { ok: false, code: "invalid-cadence" };
    out.kind = value.kind;
  }
  if (value.intervalMinutes !== undefined) {
    const minutes = value.intervalMinutes;
    if (typeof minutes !== "number" || !Number.isSafeInteger(minutes)
      || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) return { ok: false, code: "invalid-cadence" };
    out.intervalMinutes = minutes;
  }
  if (value.timeOfDay !== undefined) {
    const timeOfDay = normalizeScheduleTimeOfDay(value.timeOfDay);
    if (!timeOfDay) return { ok: false, code: "invalid-cadence" };
    out.timeOfDay = timeOfDay;
  }
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== "boolean") return { ok: false, code: "invalid-cadence" };
    out.enabled = value.enabled;
  }
  return { ok: true, ...out };
}

/** Validates a full definition shape, e.g. when loading persisted state. */
export function normalizeScheduleDefinition(value: unknown): ScheduleDefinition | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !SCHEDULE_ID_PATTERN.test(value.id)) return undefined;
  const validated = validateScheduleInput({
    title: value.title, job: value.job, repo: value.repo, kind: value.kind,
    intervalMinutes: value.intervalMinutes, timeOfDay: value.timeOfDay, enabled: value.enabled,
  });
  if (!validated.ok || validated.title === undefined || validated.job === undefined || validated.kind === undefined) return undefined;
  const createdAt = normalizeIso(value.createdAt);
  if (!createdAt) return undefined;
  if (validated.kind === "interval" && validated.intervalMinutes === undefined) return undefined;
  if (validated.kind === "daily" && validated.timeOfDay === undefined) return undefined;
  return {
    id: value.id,
    title: validated.title,
    job: validated.job,
    ...(validated.repo === undefined ? {} : { repo: validated.repo }),
    kind: validated.kind,
    ...(validated.intervalMinutes === undefined ? {} : { intervalMinutes: validated.intervalMinutes }),
    ...(validated.timeOfDay === undefined ? {} : { timeOfDay: validated.timeOfDay }),
    enabled: validated.enabled ?? true,
    createdAt,
    ...(normalizeIso(value.lastRunAt) === undefined ? {} : { lastRunAt: normalizeIso(value.lastRunAt) }),
    ...(normalizeIso(value.nextRunAt) === undefined ? {} : { nextRunAt: normalizeIso(value.nextRunAt) }),
  };
}

/**
 * Pure cadence math. Interval schedules always advance from the reference time
 * (the moment the run fired), which is what bounds catch-up after downtime to
 * a single run. Daily schedules keep the local wall-clock time.
 */
export function computeNextRunAt(cadence: {
  readonly kind: ScheduleCadence;
  readonly intervalMinutes?: number;
  readonly timeOfDay?: string;
}, nowMs: number): number {
  if (cadence.kind === "interval") {
    const minutes = cadence.intervalMinutes ?? MIN_INTERVAL_MINUTES;
    return nowMs + minutes * 60_000;
  }
  const [hours, minutes] = (cadence.timeOfDay ?? "09:00").split(":").map((part) => Number(part));
  const candidate = new Date(nowMs);
  candidate.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  if (candidate.getTime() <= nowMs) candidate.setTime(candidate.getTime() + DAY_MS);
  // Re-derive from local components so DST shifts keep the wall-clock time.
  const next = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate(), hours ?? 0, minutes ?? 0, 0, 0);
  return next.getTime() <= nowMs ? next.getTime() + DAY_MS : next.getTime();
}

function normalizeRunSummary(summary: unknown): Record<string, unknown> {
  if (!isRecord(summary)) return {};
  const serialized = JSON.stringify(summary);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") <= MAX_RUN_BYTES) return summary;
  return { truncated: true };
}

function normalizeRunRecord(value: unknown): ScheduleRunRecord | undefined {
  if (!isRecord(value) || typeof value.ok !== "boolean"
    || (value.trigger !== "schedule" && value.trigger !== "manual")) return undefined;
  const startedAt = normalizeIso(value.startedAt);
  const finishedAt = normalizeIso(value.finishedAt);
  if (!startedAt || !finishedAt) return undefined;
  return {
    startedAt, finishedAt, ok: value.ok, trigger: value.trigger,
    summary: normalizeRunSummary(value.summary),
  };
}

export interface ScheduledTaskManagerOptions {
  readonly stateFile: string;
  readonly now?: () => number;
  /** Executes a due job; the manager stays job-agnostic. */
  readonly runJob?: (definition: ScheduleDefinition, trigger: ScheduleRunRecord["trigger"]) =>
    Promise<{ ok: boolean; summary: Record<string, unknown> }>;
}

interface StoredState {
  readonly version: number;
  readonly definitions: ScheduleDefinition[];
  readonly runs: Record<string, ScheduleRunRecord[]>;
}

export class ScheduledTaskManager {
  private readonly stateFile: string;
  private readonly now: () => number;
  private readonly runJob: NonNullable<ScheduledTaskManagerOptions["runJob"]>;
  private readonly definitions = new Map<string, ScheduleDefinition>();
  private readonly runs = new Map<string, ScheduleRunRecord[]>();
  private readonly running = new Set<string>();

  constructor(options: ScheduledTaskManagerOptions) {
    this.stateFile = resolve(options.stateFile);
    this.now = options.now ?? Date.now;
    this.runJob = options.runJob ?? (async () => ({ ok: false, summary: { code: "no-executor" } }));
    this.load();
  }

  list(): ScheduleDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): ScheduleDefinition | undefined {
    return this.definitions.get(id);
  }

  history(id: string): ScheduleRunRecord[] {
    return [...(this.runs.get(id) ?? [])];
  }

  async create(input: unknown): Promise<ScheduleMutationResult> {
    const validated = validateScheduleInput(input);
    if (!validated.ok) return validated;
    if (validated.title === undefined || validated.job === undefined || validated.kind === undefined
      || (validated.kind === "interval" && validated.intervalMinutes === undefined)
      || (validated.kind === "daily" && validated.timeOfDay === undefined)) {
      return { ok: false, code: "invalid-definition" };
    }
    if (this.definitions.size >= MAX_DEFINITIONS) return { ok: false, code: "schedule-limit" };
    const nowMs = this.now();
    const definition: ScheduleDefinition = {
      id: `sched-${nowMs.toString(36)}-${randomBytes(6).toString("hex")}`,
      title: validated.title,
      job: validated.job,
      ...(validated.repo === undefined ? {} : { repo: validated.repo }),
      kind: validated.kind,
      ...(validated.intervalMinutes === undefined ? {} : { intervalMinutes: validated.intervalMinutes }),
      ...(validated.timeOfDay === undefined ? {} : { timeOfDay: validated.timeOfDay }),
      enabled: validated.enabled ?? true,
      createdAt: new Date(nowMs).toISOString(),
      nextRunAt: new Date(computeNextRunAt(
        { kind: validated.kind, intervalMinutes: validated.intervalMinutes, timeOfDay: validated.timeOfDay },
        nowMs,
      )).toISOString(),
    };
    this.definitions.set(definition.id, definition);
    if (!await this.persist()) return { ok: false, code: "state-unavailable" };
    return { ok: true, schedule: definition };
  }

  async update(id: string, patch: unknown): Promise<ScheduleMutationResult> {
    const existing = this.definitions.get(id);
    if (!existing) return { ok: false, code: "unknown-schedule" };
    const validated = validateScheduleInput(patch);
    if (!validated.ok) return validated;
    const kind = validated.kind ?? existing.kind;
    const intervalMinutes = validated.intervalMinutes ?? (kind === "interval" ? existing.intervalMinutes : undefined);
    const timeOfDay = validated.timeOfDay ?? (kind === "daily" ? existing.timeOfDay : undefined);
    if (kind === "interval" && intervalMinutes === undefined) return { ok: false, code: "invalid-definition" };
    if (kind === "daily" && timeOfDay === undefined) return { ok: false, code: "invalid-definition" };
    const enabled = validated.enabled ?? existing.enabled;
    const cadenceChanged = validated.kind !== undefined || validated.intervalMinutes !== undefined || validated.timeOfDay !== undefined;
    const nextRunAt = !enabled
      ? existing.nextRunAt
      : cadenceChanged || enabled !== existing.enabled || !existing.nextRunAt
        ? new Date(computeNextRunAt({ kind, intervalMinutes, timeOfDay }, this.now())).toISOString()
        : existing.nextRunAt;
    // Destructure out both cadence fields so the previous kind's field cannot
    // survive the spread; only the active kind's field is written back.
    const { intervalMinutes: _existingInterval, timeOfDay: _existingTime, ...rest } = existing;
    const updated: ScheduleDefinition = {
      ...rest,
      title: validated.title ?? existing.title,
      ...(validated.repo === undefined && existing.repo === undefined ? {} : { repo: validated.repo ?? existing.repo }),
      kind,
      ...(intervalMinutes === undefined ? {} : { intervalMinutes }),
      ...(timeOfDay === undefined ? {} : { timeOfDay }),
      enabled,
      nextRunAt,
    };
    this.definitions.set(id, updated);
    if (!await this.persist()) return { ok: false, code: "state-unavailable" };
    return { ok: true, schedule: updated };
  }

  async remove(id: string): Promise<boolean> {
    if (!this.definitions.delete(id)) return false;
    this.runs.delete(id);
    await this.persist();
    return true;
  }

  /** Fires every due, enabled, not-currently-running definition once. */
  async tick(trigger: ScheduleRunRecord["trigger"] = "schedule"): Promise<ScheduleRunRecord[]> {
    const nowMs = this.now();
    const due = this.list().filter((definition) => definition.enabled
      && definition.nextRunAt !== undefined
      && Date.parse(definition.nextRunAt) <= nowMs
      && !this.running.has(definition.id));
    const recorded: ScheduleRunRecord[] = [];
    for (const definition of due) {
      recorded.push(await this.runOne(definition, trigger));
    }
    if (recorded.length > 0) await this.persist();
    return recorded;
  }

  /** Manual, out-of-band run of one definition regardless of nextRunAt. */
  async runNow(id: string): Promise<{ ok: true; record: ScheduleRunRecord } | { ok: false; code: "unknown-schedule" | "already-running" }> {
    const definition = this.definitions.get(id);
    if (!definition) return { ok: false, code: "unknown-schedule" };
    if (this.running.has(id)) return { ok: false, code: "already-running" };
    const record = await this.runOne(definition, "manual");
    await this.persist();
    return { ok: true, record };
  }

  private async runOne(definition: ScheduleDefinition, trigger: ScheduleRunRecord["trigger"]): Promise<ScheduleRunRecord> {
    this.running.add(definition.id);
    const startedMs = this.now();
    let result: { ok: boolean; summary: Record<string, unknown> };
    try {
      result = await this.runJob(definition, trigger);
    } catch (error) {
      result = { ok: false, summary: { code: "job-error", message: String((error as Error)?.message ?? "failed").slice(0, 200) } };
    }
    const finishedMs = this.now();
    const record: ScheduleRunRecord = {
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: new Date(finishedMs).toISOString(),
      ok: result?.ok === true,
      trigger,
      summary: normalizeRunSummary(result?.summary),
    };
    this.running.delete(definition.id);
    const history = [record, ...(this.runs.get(definition.id) ?? [])].slice(0, MAX_RUNS_PER_DEFINITION);
    this.runs.set(definition.id, history);
    const nextMs = computeNextRunAt(definition, startedMs);
    this.definitions.set(definition.id, {
      ...definition,
      lastRunAt: record.startedAt,
      nextRunAt: new Date(nextMs).toISOString(),
    });
    return record;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.stateFile, "utf8");
    } catch {
      return;
    }
    if (!raw || Buffer.byteLength(raw, "utf8") > MAX_STATE_BYTES) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed) || parsed.version !== STATE_VERSION || !Array.isArray(parsed.definitions)) return;
    for (const candidate of parsed.definitions.slice(0, MAX_DEFINITIONS)) {
      const definition = normalizeScheduleDefinition(candidate);
      if (definition) this.definitions.set(definition.id, definition);
    }
    if (isRecord(parsed.runs)) {
      for (const [id, records] of Object.entries(parsed.runs)) {
        if (!Array.isArray(records)) continue;
        const history = records.slice(0, MAX_RUNS_PER_DEFINITION)
          .map(normalizeRunRecord)
          .filter((record): record is ScheduleRunRecord => record !== undefined);
        if (history.length > 0) this.runs.set(id, history);
      }
    }
  }

  private async persist(): Promise<boolean> {
    const state: StoredState = {
      version: STATE_VERSION,
      definitions: this.list(),
      runs: Object.fromEntries([...this.runs.entries()]),
    };
    const payload = JSON.stringify(state);
    if (Buffer.byteLength(payload, "utf8") > MAX_STATE_BYTES) return false;
    try {
      await mkdir(dirname(this.stateFile), { recursive: true, mode: 0o700 });
      const temporary = `${this.stateFile}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.stateFile);
      return true;
    } catch {
      return false;
    }
  }
}
