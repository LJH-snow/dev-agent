import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, win32 } from "node:path";

import type { ChatMessage, ChatUsage, ToolCall } from "@dev-agent/model";
import type {
  ValidationRecord,
  ValidationResult,
  ValidationStatus,
} from "./validation.js";
import { addUsage } from "./usage.js";

export interface MemoryEntry extends ChatMessage {
  readonly id: string;
  readonly createdAt: string;
}

export interface MemoryEntryOptions {
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface ChangeSetEvidenceFile {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly beforeHash?: string;
  readonly afterHash: string;
  readonly additions: number;
  readonly deletions: number;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
}

/** Minimal, non-executable evidence for a change set that was applied locally. */
export interface AppliedChangeSetRecord {
  readonly changeSetId: string;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly files: readonly ChangeSetEvidenceFile[];
  readonly additions: number;
  readonly deletions: number;
  readonly createdAt: string;
  readonly recordedAt: string;
  readonly state: "applied" | "rolled-back";
}

export interface EvidenceRetentionOptions {
  /** Maximum validation attempts retained automatically. */
  readonly maxValidations?: number;
  /** Soft maximum for change-set records; applied records are always protected. */
  readonly maxChangeSets?: number;
}

export interface EvidencePruneOptions extends EvidenceRetentionOptions {
  /** Explicitly remove every non-active (rolled-back) change-set record. */
  readonly removeRolledBack?: boolean;
}

export interface EvidencePruneResult {
  readonly validationsRemoved: number;
  readonly changeSetsRemoved: number;
  readonly protectedChangeSets: number;
  readonly remainingValidations: number;
  readonly remainingChangeSets: number;
}

export const DEFAULT_EVIDENCE_RETENTION = {
  maxValidations: 100,
  maxChangeSets: 100,
} as const;

const MAX_EVIDENCE_RECORDS = 10_000;

export interface AgentMemory {
  append(entry: MemoryEntry): Promise<void>;
  entries(): Promise<readonly MemoryEntry[]>;
  clear(): Promise<void>;
  getMetadata?(): Promise<SessionMetadata | undefined>;
  /** Adds one provider usage report to the session total, when supported. */
  recordUsage?(usage: ChatUsage): Promise<void>;
  compact?(keepRecentTurns: number): Promise<number>;
  /** Digest of entries that were trimmed off the front of the history. */
  getSummary?(): Promise<ContextSummary | undefined>;
  setSummary?(summary: ContextSummary): Promise<void>;
  /** Persists a structured validation result without adding it to model context. */
  recordValidation?(result: ValidationResult): Promise<void>;
  /** Returns structured validation evidence in recording order. */
  validations?(): Promise<readonly ValidationRecord[]>;
  /** Persists non-executable evidence for a successfully applied change set. */
  recordChangeSet?(record: AppliedChangeSetRecord): Promise<void>;
  /** Returns change-set evidence in recording order. */
  changeSets?(): Promise<readonly AppliedChangeSetRecord[]>;
  /** Marks a successfully rolled-back change set without reviving its before-image. */
  markChangeSetRolledBack?(changeSetId: string): Promise<boolean>;
  /** Prunes metadata-only evidence without touching the working directory. */
  pruneEvidence?(options?: EvidencePruneOptions): Promise<EvidencePruneResult>;
}

export interface ContextSummary {
  /** Id of the last entry the digest covers, used to re-anchor after a reload. */
  readonly lastEntryId: string;
  /** How many entries the digest covered when it was written. */
  readonly entriesCovered: number;
  readonly text: string;
}

export class InMemoryMemory implements AgentMemory {
  private readonly items: MemoryEntry[] = [];
  private summary?: ContextSummary;
  private usage?: ChatUsage;
  private readonly validationRecords: ValidationRecord[] = [];
  private readonly changeSetRecords: AppliedChangeSetRecord[] = [];
  private readonly evidenceRetention: Required<EvidenceRetentionOptions>;
  private readonly createdAt = new Date().toISOString();
  private lastActiveAt = this.createdAt;

  constructor(options: { readonly evidenceRetention?: EvidenceRetentionOptions } = {}) {
    this.evidenceRetention = normalizeEvidenceRetention(options.evidenceRetention);
  }

  async append(entry: MemoryEntry): Promise<void> {
    this.items.push(entry);
    this.lastActiveAt = new Date().toISOString();
  }

  async entries(): Promise<readonly MemoryEntry[]> {
    return [...this.items];
  }

  async clear(): Promise<void> {
    this.items.length = 0;
    this.summary = undefined;
    this.usage = undefined;
    this.validationRecords.length = 0;
    this.changeSetRecords.length = 0;
    this.lastActiveAt = new Date().toISOString();
  }

  async getMetadata(): Promise<SessionMetadata> {
    return {
      sessionId: "in-memory",
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      entryCount: this.items.length,
      usage: this.usage,
    };
  }

  async recordUsage(usage: ChatUsage): Promise<void> {
    this.usage = addUsage(this.usage, usage);
    this.lastActiveAt = new Date().toISOString();
  }

  async getSummary(): Promise<ContextSummary | undefined> {
    return this.summary;
  }

  async setSummary(summary: ContextSummary): Promise<void> {
    this.summary = summary;
  }

  async recordValidation(result: ValidationResult): Promise<void> {
    this.validationRecords.push({
      ...result,
      recordedAt: new Date().toISOString(),
    });
    trimValidationRecordsInPlace(this.validationRecords, this.evidenceRetention.maxValidations);
    this.lastActiveAt = new Date().toISOString();
  }

  async validations(): Promise<readonly ValidationRecord[]> {
    return [...this.validationRecords];
  }

  async recordChangeSet(record: AppliedChangeSetRecord): Promise<void> {
    const index = this.changeSetRecords.findIndex(
      (candidate) => candidate.changeSetId === record.changeSetId
    );
    if (index >= 0) {
      assertChangeSetStateTransition(this.changeSetRecords[index], record);
      this.changeSetRecords[index] = record;
    } else {
      this.changeSetRecords.push(record);
    }
    trimChangeSetRecordsInPlace(this.changeSetRecords, this.evidenceRetention.maxChangeSets);
    this.lastActiveAt = new Date().toISOString();
  }

  async changeSets(): Promise<readonly AppliedChangeSetRecord[]> {
    return [...this.changeSetRecords];
  }

  async markChangeSetRolledBack(changeSetId: string): Promise<boolean> {
    const index = this.changeSetRecords.findIndex(
      (candidate) => candidate.changeSetId === changeSetId
    );
    if (index < 0 || this.changeSetRecords[index]?.state !== "applied") {
      return false;
    }
    this.changeSetRecords[index] = { ...this.changeSetRecords[index], state: "rolled-back" };
    trimChangeSetRecordsInPlace(this.changeSetRecords, this.evidenceRetention.maxChangeSets);
    this.lastActiveAt = new Date().toISOString();
    return true;
  }

  async pruneEvidence(options: EvidencePruneOptions = {}): Promise<EvidencePruneResult> {
    const retention = normalizeEvidenceRetention(options, this.evidenceRetention);
    const validationCount = this.validationRecords.length;
    const changeSetCount = this.changeSetRecords.length;
    const protectedChangeSets = this.changeSetRecords.filter(
      (record) => record.state === "applied"
    ).length;
    const validationsRemoved = trimValidationRecordsInPlace(
      this.validationRecords,
      retention.maxValidations
    );
    const changeSetsRemoved = trimChangeSetRecordsInPlace(
      this.changeSetRecords,
      retention.maxChangeSets,
      options.removeRolledBack === true
    );
    if (validationsRemoved > 0 || changeSetsRemoved > 0) {
      this.lastActiveAt = new Date().toISOString();
    }
    return {
      validationsRemoved,
      changeSetsRemoved,
      protectedChangeSets,
      remainingValidations: validationCount - validationsRemoved,
      remainingChangeSets: changeSetCount - changeSetsRemoved,
    };
  }
}

export interface FileMemoryOptions {
  readonly filePath: string;
  readonly evidenceRetention?: EvidenceRetentionOptions;
}

export interface SessionMetadata {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly entryCount: number;
  /** Tokens reported by the provider across every run in this session. */
  readonly usage?: ChatUsage;
}

interface MemoryFile {
  readonly version: 1;
  readonly metadata?: SessionMetadata;
  readonly entries: MemoryEntry[];
  readonly summary?: ContextSummary;
  readonly validations?: ValidationRecord[];
  readonly changeSets?: AppliedChangeSetRecord[];
}

export class FileMemory implements AgentMemory {
  private readonly filePath: string;
  private readonly evidenceRetention: Required<EvidenceRetentionOptions>;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: FileMemoryOptions) {
    this.filePath = options.filePath;
    this.evidenceRetention = normalizeEvidenceRetention(options.evidenceRetention);
  }

  async getMetadata(): Promise<SessionMetadata | undefined> {
    try {
      const file = await this.readMemoryFile();
      return file.metadata;
    } catch {
      return undefined;
    }
  }

  async compact(keepRecentTurns: number): Promise<number> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      const keepEntries = keepRecentTurns * 4;
      if (entries.length <= keepEntries) {
        return 0;
      }
      const removed = entries.length - keepEntries;
      const compacted = entries.slice(-keepEntries);
      await this.persist(compacted);
      return removed;
    });
  }

  append(entry: MemoryEntry): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      entries.push(entry);
      await this.persist(entries);
    });
  }

  entries(): Promise<readonly MemoryEntry[]> {
    return this.enqueue(async () => [...(await this.readEntries())]);
  }

  clear(): Promise<void> {
    return this.enqueue(() => rm(this.filePath, { force: true }));
  }

  async getSummary(): Promise<ContextSummary | undefined> {
    try {
      const file = await this.readMemoryFile();
      return file.summary;
    } catch {
      return undefined;
    }
  }

  setSummary(summary: ContextSummary): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      await this.persist(entries, summary);
    });
  }

  recordValidation(result: ValidationResult): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      const existing = await this.readMemoryFile().catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return undefined;
        }
        throw error;
      });
      const validations = [
        ...(existing?.validations ?? []),
        {
          ...result,
          recordedAt: new Date().toISOString(),
        },
      ];
      trimValidationRecordsInPlace(validations, this.evidenceRetention.maxValidations);
      await this.persist(entries, undefined, undefined, validations);
    });
  }

  validations(): Promise<readonly ValidationRecord[]> {
    return this.enqueue(async () => {
      try {
        const file = await this.readMemoryFile();
        return [...(file.validations ?? [])];
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return [];
        }
        if (error instanceof Error && error.message.startsWith("Invalid memory file:")) {
          throw error;
        }
        throw new Error(`Invalid memory file: ${this.filePath}`);
      }
    });
  }

  recordChangeSet(record: AppliedChangeSetRecord): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      const existing = await this.readMemoryFile().catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return undefined;
        }
        throw error;
      });
      const changeSets = [
        ...(existing?.changeSets ?? []).filter(
          (candidate) => candidate.changeSetId !== record.changeSetId
        ),
        record,
      ];
      const previous = existing?.changeSets?.find(
        (candidate) => candidate.changeSetId === record.changeSetId
      );
      assertChangeSetStateTransition(previous, record);
      trimChangeSetRecordsInPlace(changeSets, this.evidenceRetention.maxChangeSets);
      await this.persist(entries, undefined, undefined, undefined, changeSets);
    });
  }

  changeSets(): Promise<readonly AppliedChangeSetRecord[]> {
    return this.enqueue(async () => {
      try {
        const file = await this.readMemoryFile();
        return [...(file.changeSets ?? [])];
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return [];
        }
        if (error instanceof Error && error.message.startsWith("Invalid memory file:")) {
          throw error;
        }
        throw new Error(`Invalid memory file: ${this.filePath}`);
      }
    });
  }

  markChangeSetRolledBack(changeSetId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const existing = await this.readMemoryFile().catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return undefined;
        }
        throw error;
      });
      const records = [...(existing?.changeSets ?? [])];
      const index = records.findIndex((record) => record.changeSetId === changeSetId);
      if (index < 0 || records[index]?.state !== "applied") {
        return false;
      }
      records[index] = { ...records[index], state: "rolled-back" };
      trimChangeSetRecordsInPlace(records, this.evidenceRetention.maxChangeSets);
      await this.persist(existing?.entries ?? [], undefined, undefined, undefined, records);
      return true;
    });
  }

  pruneEvidence(options: EvidencePruneOptions = {}): Promise<EvidencePruneResult> {
    return this.enqueue(async () => {
      const existing = await this.readMemoryFile().catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return undefined;
        }
        throw error;
      });
      if (!existing) {
        return emptyEvidencePruneResult();
      }

      const retention = normalizeEvidenceRetention(options, this.evidenceRetention);
      const validations = [...(existing.validations ?? [])];
      const changeSets = [...(existing.changeSets ?? [])];
      const protectedChangeSets = changeSets.filter(
        (record) => record.state === "applied"
      ).length;
      const validationsRemoved = trimValidationRecordsInPlace(
        validations,
        retention.maxValidations
      );
      const changeSetsRemoved = trimChangeSetRecordsInPlace(
        changeSets,
        retention.maxChangeSets,
        options.removeRolledBack === true
      );
      if (validationsRemoved > 0 || changeSetsRemoved > 0) {
        await this.persist(existing.entries, undefined, undefined, validations, changeSets);
      }
      return {
        validationsRemoved,
        changeSetsRemoved,
        protectedChangeSets,
        remainingValidations: validations.length,
        remainingChangeSets: changeSets.length,
      };
    });
  }

  recordUsage(usage: ChatUsage): Promise<void> {
    return this.enqueue(async () => {
      const entries = await this.readEntries();
      await this.persist(entries, undefined, usage);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async readEntries(): Promise<MemoryEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid memory file: ${this.filePath}`);
    }
    if (!isMemoryFile(parsed)) {
      throw new Error(`Invalid memory file: ${this.filePath}`);
    }
    return parsed.entries;
  }

  private async persist(
    entries: readonly MemoryEntry[],
    summary?: ContextSummary,
    usage?: ChatUsage,
    validations?: readonly ValidationRecord[],
    changeSets?: readonly AppliedChangeSetRecord[]
  ): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const existing = await this.readMemoryFile().catch(() => undefined);
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      sessionId: existing?.metadata?.sessionId ?? "default",
      createdAt: existing?.metadata?.createdAt ?? now,
      lastActiveAt: now,
      entryCount: entries.length,
      usage: usage === undefined ? existing?.metadata?.usage : addUsage(existing?.metadata?.usage, usage),
    };
    const payload: MemoryFile = {
      version: 1,
      metadata,
      entries: [...entries],
      // Keep an existing digest unless this write replaces it.
      summary: summary ?? existing?.summary,
      validations: validations === undefined ? existing?.validations : [...validations],
      changeSets: changeSets === undefined ? existing?.changeSets : [...changeSets],
    };
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private async readMemoryFile(): Promise<MemoryFile> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isMemoryFile(parsed)) {
      throw new Error(`Invalid memory file: ${this.filePath}`);
    }
    return parsed;
  }
}

export function createMemoryEntry(
  role: ChatMessage["role"],
  content: string,
  options: MemoryEntryOptions = {}
): MemoryEntry {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    toolCalls: options.toolCalls,
  };
}

function normalizeEvidenceRetention(
  options: EvidenceRetentionOptions | undefined,
  fallback: Required<EvidenceRetentionOptions> = DEFAULT_EVIDENCE_RETENTION
): Required<EvidenceRetentionOptions> {
  const maxValidations = options?.maxValidations ?? fallback.maxValidations;
  const maxChangeSets = options?.maxChangeSets ?? fallback.maxChangeSets;
  for (const [name, value] of [
    ["maxValidations", maxValidations],
    ["maxChangeSets", maxChangeSets],
  ] as const) {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > MAX_EVIDENCE_RECORDS
    ) {
      throw new Error(`${name} must be a positive integer no greater than ${MAX_EVIDENCE_RECORDS}`);
    }
  }
  return { maxValidations, maxChangeSets };
}

function trimValidationRecordsInPlace(
  records: ValidationRecord[],
  maxValidations: number
): number {
  const removed = Math.max(0, records.length - maxValidations);
  if (removed > 0) {
    records.splice(0, removed);
  }
  return removed;
}

function trimChangeSetRecordsInPlace(
  records: AppliedChangeSetRecord[],
  maxChangeSets: number,
  removeRolledBack = false
): number {
  let removed = 0;
  if (removeRolledBack) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index]?.state !== "applied") {
        records.splice(index, 1);
        removed += 1;
      }
    }
  }
  while (records.length > maxChangeSets) {
    const removableIndex = records.findIndex((record) => record.state !== "applied");
    if (removableIndex < 0) {
      break;
    }
    records.splice(removableIndex, 1);
    removed += 1;
  }
  return removed;
}

function emptyEvidencePruneResult(): EvidencePruneResult {
  return {
    validationsRemoved: 0,
    changeSetsRemoved: 0,
    protectedChangeSets: 0,
    remainingValidations: 0,
    remainingChangeSets: 0,
  };
}

function assertChangeSetStateTransition(
  previous: AppliedChangeSetRecord | undefined,
  next: AppliedChangeSetRecord
): void {
  if (previous?.state === "rolled-back" && next.state === "applied") {
    throw new Error(
      `cannot reactivate rolled-back change set evidence: ${next.changeSetId}`
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isMemoryFile(value: unknown): value is MemoryFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isMemoryEntry) &&
    (candidate.summary === undefined || isContextSummary(candidate.summary)) &&
    (candidate.metadata === undefined || isSessionMetadataValue(candidate.metadata)) &&
    (candidate.validations === undefined ||
      (Array.isArray(candidate.validations) && candidate.validations.every(isValidationRecord))) &&
    (candidate.changeSets === undefined ||
      (Array.isArray(candidate.changeSets) && candidate.changeSets.every(isAppliedChangeSetRecord)))
  );
}

/** Only the parts a reader relies on are validated; unknown keys are allowed. */
function isSessionMetadataValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const usage = (value as Record<string, unknown>).usage;
  return usage === undefined || isChatUsage(usage);
}

function isChatUsage(value: unknown): value is ChatUsage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).promptTokens === "number" &&
    typeof (value as Record<string, unknown>).completionTokens === "number" &&
    typeof (value as Record<string, unknown>).totalTokens === "number"
  );
}

function isAppliedChangeSetRecord(value: unknown): value is AppliedChangeSetRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.changeSetId === "string" &&
    candidate.changeSetId.length > 0 &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    typeof candidate.workingDirectory === "string" &&
    (isAbsolute(candidate.workingDirectory) || win32.isAbsolute(candidate.workingDirectory)) &&
    Array.isArray(candidate.files) &&
    candidate.files.length > 0 &&
    candidate.files.every(isChangeSetEvidenceFile) &&
    isNonNegativeInteger(candidate.additions) &&
    isNonNegativeInteger(candidate.deletions) &&
    typeof candidate.createdAt === "string" &&
    candidate.createdAt.length > 0 &&
    typeof candidate.recordedAt === "string" &&
    candidate.recordedAt.length > 0 &&
    (candidate.state === "applied" || candidate.state === "rolled-back")
  );
}

function isChangeSetEvidenceFile(value: unknown): value is ChangeSetEvidenceFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    isSafeRelativePath(candidate.path) &&
    (candidate.kind === "file" || candidate.kind === "directory") &&
    isSha256(candidate.afterHash) &&
    (candidate.beforeHash === undefined || isSha256(candidate.beforeHash)) &&
    isNonNegativeInteger(candidate.additions) &&
    isNonNegativeInteger(candidate.deletions) &&
    typeof candidate.beforeExists === "boolean" &&
    typeof candidate.afterExists === "boolean"
  );
}

function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes("\0") || isAbsolute(value) || win32.isAbsolute(value)) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  return normalized !== "." && normalized !== ".." && !normalized.split("/").includes("..");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isValidationRecord(value: unknown): value is ValidationRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.recordedAt === "string" &&
    typeof candidate.validationId === "string" &&
    typeof candidate.changeSetId === "string" &&
    isValidationStatus(candidate.status) &&
    Array.isArray(candidate.checks) &&
    candidate.checks.every(isValidationCheckResult) &&
    typeof candidate.durationMs === "number" &&
    typeof candidate.summary === "string" &&
    (candidate.reason === undefined || typeof candidate.reason === "string")
  );
}

function isValidationCheckResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const command = candidate.command;
  if (typeof command !== "object" || command === null) {
    return false;
  }
  const commandValue = command as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof commandValue.executable === "string" &&
    Array.isArray(commandValue.args) &&
    commandValue.args.every((arg) => typeof arg === "string") &&
    typeof commandValue.cwd === "string" &&
    typeof commandValue.timeoutMs === "number" &&
    isValidationStatus(candidate.status) &&
    typeof candidate.durationMs === "number" &&
    (candidate.exitCode === undefined || typeof candidate.exitCode === "number") &&
    (candidate.output === undefined || typeof candidate.output === "string") &&
    (candidate.error === undefined || typeof candidate.error === "string") &&
    (candidate.reason === undefined || typeof candidate.reason === "string")
  );
}

function isValidationStatus(value: unknown): value is ValidationStatus {
  return value === "passed" || value === "failed" || value === "skipped" || value === "blocked";
}

function isContextSummary(value: unknown): value is ContextSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.lastEntryId === "string" &&
    typeof candidate.entriesCovered === "number" &&
    typeof candidate.text === "string"
  );
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    isChatMessageRole(candidate.role) &&
    typeof candidate.content === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function isChatMessageRole(value: unknown): value is ChatMessage["role"] {
  return value === "system" || value === "user" || value === "assistant" || value === "tool";
}
