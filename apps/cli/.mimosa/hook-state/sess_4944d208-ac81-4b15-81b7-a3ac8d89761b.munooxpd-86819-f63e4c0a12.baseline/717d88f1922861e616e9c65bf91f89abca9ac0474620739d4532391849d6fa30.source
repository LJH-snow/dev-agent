import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

const MAX_RECORDS = 256;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_CHARS = 2_000;
const MAX_SOURCE_CHARS = 120;
const MAX_QUERY_CHARS = 120;
const MEMORY_ID_PATTERN = /^memory-[a-z0-9]{4,64}$/iu;

export type ProjectMemoryConfidence = "low" | "medium" | "high";

export interface ProjectMemoryRecord {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly confidence: ProjectMemoryConfidence;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectMemoryAddInput {
  readonly content: string;
  readonly source?: string;
  readonly confidence?: ProjectMemoryConfidence;
}

interface ProjectMemoryFile {
  readonly version: 1;
  readonly records: readonly ProjectMemoryRecord[];
}

export type ProjectMemoryCommand =
  | { readonly kind: "list" }
  | {
      readonly kind: "add";
      readonly content: string;
      readonly source: string;
      readonly confidence: ProjectMemoryConfidence;
    }
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "forget"; readonly id: string };

export interface ProjectMemoryOptions {
  readonly filePath: string;
  readonly maxRecords?: number;
}

export interface ProjectMemoryCommandOptions {
  readonly store: ProjectMemoryStore;
  readonly confirm: (prompt: string) => Promise<boolean>;
}

export interface ProjectMemoryCommandResult {
  readonly ok: boolean;
  readonly message: string;
  readonly command?: ProjectMemoryCommand["kind"];
}

export class ProjectMemoryStore {
  private readonly filePath: string;
  private readonly maxRecords: number;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: ProjectMemoryOptions) {
    if (!options.filePath.trim()) throw new Error("project memory file path is required");
    const maxRecords = options.maxRecords ?? MAX_RECORDS;
    if (!Number.isSafeInteger(maxRecords) || maxRecords <= 0 || maxRecords > MAX_RECORDS) {
      throw new Error(`project memory maxRecords must be between 1 and ${MAX_RECORDS}`);
    }
    this.filePath = options.filePath;
    this.maxRecords = maxRecords;
  }

  list(): Promise<readonly ProjectMemoryRecord[]> {
    return this.enqueue(async () => [...await this.readRecords()]);
  }

  search(query: string): Promise<readonly ProjectMemoryRecord[]> {
    const normalized = normalizeBoundedText(query, MAX_QUERY_CHARS);
    if (!normalized) return Promise.resolve([]);
    const needle = normalized.toLocaleLowerCase();
    return this.enqueue(async () =>
      (await this.readRecords()).filter((record) =>
        `${record.content}\n${record.source}`.toLocaleLowerCase().includes(needle),
      ),
    );
  }

  add(input: ProjectMemoryAddInput): Promise<ProjectMemoryRecord> {
    return this.enqueue(async () => {
      const content = normalizeBoundedText(input.content, MAX_CONTENT_CHARS);
      if (!content) throw new Error("project memory content is required");
      const source = normalizeBoundedText(input.source ?? "user", MAX_SOURCE_CHARS) || "user";
      const confidence = input.confidence ?? "medium";
      assertConfidence(confidence);
      const now = new Date().toISOString();
      const record: ProjectMemoryRecord = {
        id: `memory-${randomUUID().replace(/-/gu, "").slice(0, 8)}`,
        content,
        source,
        confidence,
        createdAt: now,
        updatedAt: now,
      };
      const records = [...await this.readRecords(), record];
      while (records.length > this.maxRecords) records.shift();
      await this.persist(records);
      return record;
    });
  }

  forget(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const records = await this.readRecords();
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return false;
      records.splice(index, 1);
      await this.persist(records);
      return true;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readRecords(): Promise<ProjectMemoryRecord[]> {
    let raw: string;
    try {
      const file = await stat(this.filePath);
      if (file.size > MAX_FILE_BYTES) throw new Error("project memory file exceeds its read limit");
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error instanceof Error && error.message.includes("project memory file")
        ? error
        : new Error("project memory could not be read");
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isProjectMemoryFile(parsed)) throw new Error("invalid project memory file");
      return [...parsed.records];
    } catch {
      throw new Error("invalid project memory file");
    }
  }

  private async persist(records: readonly ProjectMemoryRecord[]): Promise<void> {
    const payload: ProjectMemoryFile = { version: 1, records: [...records] };
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_BYTES) {
      throw new Error("project memory file exceeds its write limit");
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export function parseProjectMemoryCommand(value: string): ProjectMemoryCommand | undefined {
  const tokens = tokenize(value.trim().replace(/^\//u, ":"));
  if (tokens === undefined || tokens.length === 0 || tokens[0]?.toLowerCase() !== ":memory") {
    return undefined;
  }
  if (tokens.length === 1) return { kind: "list" };
  const action = tokens[1]?.toLowerCase();
  if (action === "search") {
    const query = normalizeBoundedText(tokens.slice(2).join(" "), MAX_QUERY_CHARS);
    return query ? { kind: "search", query } : undefined;
  }
  if (action === "forget") {
    const id = tokens[2];
    return tokens.length === 3 && id !== undefined && MEMORY_ID_PATTERN.test(id)
      ? { kind: "forget", id }
      : undefined;
  }
  if (action !== "add") return undefined;

  let source = "user";
  let confidence: ProjectMemoryConfidence = "medium";
  const content: string[] = [];
  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--source" || token === "--confidence") {
      const next = tokens[index + 1];
      if (next === undefined) return undefined;
      if (token === "--source") source = next;
      else if (next === "low" || next === "medium" || next === "high") confidence = next;
      else return undefined;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) return undefined;
    content.push(token);
  }
  const normalizedContent = normalizeBoundedText(content.join(" "), MAX_CONTENT_CHARS);
  const normalizedSource = normalizeBoundedText(source, MAX_SOURCE_CHARS);
  if (!normalizedContent || !normalizedSource) return undefined;
  return { kind: "add", content: normalizedContent, source: normalizedSource, confidence };
}

export function isProjectMemoryCommand(value: string): boolean {
  return /^\s*[:\/]memory(?:\s|$)/iu.test(value);
}

export async function executeProjectMemoryCommand(
  value: string | ProjectMemoryCommand,
  options: ProjectMemoryCommandOptions,
): Promise<ProjectMemoryCommandResult> {
  const command = typeof value === "string" ? parseProjectMemoryCommand(value) : value;
  if (command === undefined) {
    return {
      ok: false,
      message: "Usage: :memory · :memory add [--source <source>] [--confidence low|medium|high] <note> · :memory search <query> · :memory forget <id>",
    };
  }
  switch (command.kind) {
    case "list": {
      const records = await options.store.list();
      return { ok: true, command: command.kind, message: formatProjectMemory(records) };
    }
    case "search": {
      const records = await options.store.search(command.query);
      return { ok: true, command: command.kind, message: formatProjectMemory(records, `Project memory search · ${command.query}`) };
    }
    case "add": {
      const accepted = await options.confirm(
        `Save project memory [${command.confidence}] from ${command.source}: "${oneLine(command.content)}"?`,
      );
      if (!accepted) return { ok: false, command: command.kind, message: "Project memory not saved." };
      const record = await options.store.add(command);
      return { ok: true, command: command.kind, message: `Saved project memory ${record.id}.` };
    }
    case "forget": {
      const records = await options.store.list();
      const record = records.find((candidate) => candidate.id === command.id);
      if (record === undefined) return { ok: false, command: command.kind, message: `Project memory ${command.id} was not found.` };
      const accepted = await options.confirm(`Forget project memory ${record.id}: "${oneLine(record.content)}"?`);
      if (!accepted) return { ok: false, command: command.kind, message: "Project memory kept." };
      const removed = await options.store.forget(record.id);
      return removed
        ? { ok: true, command: command.kind, message: `Forgot project memory ${record.id}.` }
        : { ok: false, command: command.kind, message: `Project memory ${record.id} was not found.` };
    }
  }
}

function formatProjectMemory(
  records: readonly ProjectMemoryRecord[],
  heading = "Project memory",
): string {
  if (records.length === 0) return `${heading}\nNo project memory found.`;
  return [
    `${heading} · ${records.length}`,
    ...records.map((record) =>
      `- ${record.id} [${record.confidence}] ${oneLine(record.content)} · source=${oneLine(record.source)} · ${record.updatedAt.slice(0, 10)}`,
    ),
  ].join("\n");
}

function oneLine(value: string): string {
  return sanitizeTerminalText(redactSensitiveText(value)).replace(/[\r\n]+/gu, " ").slice(0, 240);
}

function normalizeBoundedText(value: string, maxChars: number): string {
  return sanitizeTerminalText(redactSensitiveText(value)).trim().slice(0, maxChars);
}

function assertConfidence(value: string): asserts value is ProjectMemoryConfidence {
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new Error("project memory confidence must be low, medium, or high");
  }
}

function isProjectMemoryFile(value: unknown): value is ProjectMemoryFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProjectMemoryFile>;
  return candidate.version === 1 && Array.isArray(candidate.records) &&
    candidate.records.length <= MAX_RECORDS && candidate.records.every(isProjectMemoryRecord);
}

function isProjectMemoryRecord(value: unknown): value is ProjectMemoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ProjectMemoryRecord>;
  return typeof record.id === "string" && MEMORY_ID_PATTERN.test(record.id) &&
    typeof record.content === "string" && record.content.length > 0 && record.content.length <= MAX_CONTENT_CHARS &&
    typeof record.source === "string" && record.source.length > 0 && record.source.length <= MAX_SOURCE_CHARS &&
    (record.confidence === "low" || record.confidence === "medium" || record.confidence === "high") &&
    typeof record.createdAt === "string" && typeof record.updatedAt === "string";
}

function tokenize(value: string): string[] | undefined {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else current += character;
  }
  if (quote !== undefined || escaped) return undefined;
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
