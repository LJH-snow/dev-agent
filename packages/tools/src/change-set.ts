import { createHash, randomUUID } from "node:crypto";

export type ChangeSetFileKind = "file" | "directory";
export type ChangeSetContent = string | Uint8Array | undefined;

export interface ChangeSetFileInput {
  readonly path: string;
  readonly kind?: ChangeSetFileKind;
  readonly before?: ChangeSetContent;
  readonly after?: ChangeSetContent;
  readonly beforeExists?: boolean;
  readonly afterExists?: boolean;
}

export interface ChangeSetFileReview {
  readonly path: string;
  readonly kind: ChangeSetFileKind;
  readonly beforeHash?: string;
  readonly afterHash: string;
  readonly diff: string;
  readonly additions: number;
  readonly deletions: number;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
}

export interface ChangeSetReview {
  readonly changeSetId: string;
  readonly files: readonly ChangeSetFileReview[];
  readonly additions: number;
  readonly deletions: number;
  readonly createdAt: string;
}

export interface UnifiedDiffResult {
  readonly diff: string;
  readonly additions: number;
  readonly deletions: number;
}

const EMPTY_BYTES = new Uint8Array();

/** Creates an opaque identifier for one preview/apply/rollback lifecycle. */
export function createChangeSetId(): string {
  return randomUUID();
}

/** Returns a lowercase SHA-256 digest for the exact bytes supplied. */
export function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Builds a text-oriented unified diff from two file snapshots.
 *
 * The comparison is line based and uses an LCS so unchanged lines remain
 * context in the resulting diff. Missing snapshots are treated as empty for
 * diff purposes, while existence and hashes remain explicit in the review.
 */
export function buildUnifiedDiff(
  path: string,
  before: string | undefined,
  after: string | undefined
): UnifiedDiffResult {
  const beforeLines = splitDiffLines(before);
  const afterLines = splitDiffLines(after);

  if (before === after) {
    return { diff: "", additions: 0, deletions: 0 };
  }

  const operations = diffLines(beforeLines, afterLines);
  let additions = 0;
  let deletions = 0;
  for (const operation of operations) {
    if (operation.kind === "insert") {
      additions += 1;
    } else if (operation.kind === "delete") {
      deletions += 1;
    }
  }

  const header = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${formatRangeStart(beforeLines.length)},${beforeLines.length} +${formatRangeStart(afterLines.length)},${afterLines.length} @@`,
  ];
  const body = operations.map((operation) => `${operation.prefix}${operation.line}`);
  return {
    diff: [...header, ...body].join("\n") + "\n",
    additions,
    deletions,
  };
}

/** Turns byte/string snapshots into one reviewable file record. */
export function createChangeSetFileReview(input: ChangeSetFileInput): ChangeSetFileReview {
  const beforeBytes = toBytes(input.before);
  const afterBytes = toBytes(input.after);
  const beforeExists = input.beforeExists ?? input.before !== undefined;
  const afterExists = input.afterExists ?? input.after !== undefined;
  const beforeText = toText(input.before);
  const afterText = toText(input.after);
  const diff = buildUnifiedDiff(input.path, beforeText, afterText);

  return {
    path: input.path,
    kind: input.kind ?? "file",
    ...(beforeExists ? { beforeHash: hashBytes(beforeBytes) } : {}),
    afterHash: hashBytes(afterBytes),
    diff: diff.diff,
    additions: diff.additions,
    deletions: diff.deletions,
    beforeExists,
    afterExists,
  };
}

/** Aggregates per-file review information without changing its ordering. */
export function createChangeSetReview(
  files: readonly ChangeSetFileReview[],
  options: { readonly changeSetId?: string; readonly createdAt?: string } = {}
): ChangeSetReview {
  return {
    changeSetId: options.changeSetId ?? createChangeSetId(),
    files: [...files],
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

type DiffOperation =
  | { readonly kind: "equal"; readonly line: string; readonly prefix: " " }
  | { readonly kind: "delete"; readonly line: string; readonly prefix: "-" }
  | { readonly kind: "insert"; readonly line: string; readonly prefix: "+" };

function toBytes(value: ChangeSetContent): Uint8Array {
  if (value === undefined) {
    return EMPTY_BYTES;
  }
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

function toText(value: ChangeSetContent): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function splitDiffLines(source: string | undefined): string[] {
  if (source === undefined || source === "") {
    return [];
  }
  const withoutTerminator = source.endsWith("\n") ? source.slice(0, -1) : source;
  return withoutTerminator.split("\n");
}

function formatRangeStart(lineCount: number): number {
  return lineCount === 0 ? 0 : 1;
}

function diffLines(before: readonly string[], after: readonly string[]): DiffOperation[] {
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    Array<number>(after.length + 1).fill(0)
  );

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex]![afterIndex] =
        before[beforeIndex] === after[afterIndex]
          ? table[beforeIndex + 1]![afterIndex + 1]! + 1
          : Math.max(table[beforeIndex + 1]![afterIndex]!, table[beforeIndex]![afterIndex + 1]!);
    }
  }

  const operations: DiffOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    const beforeLine = before[beforeIndex];
    const afterLine = after[afterIndex];
    if (beforeLine !== undefined && beforeLine === afterLine) {
      operations.push({ kind: "equal", line: beforeLine, prefix: " " });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const keepAfter = afterIndex < after.length ? table[beforeIndex]![afterIndex + 1]! : -1;
    const keepBefore = beforeIndex < before.length ? table[beforeIndex + 1]![afterIndex]! : -1;
    if (beforeIndex < before.length && (afterIndex >= after.length || keepBefore >= keepAfter)) {
      operations.push({ kind: "delete", line: before[beforeIndex]!, prefix: "-" });
      beforeIndex += 1;
    } else {
      operations.push({ kind: "insert", line: after[afterIndex]!, prefix: "+" });
      afterIndex += 1;
    }
  }
  return operations;
}
