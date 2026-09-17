import { createHash } from "node:crypto";
import { readFile as fsReadFile, unlink as fsUnlink } from "node:fs/promises";
import { isAbsolute } from "node:path";

export const INDEX_SCHEMA_VERSION = 1 as const;

export type IndexStatusState = "ready" | "missing" | "invalid" | "incompatible" | "error";

export type IndexStatusErrorCode =
  | "not_found"
  | "invalid_json"
  | "invalid_shape"
  | "schema_incompatible"
  | "read_error";

export interface IndexStatus {
  readonly status: IndexStatusState;
  readonly usable: boolean;
  readonly schemaVersion: number | null;
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly hasSignatures: boolean;
  /** Metadata from the last completed refresh; null for legacy indexes. */
  readonly cacheHits: number | null;
  readonly cacheMisses: number | null;
  readonly cacheHitRate: number | null;
  readonly errorCount: number;
  readonly updatedAt: string | null;
  readonly errorCode?: IndexStatusErrorCode;
}

export type ReadIndexFile = (path: string) => Promise<string>;
export type RemoveIndexFile = (path: string) => Promise<void>;

export interface GetIndexStatusOptions {
  readonly indexPath: string;
  readonly readFile?: ReadIndexFile;
  readonly expectedSchemaVersion?: number;
}

interface FileSignature {
  readonly mtimeMs: number;
  readonly size: number;
  readonly ctimeMs: number;
}

interface ParsedIndexDocument {
  readonly version: typeof INDEX_SCHEMA_VERSION;
  readonly files: Readonly<Record<string, string>>;
  readonly symbols: readonly unknown[];
  readonly signatures?: Readonly<Record<string, FileSignature>>;
  readonly refresh?: {
    readonly updatedAt: string;
    readonly cacheHits: number;
    readonly cacheMisses: number;
    readonly errors: number;
  };
}

type ParseIndexResult =
  | { readonly ok: true; readonly document: ParsedIndexDocument }
  | {
      readonly ok: false;
      readonly status: "invalid" | "incompatible";
      readonly schemaVersion: number | null;
      readonly errorCode: "invalid_json" | "invalid_shape" | "schema_incompatible";
    };

export interface ClearIndexOptions {
  readonly indexPath: string;
  readonly confirm?: boolean;
  readonly dryRun?: boolean;
  readonly removeFile?: RemoveIndexFile;
}

export type ClearIndexResult =
  | { readonly status: "blocked"; readonly cleared: false; readonly reason: "confirmation_required" | "unsafe_path" }
  | { readonly status: "dry_run"; readonly cleared: false }
  | { readonly status: "cleared"; readonly cleared: true }
  | { readonly status: "missing"; readonly cleared: false }
  | { readonly status: "error"; readonly cleared: false; readonly errorCode: string };

export interface FileInventoryEntry {
  /** A project-relative path. Absolute paths are rejected by the refresh planner. */
  readonly path: string;
  /** A caller-provided content fingerprint. The fingerprint is never returned by the planner. */
  readonly fingerprint?: string;
  /** Optional stat tuple used to avoid hashing unchanged files. */
  readonly signature?: FileSignature;
  /** A stable filesystem category for an entry that could not be inspected. */
  readonly errorCode?: string;
}

export interface InventoryError {
  readonly path?: string;
  readonly errorCode?: string;
}

export interface IncrementalRefreshOptions {
  /** The existing v1 index JSON. */
  readonly indexJson?: string;
  /** A parsed existing index, useful for callers that already loaded it. */
  readonly index?: unknown;
  readonly inventory: readonly FileInventoryEntry[];
  readonly inventoryErrors?: readonly InventoryError[];
  readonly expectedSchemaVersion?: number;
}

export type RefreshAction =
  | { readonly kind: "reuse"; readonly path: string }
  | { readonly kind: "add"; readonly path: string }
  | { readonly kind: "update"; readonly path: string }
  | { readonly kind: "delete"; readonly path: string }
  | { readonly kind: "rename"; readonly from: string; readonly to: string }
  | { readonly kind: "error"; readonly path?: string; readonly errorCode: string };

export interface RefreshStats {
  readonly totalIndexed: number;
  readonly totalInventory: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly added: number;
  readonly updated: number;
  readonly deleted: number;
  readonly renamed: number;
  readonly errors: number;
  readonly actions: number;
}

export type IncrementalRefreshPlan =
  | {
      readonly status: "ready";
      readonly usable: true;
      readonly schemaVersion: typeof INDEX_SCHEMA_VERSION;
      readonly actions: readonly RefreshAction[];
      readonly stats: RefreshStats;
    }
  | {
      readonly status: "invalid" | "incompatible";
      readonly usable: false;
      readonly schemaVersion: number | null;
      readonly errorCode: "invalid_json" | "invalid_shape" | "schema_incompatible";
      readonly actions: readonly [];
      readonly stats: RefreshStats;
    };

const EMPTY_STATS: RefreshStats = Object.freeze({
  totalIndexed: 0,
  totalInventory: 0,
  cacheHits: 0,
  cacheMisses: 0,
  added: 0,
  updated: 0,
  deleted: 0,
  renamed: 0,
  errors: 0,
  actions: 0,
});

/**
 * Reads only the metadata needed to describe an existing code index.
 * Source text, symbols, error messages, and the requested path are never
 * included in the returned value.
 */
export async function getIndexStatus(options: GetIndexStatusOptions): Promise<IndexStatus> {
  const reader = options.readFile ?? defaultReadIndexFile;
  let raw: string;
  try {
    raw = await reader(options.indexPath);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return makeIndexStatus("missing", null, "not_found");
    }
    return makeIndexStatus("error", null, "read_error");
  }

  const parsed = parseIndexDocument(raw, options.expectedSchemaVersion ?? INDEX_SCHEMA_VERSION);
  if (!parsed.ok) {
    return makeIndexStatus(parsed.status, parsed.schemaVersion, parsed.errorCode);
  }

  const refresh = parsed.document.refresh;
  const totalRefreshFiles = refresh === undefined ? 0 : refresh.cacheHits + refresh.cacheMisses;
  return {
    status: "ready",
    usable: true,
    schemaVersion: parsed.document.version,
    fileCount: Object.keys(parsed.document.files).length,
    symbolCount: parsed.document.symbols.length,
    hasSignatures: parsed.document.signatures !== undefined,
    cacheHits: refresh?.cacheHits ?? null,
    cacheMisses: refresh?.cacheMisses ?? null,
    cacheHitRate: refresh === undefined
      ? null
      : totalRefreshFiles === 0
        ? 1
        : refresh.cacheHits / totalRefreshFiles,
    errorCount: refresh?.errors ?? 0,
    updatedAt: refresh?.updatedAt ?? null,
  };
}

/**
 * Removes exactly one explicitly confirmed index file. The function is
 * intentionally fail-closed: callers must opt in, dry-runs never delete, and
 * directory/root-like targets are rejected before the remover is called.
 */
export async function clearIndex(options: ClearIndexOptions): Promise<ClearIndexResult> {
  if (!isSafeIndexTarget(options.indexPath)) {
    return { status: "blocked", cleared: false, reason: "unsafe_path" };
  }
  if (options.dryRun === true) {
    return { status: "dry_run", cleared: false };
  }
  if (options.confirm !== true) {
    return { status: "blocked", cleared: false, reason: "confirmation_required" };
  }

  const remover = options.removeFile ?? defaultRemoveIndexFile;
  try {
    await remover(options.indexPath);
    return { status: "cleared", cleared: true };
  } catch (error) {
    const code = getErrorCode(error);
    if (code === "ENOENT") {
      return { status: "missing", cleared: false };
    }
    return { status: "error", cleared: false, errorCode: stableErrorCode(code) };
  }
}

/**
 * Produces a metadata-only refresh plan from the persisted v1 index and an
 * already-created inventory. It never traverses directories, reads source
 * files, or returns source text; the inventory owns all filesystem work.
 */
export function createIncrementalRefreshPlan(options: IncrementalRefreshOptions): IncrementalRefreshPlan {
  const source = options.indexJson !== undefined ? options.indexJson : options.index;
  const parsed = parseIndexDocument(source, options.expectedSchemaVersion ?? INDEX_SCHEMA_VERSION);
  if (!parsed.ok) {
    return {
      status: parsed.status,
      usable: false,
      schemaVersion: parsed.schemaVersion,
      errorCode: parsed.errorCode,
      actions: [],
      stats: EMPTY_STATS,
    };
  }

  const document = parsed.document;
  const actions: RefreshAction[] = [];
  const indexedPaths = Object.keys(document.files);
  const seenIndexedPaths = new Set<string>();
  const seenInventoryPaths = new Set<string>();
  const unmatchedIndexedPaths = new Set(indexedPaths);
  const inventory = options.inventory ?? [];

  for (const entry of inventory) {
    const rawPath = typeof entry.path === "string" ? entry.path : "";
    if (seenInventoryPaths.has(rawPath)) {
      actions.push({
        kind: "error",
        path: toSafeRelativePath(rawPath),
        errorCode: "duplicate_path",
      });
      continue;
    }
    seenInventoryPaths.add(rawPath);

    const safePath = toSafeRelativePath(rawPath);
    const indexedSource = document.files[rawPath];
    const hasIndexedFile = Object.prototype.hasOwnProperty.call(document.files, rawPath);

    if (safePath === undefined) {
      if (hasIndexedFile) {
        seenIndexedPaths.add(rawPath);
        unmatchedIndexedPaths.delete(rawPath);
      }
      actions.push({ kind: "error", errorCode: "absolute_path_rejected" });
      continue;
    }

    if (entry.errorCode !== undefined) {
      if (hasIndexedFile) {
        seenIndexedPaths.add(rawPath);
        unmatchedIndexedPaths.delete(rawPath);
      }
      actions.push({ kind: "error", path: safePath, errorCode: stableErrorCode(entry.errorCode) });
      continue;
    }

    if (hasIndexedFile) {
      seenIndexedPaths.add(rawPath);
      unmatchedIndexedPaths.delete(rawPath);
      if (indexedSource !== undefined && isCacheHit(document, rawPath, indexedSource, entry)) {
        actions.push({ kind: "reuse", path: safePath });
      } else {
        actions.push({ kind: "update", path: safePath });
      }
      continue;
    }

    const renamedFrom = findRenameCandidate(document, unmatchedIndexedPaths, entry);
    if (renamedFrom !== undefined) {
      const safeFrom = toSafeRelativePath(renamedFrom);
      if (safeFrom !== undefined) {
        seenIndexedPaths.add(renamedFrom);
        unmatchedIndexedPaths.delete(renamedFrom);
        actions.push({ kind: "rename", from: safeFrom, to: safePath });
        continue;
      }
    }

    actions.push({ kind: "add", path: safePath });
  }

  for (const rawPath of unmatchedIndexedPaths) {
    if (seenIndexedPaths.has(rawPath)) continue;
    const safePath = toSafeRelativePath(rawPath);
    if (safePath === undefined) {
      actions.push({ kind: "error", errorCode: "absolute_path_rejected" });
      continue;
    }
    actions.push({ kind: "delete", path: safePath });
  }

  for (const inventoryError of options.inventoryErrors ?? []) {
    const safePath = toSafeRelativePath(inventoryError.path);
    actions.push({
      kind: "error",
      ...(safePath === undefined ? {} : { path: safePath }),
      errorCode: stableErrorCode(inventoryError.errorCode),
    });
  }

  const summarized = summarizeIncrementalRefresh(actions);
  return {
    status: "ready",
    usable: true,
    schemaVersion: document.version,
    actions,
    stats: {
      ...summarized,
      totalIndexed: indexedPaths.length,
      totalInventory: inventory.length + (options.inventoryErrors?.length ?? 0),
    },
  };
}

/** A short alias for callers that name the operation as a planning step. */
export const planIncrementalRefresh = createIncrementalRefreshPlan;

/**
 * Counts refresh actions without inspecting the filesystem. This is pure and
 * deliberately excludes source content and fingerprints from its output.
 */
export function summarizeIncrementalRefresh(actions: readonly RefreshAction[]): RefreshStats {
  let cacheHits = 0;
  let cacheMisses = 0;
  let added = 0;
  let updated = 0;
  let deleted = 0;
  let renamed = 0;
  let errors = 0;

  for (const action of actions) {
    switch (action.kind) {
      case "reuse":
        cacheHits += 1;
        break;
      case "add":
        cacheMisses += 1;
        added += 1;
        break;
      case "update":
        cacheMisses += 1;
        updated += 1;
        break;
      case "delete":
        deleted += 1;
        break;
      case "rename":
        renamed += 1;
        break;
      case "error":
        errors += 1;
        break;
    }
  }

  return {
    totalIndexed: 0,
    totalInventory: 0,
    cacheHits,
    cacheMisses,
    added,
    updated,
    deleted,
    renamed,
    errors,
    actions: actions.length,
  };
}

export const getIncrementalRefreshStats = summarizeIncrementalRefresh;

function parseIndexDocument(source: unknown, expectedSchemaVersion: number): ParseIndexResult {
  let value: unknown = source;
  if (typeof source === "string") {
    try {
      value = JSON.parse(source) as unknown;
    } catch {
      return { ok: false, status: "invalid", schemaVersion: null, errorCode: "invalid_json" };
    }
  }

  if (!isRecord(value)) {
    return { ok: false, status: "invalid", schemaVersion: null, errorCode: "invalid_shape" };
  }

  const schemaVersion = typeof value.version === "number" ? value.version : null;
  if (schemaVersion !== expectedSchemaVersion) {
    if (schemaVersion !== null) {
      return { ok: false, status: "incompatible", schemaVersion, errorCode: "schema_incompatible" };
    }
    return { ok: false, status: "invalid", schemaVersion: null, errorCode: "invalid_shape" };
  }
  if (expectedSchemaVersion !== INDEX_SCHEMA_VERSION) {
    return { ok: false, status: "incompatible", schemaVersion, errorCode: "schema_incompatible" };
  }

  if (!isStringRecord(value.files) || !Array.isArray(value.symbols)) {
    return { ok: false, status: "invalid", schemaVersion, errorCode: "invalid_shape" };
  }

  let signatures: Readonly<Record<string, FileSignature>> | undefined;
  if (value.signatures !== undefined) {
    if (!isRecord(value.signatures)) {
      return { ok: false, status: "invalid", schemaVersion, errorCode: "invalid_shape" };
    }
    const parsedSignatures: Record<string, FileSignature> = {};
    for (const [path, signature] of Object.entries(value.signatures)) {
      if (!isFileSignature(signature)) {
        return { ok: false, status: "invalid", schemaVersion, errorCode: "invalid_shape" };
      }
      parsedSignatures[path] = signature;
    }
    signatures = parsedSignatures;
  }

  const refresh = parseRefreshMetadata(value.refresh);
  return {
    ok: true,
    document: {
      version: INDEX_SCHEMA_VERSION,
      files: value.files,
      symbols: value.symbols,
      ...(signatures === undefined ? {} : { signatures }),
      ...(refresh === undefined ? {} : { refresh }),
    },
  };
}

function parseRefreshMetadata(value: unknown): ParsedIndexDocument["refresh"] | undefined {
  if (!isRecord(value)) return undefined;
  const updatedAt = value.updatedAt;
  const cacheHits = value.cacheHits;
  const cacheMisses = value.cacheMisses;
  const errors = value.errors;
  if (
    typeof updatedAt !== "string" ||
    typeof cacheHits !== "number" ||
    typeof cacheMisses !== "number" ||
    typeof errors !== "number" ||
    !Number.isFinite(cacheHits) ||
    !Number.isFinite(cacheMisses) ||
    !Number.isFinite(errors) ||
    cacheHits < 0 ||
    cacheMisses < 0 ||
    errors < 0
  ) {
    return undefined;
  }
  return {
    updatedAt: updatedAt.slice(0, 64),
    cacheHits: Math.floor(cacheHits),
    cacheMisses: Math.floor(cacheMisses),
    errors: Math.floor(errors),
  };
}

function makeIndexStatus(
  status: IndexStatusState,
  schemaVersion: number | null,
  errorCode: IndexStatusErrorCode
): IndexStatus {
  return {
    status,
    usable: false,
    schemaVersion,
    fileCount: 0,
    symbolCount: 0,
    hasSignatures: false,
    cacheHits: null,
    cacheMisses: null,
    cacheHitRate: null,
    errorCount: 0,
    updatedAt: null,
    errorCode,
  };
}

function isCacheHit(
  document: ParsedIndexDocument,
  rawPath: string,
  indexedSource: string,
  entry: FileInventoryEntry
): boolean {
  const indexedSignature = document.signatures?.[rawPath];
  if (indexedSignature !== undefined && entry.signature !== undefined) {
    return signaturesEqual(indexedSignature, entry.signature);
  }
  if (entry.fingerprint === undefined) return false;
  return fingerprint(indexedSource) === entry.fingerprint;
}

function findRenameCandidate(
  document: ParsedIndexDocument,
  unmatchedIndexedPaths: ReadonlySet<string>,
  entry: FileInventoryEntry
): string | undefined {
  if (entry.fingerprint === undefined) return undefined;
  for (const rawPath of unmatchedIndexedPaths) {
    const source = document.files[rawPath];
    if (source !== undefined && fingerprint(source) === entry.fingerprint) {
      return rawPath;
    }
  }
  return undefined;
}

function signaturesEqual(left: FileSignature, right: FileSignature): boolean {
  return left.mtimeMs === right.mtimeMs && left.size === right.size && left.ctimeMs === right.ctimeMs;
}

function toSafeRelativePath(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    isAbsolute(normalized) ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return undefined;
  }
  return normalized.replace(/^\.\//, "");
}

function isSafeIndexTarget(indexPath: string): boolean {
  const normalized = indexPath.trim().replaceAll("\\", "/");
  if (!normalized || normalized === "/" || normalized === "." || normalized.endsWith("/")) return false;
  const lastSegment = normalized.slice(normalized.lastIndexOf("/") + 1);
  // Custom index paths may use names such as `custom-index.json`, but the
  // suffix must still identify an index file rather than an arbitrary config.
  return /(?:^|[-_.])index\.json$/.test(lastSegment);
}

function fingerprint(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isFileSignature(value: unknown): value is FileSignature {
  return (
    isRecord(value) &&
    typeof value.mtimeMs === "number" &&
    Number.isFinite(value.mtimeMs) &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    typeof value.ctimeMs === "number" &&
    Number.isFinite(value.ctimeMs)
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function stableErrorCode(code: string | undefined): string {
  if (code === undefined || code.length === 0) return "unknown";
  return /^[A-Z0-9_]+$/.test(code) ? code : "unknown";
}

async function defaultReadIndexFile(path: string): Promise<string> {
  return fsReadFile(path, "utf8");
}

async function defaultRemoveIndexFile(path: string): Promise<void> {
  await fsUnlink(path);
}
