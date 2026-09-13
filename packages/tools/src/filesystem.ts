import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, win32 } from "node:path";

import type { AppliedChangeSetRecord, ChangeSetEvidenceFile } from "@dev-agent/agent-core";

import {
  createChangeSetFileReview,
  createChangeSetReview,
  hashBytes,
  type ChangeSetFileReview,
  type ChangeSetReview,
} from "./change-set.js";
import type { Tool, ToolExecutionContext } from "./index.js";

export type FilesystemMutationAction = "write" | "edit" | "patch" | "mkdir";
export type FilesystemAction =
  | "read"
  | FilesystemMutationAction
  | "list"
  | "stat"
  | "preview"
  | "apply"
  | "rollback";

/** Reading without an explicit limit stops after this many lines. */
const DEFAULT_READ_LIMIT = 2000;
const MAX_CHANGE_SETS = 64;

export interface PatchHunk {
  readonly oldText: string;
  readonly newText: string;
}

export interface FilesystemMutationInput {
  readonly action: FilesystemMutationAction;
  readonly path: string;
  readonly content?: string;
  readonly oldText?: string;
  readonly newText?: string;
  readonly hunks?: readonly PatchHunk[];
}

interface FilesystemInput {
  readonly action: FilesystemAction;
  readonly path?: string;
  readonly content?: string;
  readonly oldText?: string;
  readonly newText?: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly hunks?: readonly PatchHunk[];
  readonly changes?: readonly FilesystemMutationInput[];
  readonly changeSetId?: string;
}

export interface ChangeSetApplyResult {
  readonly ok: true;
  readonly changeSetId: string;
  readonly files: readonly ChangeSetFileReview[];
  readonly additions: number;
  readonly deletions: number;
}

export interface PreparedChangeSet {
  readonly review: ChangeSetReview;
  readonly executeInput: { readonly action: "apply"; readonly changeSetId: string };
}

export interface ChangeSetRestoreResult {
  readonly changeSetId: string;
  readonly status: "restored" | "blocked";
  readonly reason?: string;
}

interface FileSnapshot {
  readonly exists: boolean;
  readonly kind?: "file" | "directory";
  readonly bytes?: Buffer;
  readonly mode?: number;
}

interface PreparedMutation {
  readonly action: FilesystemMutationAction;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly review: ChangeSetFileReview;
  readonly beforeExists: boolean;
  readonly beforeBytes?: Buffer;
  readonly beforeMode?: number;
  readonly afterExists: boolean;
  readonly afterBytes?: Buffer;
  readonly afterMode?: number;
  readonly createdDirs: readonly string[];
}

interface StoredChangeSet {
  readonly review: ChangeSetReview;
  readonly mutations: readonly PreparedMutation[];
  state: "prepared" | "applied" | "rolled-back";
  readonly restored?: boolean;
}

export class FilesystemTool implements Tool {
  readonly name = "filesystem" as const;
  readonly description =
    "Read (optionally a line range), preview and review writes, atomically apply or rollback a change set, write, edit by replacing a unique snippet, patch several snippets atomically, list, stat, or create directories on the local filesystem.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "read",
          "write",
          "edit",
          "patch",
          "list",
          "stat",
          "mkdir",
          "preview",
          "apply",
          "rollback",
        ],
      },
      path: { type: "string" },
      content: { type: "string" },
      oldText: { type: "string", description: "Text to replace in an edit; must match exactly once." },
      newText: { type: "string", description: "Replacement text for an edit; may be empty." },
      offset: { type: "integer", minimum: 1, description: "First line to read (1-based)." },
      limit: { type: "integer", minimum: 1, description: "Maximum lines to read." },
      hunks: {
        type: "array",
        description: "Patch hunks; every hunk must match exactly once or nothing is written.",
        items: {
          type: "object",
          properties: {
            oldText: { type: "string" },
            newText: { type: "string" },
          },
          required: ["oldText", "newText"],
        },
      },
      changes: {
        type: "array",
        description: "Mutations to preview as one reviewed change set.",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["write", "edit", "patch", "mkdir"] },
            path: { type: "string" },
            content: { type: "string" },
            oldText: { type: "string" },
            newText: { type: "string" },
            hunks: { type: "array" },
          },
          required: ["action", "path"],
        },
      },
      changeSetId: {
        type: "string",
        description: "The reviewed change-set id to apply or rollback.",
      },
    },
    required: ["action"],
  };

  private readonly changeSets = new Map<string, StoredChangeSet>();
  private readonly activeChangeSets = new Set<string>();

  async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
    const params = parseFilesystemInput(input);
    const cwd = context?.workingDirectory ?? process.cwd();

    switch (params.action) {
      case "read":
        return readFileRange(resolve(cwd, resolveRequiredPath(params)), params.offset ?? 1, params.limit ?? DEFAULT_READ_LIMIT);
      case "write": {
        const target = resolve(cwd, resolveRequiredPath(params));
        await writeFile(target, params.content ?? "", "utf8");
        return { ok: true, path: target };
      }
      case "edit":
        return editFile(resolve(cwd, resolveRequiredPath(params)), params.oldText!, params.newText!);
      case "patch":
        return patchFile(resolve(cwd, resolveRequiredPath(params)), params.hunks!);
      case "list": {
        const target = resolve(cwd, resolveRequiredPath(params));
        const entries = await readdir(target, { withFileTypes: true });
        return {
          path: target,
          entries: entries.map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
          })),
        };
      }
      case "stat": {
        const target = resolve(cwd, resolveRequiredPath(params));
        const fileStat = await stat(target);
        return {
          path: target,
          size: fileStat.size,
          isDirectory: fileStat.isDirectory(),
          isFile: fileStat.isFile(),
        };
      }
      case "mkdir": {
        const target = resolve(cwd, resolveRequiredPath(params));
        await mkdir(target, { recursive: true });
        return { ok: true, path: target };
      }
      case "preview":
        return this.previewMutations(params.changes!, cwd);
      case "apply":
        return this.applyChangeSet(params.changeSetId!);
      case "rollback":
        return this.rollbackChangeSet(params.changeSetId!);
    }
  }

  async prepareChangeSet(
    input: unknown,
    context?: Pick<ToolExecutionContext, "sessionId" | "workingDirectory">
  ): Promise<PreparedChangeSet> {
    const params = parseFilesystemInput(input);
    if (params.action === "preview") {
      const review = await this.previewMutations(
        params.changes!,
        context?.workingDirectory ?? process.cwd()
      );
      return {
        review,
        executeInput: { action: "apply", changeSetId: review.changeSetId },
      };
    }
    if (!isFilesystemMutationAction(params.action)) {
      throw new Error(`filesystem action ${params.action} cannot be prepared as a change set`);
    }

    const review = await this.previewMutations(
      [toMutationInput(params)],
      context?.workingDirectory ?? process.cwd()
    );
    return {
      review,
      executeInput: { action: "apply", changeSetId: review.changeSetId },
    };
  }

  /**
   * Runs a read-only operation against an applied change set while holding the
   * same per-change-set lock used by apply and rollback. The postimage is
   * checked both before and after the callback so validation cannot silently
   * cross a user edit or race an Undo operation.
   */
  async withAppliedChangeSet<T>(
    changeSetId: string,
    callback: (review: ChangeSetReview) => Promise<T> | T
  ): Promise<T> {
    const record = this.requireChangeSet(changeSetId);
    if (record.state !== "applied") {
      throw new Error(
        `filesystem change set ${changeSetId} cannot be used because it is ${record.state}`
      );
    }
    this.beginChangeSet(changeSetId);
    try {
      await preflightForValidation(record);
      const result = await callback(record.review);
      await preflightForValidation(record);
      return result;
    } finally {
      this.endChangeSet(changeSetId);
    }
  }

  /**
   * Rehydrates a previously applied change set from non-executable evidence.
   * The record is accepted only when it belongs to this session/workspace and
   * every recorded postimage still matches. Restored records intentionally do
   * not contain before-images and therefore cannot be rolled back.
   */
  async restoreAppliedChangeSet(
    record: AppliedChangeSetRecord,
    context: Pick<ToolExecutionContext, "sessionId" | "workingDirectory">
  ): Promise<void> {
    assertAppliedChangeSetRecord(record);
    if (record.state !== "applied") {
      throw new Error(
        `filesystem change set ${record.changeSetId} cannot be restored because it is ${record.state}`
      );
    }
    if (record.sessionId !== context.sessionId) {
      throw new Error(
        `filesystem change set ${record.changeSetId} belongs to session ${record.sessionId}, not ${context.sessionId}`
      );
    }

    const currentWorkingDirectory = resolve(context.workingDirectory);
    const currentCanonicalWorkingDirectory = await canonicalWorkingDirectory(currentWorkingDirectory);
    const recordedWorkingDirectory = resolve(record.workingDirectory);
    const recordedCanonicalWorkingDirectory = await canonicalWorkingDirectory(recordedWorkingDirectory);
    if (currentCanonicalWorkingDirectory !== recordedCanonicalWorkingDirectory) {
      throw new Error(
        `filesystem change set ${record.changeSetId} working directory mismatch: expected ${recordedCanonicalWorkingDirectory}, got ${currentCanonicalWorkingDirectory}`
      );
    }

    const existing = this.changeSets.get(record.changeSetId);
    if (existing?.state === "applied" && !existing.restored) {
      await preflightPostimage(existing);
      return;
    }

    const files = await Promise.all(
      record.files.map((file) => restoreEvidenceFile(record.changeSetId, file, currentWorkingDirectory))
    );
    const paths = new Set<string>();
    for (const file of files) {
      if (paths.has(file.path)) {
        throw new Error(
          `filesystem change set ${record.changeSetId} persisted evidence contains a duplicate path: ${file.path}`
        );
      }
      paths.add(file.path);
    }
    const review: ChangeSetReview = {
      changeSetId: record.changeSetId,
      files,
      additions: record.additions,
      deletions: record.deletions,
      createdAt: record.createdAt,
    };
    const mutations: PreparedMutation[] = files.map((file) => ({
      action: file.kind === "directory" ? "mkdir" : "write",
      path: file.path,
      kind: file.kind,
      review: file,
      beforeExists: file.beforeExists,
      afterExists: file.afterExists,
      createdDirs: [],
    }));
    const restored: StoredChangeSet = {
      review,
      mutations,
      state: "applied",
      restored: true,
    };
    await preflightPostimage(restored);
    this.rememberChangeSet(restored);
  }

  /** Restores all records and returns an explicit result for every blocked one. */
  async restoreAppliedChangeSets(
    records: readonly AppliedChangeSetRecord[],
    context: Pick<ToolExecutionContext, "sessionId" | "workingDirectory">
  ): Promise<readonly ChangeSetRestoreResult[]> {
    const results: ChangeSetRestoreResult[] = [];
    for (const record of records) {
      try {
        await this.restoreAppliedChangeSet(record, context);
        results.push({ changeSetId: record.changeSetId, status: "restored" });
      } catch (error) {
        results.push({
          changeSetId: record.changeSetId,
          status: "blocked",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  async rollbackChangeSet(changeSetId: string): Promise<ChangeSetApplyResult> {
    const record = this.requireChangeSet(changeSetId);
    if (record.state !== "applied") {
      throw new Error(
        `filesystem change set ${changeSetId} cannot be rolled back because it is ${record.state}`
      );
    }
    if (record.restored) {
      throw new Error(
        `filesystem change set ${changeSetId} cannot be rolled back because its before-image is unavailable after cross-process restore`
      );
    }
    this.beginChangeSet(changeSetId);
    try {
      await preflightRollback(record);
      for (const mutation of [...record.mutations].reverse()) {
        if (mutation.kind === "file") {
          await restoreBeforeImage(mutation);
        }
      }
      for (const directory of collectCreatedDirectories(record).reverse()) {
        await rmdir(directory);
      }
      record.state = "rolled-back";
      return resultFor(record);
    } finally {
      this.endChangeSet(changeSetId);
    }
  }

  private async previewMutations(
    changes: readonly FilesystemMutationInput[],
    cwd: string
  ): Promise<ChangeSetReview> {
    const seen = new Set<string>();
    const plannedDirectories = new Set<string>();
    const targets = changes.map((change) => {
      const target = resolve(cwd, change.path);
      if (seen.has(target)) {
        throw new Error(`filesystem preview contains the same path more than once: ${target}`);
      }
      seen.add(target);
      return target;
    });
    const preparedDirectories = new Map<string, PreparedMutation>();
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index]!;
      if (change.action !== "mkdir") {
        continue;
      }
      const mutation = await prepareDirectoryMutation(change, targets[index]!, plannedDirectories);
      preparedDirectories.set(targets[index]!, mutation);
      for (const directory of mutation.createdDirs) {
        plannedDirectories.add(directory);
      }
    }

    const mutations: PreparedMutation[] = [];
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index]!;
      const target = targets[index]!;
      const mutation =
        preparedDirectories.get(target) ?? (await prepareMutation(change, target, plannedDirectories));
      mutations.push(mutation);
    }

    const review = createChangeSetReview(mutations.map((mutation) => mutation.review));
    this.rememberChangeSet({ review, mutations, state: "prepared" });
    return review;
  }

  private async applyChangeSet(changeSetId: string): Promise<ChangeSetApplyResult> {
    const record = this.requireChangeSet(changeSetId);
    if (record.state !== "prepared") {
      throw new Error(
        `filesystem change set ${changeSetId} cannot be applied because it is ${record.state}`
      );
    }
    this.beginChangeSet(changeSetId);
    const appliedMutations: PreparedMutation[] = [];
    const createdDirectories: string[] = [];
    try {
      await preflightApply(record);
      try {
        for (const directory of collectCreatedDirectories(record)) {
          await mkdir(directory);
          createdDirectories.push(directory);
        }
        for (const mutation of record.mutations) {
          if (mutation.kind === "file" && !sameBytes(mutation.beforeBytes, mutation.afterBytes)) {
            await replaceFileAtomically(mutation.path, mutation.afterBytes!, mutation.afterMode);
            appliedMutations.push(mutation);
          }
        }
        record.state = "applied";
        return resultFor(record);
      } catch (error) {
        await restoreAfterFailedApply(appliedMutations, createdDirectories);
        throw error;
      }
    } finally {
      this.endChangeSet(changeSetId);
    }
  }

  private requireChangeSet(changeSetId: string): StoredChangeSet {
    const record = this.changeSets.get(changeSetId);
    if (!record) {
      throw new Error(`filesystem change set ${changeSetId} is unknown or expired`);
    }
    return record;
  }

  private beginChangeSet(changeSetId: string): void {
    if (this.activeChangeSets.has(changeSetId)) {
      throw new Error(`filesystem change set ${changeSetId} is already in flight`);
    }
    this.activeChangeSets.add(changeSetId);
  }

  private endChangeSet(changeSetId: string): void {
    this.activeChangeSets.delete(changeSetId);
  }

  private rememberChangeSet(record: StoredChangeSet): void {
    this.changeSets.set(record.review.changeSetId, record);
    while (this.changeSets.size > MAX_CHANGE_SETS) {
      const removable = [...this.changeSets.entries()].find(([, candidate]) => candidate.state !== "applied");
      const oldest = removable ?? this.changeSets.entries().next().value;
      if (!oldest) {
        break;
      }
      this.changeSets.delete(oldest[0]);
    }
  }
}

function parseFilesystemInput(input: unknown): FilesystemInput {
  const record = asRecord(input);
  const action = record.action;
  if (action === "preview") {
    return { action, changes: parsePreviewChanges(record.changes) };
  }
  if (action === "apply" || action === "rollback") {
    if (typeof record.changeSetId !== "string" || record.changeSetId.length === 0) {
      throw new Error(`filesystem ${action} requires a non-empty changeSetId`);
    }
    return { action, changeSetId: record.changeSetId };
  }
  if (
    action !== "read" &&
    action !== "write" &&
    action !== "edit" &&
    action !== "patch" &&
    action !== "list" &&
    action !== "stat" &&
    action !== "mkdir"
  ) {
    throw new Error(
      "filesystem action must be one of: read, write, edit, patch, list, stat, mkdir, preview, apply, rollback"
    );
  }

  const path = record.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("filesystem path must be a non-empty string");
  }
  const content = record.content;
  if (content !== undefined && typeof content !== "string") {
    throw new Error("filesystem content must be a string when provided");
  }
  const oldText = record.oldText;
  const newText = record.newText;
  if (action === "edit") {
    validateEditFields(oldText, newText);
  }
  const offset = parseOptionalPositiveInt(record.offset, "offset");
  const limit = parseOptionalPositiveInt(record.limit, "limit");
  const hunks = parseHunks(record.hunks);
  if (action === "patch" && hunks.length === 0) {
    throw new Error("filesystem patch requires a non-empty hunks array");
  }

  return {
    action,
    path,
    content,
    oldText: typeof oldText === "string" ? oldText : undefined,
    newText: typeof newText === "string" ? newText : undefined,
    offset,
    limit,
    hunks,
  };
}

function parsePreviewChanges(value: unknown): readonly FilesystemMutationInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("filesystem preview requires a non-empty changes array");
  }
  return value.map((entry, index) => {
    const record = asRecord(entry, `filesystem preview change ${index + 1}`);
    const action = record.action;
    if (!isFilesystemMutationAction(action)) {
      throw new Error(
        `filesystem preview change ${index + 1} action must be one of: write, edit, patch, mkdir`
      );
    }
    const parsed = parseMutationRecord(record, action, `filesystem preview change ${index + 1}`);
    return parsed;
  });
}

function parseMutationRecord(
  record: Record<string, unknown>,
  action: FilesystemMutationAction,
  label = "filesystem"
): FilesystemMutationInput {
  if (typeof record.path !== "string" || record.path.length === 0) {
    throw new Error(`${label} path must be a non-empty string`);
  }
  const content = record.content;
  if (content !== undefined && typeof content !== "string") {
    throw new Error(`${label} content must be a string when provided`);
  }
  const oldText = record.oldText;
  const newText = record.newText;
  if (action === "edit") {
    validateEditFields(oldText, newText, label);
  }
  const hunks = parseHunks(record.hunks, label);
  if (action === "patch" && hunks.length === 0) {
    throw new Error(`${label} patch requires a non-empty hunks array`);
  }
  return {
    action,
    path: record.path,
    content,
    oldText: typeof oldText === "string" ? oldText : undefined,
    newText: typeof newText === "string" ? newText : undefined,
    hunks,
  };
}

function validateEditFields(oldText: unknown, newText: unknown, label = "filesystem edit"): void {
  if (typeof oldText !== "string" || oldText.length === 0) {
    throw new Error(`${label} requires a non-empty oldText`);
  }
  if (typeof newText !== "string") {
    throw new Error(`${label} requires newText (use an empty string to delete)`);
  }
}

function parseHunks(value: unknown, label = "filesystem"): PatchHunk[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} hunks must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${label} hunk ${index + 1} must be an object`);
    }
    const hunk = entry as Record<string, unknown>;
    if (typeof hunk.oldText !== "string" || hunk.oldText.length === 0) {
      throw new Error(`${label} hunk ${index + 1} requires a non-empty oldText`);
    }
    if (typeof hunk.newText !== "string") {
      throw new Error(`${label} hunk ${index + 1} requires newText`);
    }
    return { oldText: hunk.oldText, newText: hunk.newText };
  });
}

function parseOptionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`filesystem ${field} must be a positive integer`);
  }
  return value;
}

async function prepareMutation(
  change: FilesystemMutationInput,
  target: string,
  plannedDirectories: ReadonlySet<string>
): Promise<PreparedMutation> {
  if (change.action === "mkdir") {
    return prepareDirectoryMutation(change, target, plannedDirectories);
  }

  const current = await readSnapshot(target);
  if (current.exists && current.kind !== "file") {
    throw new Error(`filesystem ${change.action} cannot replace a directory: ${target}`);
  }
  if (!current.exists && change.action !== "write") {
    throw new Error(`filesystem ${change.action}: file was not found in ${target}`);
  }
  if (!current.exists) {
    await requireParentDirectory(target, plannedDirectories);
  }

  const beforeBytes = current.bytes;
  let afterText: string;
  switch (change.action) {
    case "write":
      afterText = change.content ?? "";
      break;
    case "edit":
      afterText = calculateEdit(beforeBytes!.toString("utf8"), change.oldText!, change.newText!, target);
      break;
    case "patch":
      afterText = calculatePatch(beforeBytes!.toString("utf8"), change.hunks!, target);
      break;
  }
  const afterBytes = Buffer.from(afterText, "utf8");
  const review = createChangeSetFileReview({
    path: target,
    before: beforeBytes,
    after: afterBytes,
    beforeExists: current.exists,
    afterExists: true,
  });
  return {
    action: change.action,
    path: target,
    kind: "file",
    review,
    beforeExists: current.exists,
    beforeBytes,
    beforeMode: current.mode,
    afterExists: true,
    afterBytes,
    afterMode: current.mode,
    createdDirs: [],
  };
}

async function prepareDirectoryMutation(
  change: FilesystemMutationInput,
  target: string,
  plannedDirectories: ReadonlySet<string>
): Promise<PreparedMutation> {
  const current = await readSnapshot(target);
  if (current.exists && current.kind !== "directory") {
    throw new Error(`filesystem mkdir cannot create a directory because the path is a file: ${target}`);
  }
  const createdDirs = current.exists ? [] : await findMissingDirectories(target, plannedDirectories);
  const review = createChangeSetFileReview({
    path: target,
    kind: "directory",
    beforeExists: current.exists,
    afterExists: true,
  });
  return {
    action: "mkdir",
    path: target,
    kind: "directory",
    review,
    beforeExists: current.exists,
    beforeMode: current.mode,
    afterExists: true,
    afterMode: current.mode,
    createdDirs,
  };
}

async function findMissingDirectories(
  target: string,
  plannedDirectories: ReadonlySet<string>
): Promise<string[]> {
  const missing: string[] = [];
  let cursor = target;
  while (true) {
    if (plannedDirectories.has(cursor)) {
      return missing.reverse();
    }
    const current = await readSnapshot(cursor);
    if (!current.exists) {
      missing.push(cursor);
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new Error(`filesystem mkdir cannot find an existing directory for ${target}`);
      }
      cursor = parent;
      continue;
    }
    if (current.kind !== "directory") {
      throw new Error(`filesystem mkdir parent is not a directory: ${cursor}`);
    }
    return missing.reverse();
  }
}

async function preflightApply(record: StoredChangeSet): Promise<void> {
  for (const mutation of record.mutations) {
    const current = await readSnapshot(mutation.path);
    if (mutation.kind === "file") {
      assertExpectedFile(
        record.review.changeSetId,
        mutation.path,
        current,
        mutation.beforeExists,
        mutation.review.beforeHash,
        "preimage"
      );
    } else {
      assertExpectedDirectory(
        record.review.changeSetId,
        mutation.path,
        current,
        mutation.beforeExists,
        "preimage"
      );
    }
  }

  for (const directory of collectCreatedDirectories(record)) {
    const current = await readSnapshot(directory);
    if (current.exists) {
      throw new Error(
        `filesystem change set ${record.review.changeSetId} preimage conflict at ${directory}: directory already exists`
      );
    }
    await requireParentDirectoryOrPlanned(directory, record);
  }
}

async function preflightForValidation(record: StoredChangeSet): Promise<void> {
  if (record.restored) {
    await preflightPostimage(record);
    return;
  }
  await preflightRollback(record);
}

async function preflightPostimage(record: StoredChangeSet): Promise<void> {
  for (const mutation of record.mutations) {
    const current = await readSnapshot(mutation.path);
    if (mutation.kind === "file") {
      assertExpectedFile(
        record.review.changeSetId,
        mutation.path,
        current,
        mutation.afterExists,
        mutation.review.afterHash,
        "postimage"
      );
    } else {
      assertExpectedDirectory(
        record.review.changeSetId,
        mutation.path,
        current,
        mutation.afterExists,
        "postimage"
      );
    }
  }
}

async function preflightRollback(record: StoredChangeSet): Promise<void> {
  for (const mutation of record.mutations) {
    const current = await readSnapshot(mutation.path);
    if (mutation.kind === "file") {
      assertExpectedFile(
        record.review.changeSetId,
        mutation.path,
        current,
        mutation.afterExists,
        mutation.review.afterHash,
        "postimage"
      );
    } else {
      assertExpectedDirectory(
        record.review.changeSetId,
        mutation.path,
        current,
        mutation.afterExists,
        "postimage"
      );
    }
  }

  const createdDirectories = collectCreatedDirectories(record);
  const createdDirectorySet = new Set(createdDirectories);
  const rollbackFileSet = new Set(
    record.mutations
      .filter((mutation) => mutation.kind === "file" && !mutation.beforeExists)
      .map((mutation) => mutation.path)
  );
  for (const directory of [...createdDirectories].reverse()) {
    const current = await readSnapshot(directory);
    if (!current.exists || current.kind !== "directory") {
      throw new Error(
        `filesystem change set ${record.review.changeSetId} postimage conflict at ${directory}`
      );
    }
    const entries = await readdir(directory);
    const unexpectedEntries = entries.filter((entry) => {
      const entryPath = resolve(directory, entry);
      return !createdDirectorySet.has(entryPath) && !rollbackFileSet.has(entryPath);
    });
    if (unexpectedEntries.length > 0) {
      throw new Error(
        `filesystem change set ${record.review.changeSetId} cannot rollback non-empty directory ${directory}`
      );
    }
  }
}

function assertAppliedChangeSetRecord(record: AppliedChangeSetRecord): void {
  if (
    typeof record !== "object" ||
    record === null ||
    typeof record.changeSetId !== "string" ||
    record.changeSetId.length === 0 ||
    typeof record.sessionId !== "string" ||
    record.sessionId.length === 0 ||
    typeof record.workingDirectory !== "string" ||
    (!isAbsolute(record.workingDirectory) && !win32.isAbsolute(record.workingDirectory)) ||
    record.state !== "applied" ||
    !Number.isInteger(record.additions) ||
    record.additions < 0 ||
    !Number.isInteger(record.deletions) ||
    record.deletions < 0 ||
    typeof record.createdAt !== "string" ||
    record.createdAt.length === 0 ||
    typeof record.recordedAt !== "string" ||
    record.recordedAt.length === 0 ||
    !Array.isArray(record.files) ||
    record.files.length === 0
  ) {
    throw new Error(`filesystem change set ${String(record?.changeSetId ?? "unknown")} has invalid persisted evidence`);
  }
  for (const file of record.files) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.path !== "string" ||
      !isSafeRestorePath(file.path) ||
      (file.kind !== "file" && file.kind !== "directory") ||
      !isSha256(file.afterHash) ||
      (file.beforeHash !== undefined && !isSha256(file.beforeHash)) ||
      !Number.isInteger(file.additions) ||
      file.additions < 0 ||
      !Number.isInteger(file.deletions) ||
      file.deletions < 0 ||
      typeof file.beforeExists !== "boolean" ||
      typeof file.afterExists !== "boolean"
    ) {
      throw new Error(
        `filesystem change set ${record.changeSetId} has invalid persisted evidence for path ${String(file?.path ?? "unknown")}`
      );
    }
  }
}

async function canonicalWorkingDirectory(path: string): Promise<string> {
  try {
    return await realpath(resolve(path));
  } catch (error) {
    throw new Error(
      `filesystem working directory cannot be resolved: ${path} (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

async function restoreEvidenceFile(
  changeSetId: string,
  file: ChangeSetEvidenceFile,
  workingDirectory: string
): Promise<ChangeSetFileReview> {
  const path = await resolveRestoredPath(changeSetId, file.path, workingDirectory);
  return {
    path,
    kind: file.kind,
    beforeHash: file.beforeHash,
    afterHash: file.afterHash,
    diff: "",
    additions: file.additions,
    deletions: file.deletions,
    beforeExists: file.beforeExists,
    afterExists: file.afterExists,
  };
}

async function resolveRestoredPath(
  changeSetId: string,
  path: string,
  workingDirectory: string
): Promise<string> {
  if (!isSafeRestorePath(path)) {
    throw new Error(
      `filesystem change set ${changeSetId} persisted path must be relative and remain inside the working directory: ${path}`
    );
  }
  const target = resolve(workingDirectory, path);
  const targetRelative = relative(workingDirectory, target);
  if (
    targetRelative.length === 0 ||
    targetRelative.startsWith(".." + "/") ||
    targetRelative === ".." ||
    isAbsolute(targetRelative)
  ) {
    throw new Error(
      `filesystem change set ${changeSetId} persisted path escapes the working directory: ${path}`
    );
  }

  let cursor = dirname(target);
  while (cursor !== workingDirectory) {
    try {
      const current = await lstat(cursor);
      if (current.isSymbolicLink()) {
        throw new Error(
          `filesystem change set ${changeSetId} persisted path crosses a symbolic link: ${path}`
        );
      }
      if (!current.isDirectory()) {
        throw new Error(
          `filesystem change set ${changeSetId} persisted path has a non-directory parent: ${path}`
        );
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return target;
}

function isSafeRestorePath(path: string): boolean {
  if (path.length === 0 || path.includes("\0") || isAbsolute(path) || win32.isAbsolute(path)) {
    return false;
  }
  const normalized = path.replaceAll("\\", "/");
  return normalized !== "." && normalized !== ".." && !normalized.split("/").includes("..");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function assertExpectedFile(
  changeSetId: string,
  path: string,
  current: FileSnapshot,
  expectedExists: boolean,
  expectedHash: string | undefined,
  phase: "preimage" | "postimage"
): void {
  if (!expectedExists) {
    if (current.exists) {
      throw new Error(
        `filesystem change set ${changeSetId} ${phase} conflict at ${path}: file unexpectedly exists`
      );
    }
    return;
  }
  if (!current.exists || current.kind !== "file") {
    throw new Error(
      `filesystem change set ${changeSetId} ${phase} conflict at ${path}: expected a file`
    );
  }
  const actualHash = hashBytes(current.bytes!);
  if (actualHash !== expectedHash) {
    throw new Error(
      `filesystem change set ${changeSetId} ${phase} hash conflict at ${path}: expected ${expectedHash ?? "missing"}, got ${actualHash}`
    );
  }
}

function assertExpectedDirectory(
  changeSetId: string,
  path: string,
  current: FileSnapshot,
  expectedExists: boolean,
  phase: "preimage" | "postimage"
): void {
  if (current.exists !== expectedExists || (current.exists && current.kind !== "directory")) {
    throw new Error(
      `filesystem change set ${changeSetId} ${phase} conflict at ${path}: expected ${expectedExists ? "a directory" : "no directory"}`
    );
  }
}

async function requireParentDirectory(
  path: string,
  plannedDirectories: ReadonlySet<string> = new Set()
): Promise<void> {
  const parentPath = dirname(path);
  if (plannedDirectories.has(parentPath)) {
    return;
  }
  const parent = await readSnapshot(parentPath);
  if (!parent.exists || parent.kind !== "directory") {
    throw new Error(`filesystem file parent is not a directory: ${parentPath}`);
  }
}

async function requireParentDirectoryOrPlanned(
  path: string,
  record: StoredChangeSet
): Promise<void> {
  const parent = dirname(path);
  const snapshot = await readSnapshot(parent);
  if (snapshot.exists && snapshot.kind === "directory") {
    return;
  }
  if (record.mutations.some((mutation) => mutation.createdDirs.includes(parent))) {
    return;
  }
  throw new Error(`filesystem change set ${record.review.changeSetId} parent is not a directory: ${parent}`);
}

function collectCreatedDirectories(record: StoredChangeSet): string[] {
  const directories = new Set<string>();
  for (const mutation of record.mutations) {
    for (const directory of mutation.createdDirs) {
      directories.add(directory);
    }
  }
  return [...directories].sort((left, right) => depth(left) - depth(right));
}

function depth(path: string): number {
  return path.split("/").length;
}

async function restoreBeforeImage(mutation: PreparedMutation): Promise<void> {
  if (mutation.kind === "directory") {
    return;
  }
  if (mutation.beforeExists) {
    await replaceFileAtomically(mutation.path, mutation.beforeBytes!, mutation.beforeMode);
    return;
  }
  const current = await readSnapshot(mutation.path);
  if (current.exists) {
    if (current.kind !== "file") {
      throw new Error(`filesystem rollback cannot remove a directory at ${mutation.path}`);
    }
    await unlink(mutation.path);
  }
}

async function restoreAfterFailedApply(
  mutations: readonly PreparedMutation[],
  directories: readonly string[]
): Promise<void> {
  for (const mutation of [...mutations].reverse()) {
    try {
      await restoreBeforeImage(mutation);
    } catch {
      // The original apply error is more useful than a best-effort cleanup error.
    }
  }
  for (const directory of [...directories].reverse()) {
    try {
      await rmdir(directory);
    } catch {
      // Keep the original failure; a non-empty directory must not be removed.
    }
  }
}

async function replaceFileAtomically(path: string, bytes: Buffer, mode?: number): Promise<void> {
  const temporary = resolve(dirname(path), `.${basename(path)}.dev-agent-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", mode ?? 0o666);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (mode !== undefined) {
      await chmod(temporary, mode);
    }
    await rename(temporary, path);
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await unlink(temporary).catch(() => undefined);
  }
}

function resultFor(record: StoredChangeSet): ChangeSetApplyResult {
  return {
    ok: true,
    changeSetId: record.review.changeSetId,
    files: record.review.files,
    additions: record.review.additions,
    deletions: record.review.deletions,
  };
}

function sameBytes(before: Buffer | undefined, after: Buffer | undefined): boolean {
  if (!before || !after) {
    return before === after;
  }
  return before.equals(after);
}

async function readSnapshot(path: string): Promise<FileSnapshot> {
  try {
    const fileStat = await lstat(path);
    if (fileStat.isDirectory()) {
      return { exists: true, kind: "directory", mode: fileStat.mode & 0o7777 };
    }
    if (fileStat.isFile()) {
      return {
        exists: true,
        kind: "file",
        bytes: await readFile(path),
        mode: fileStat.mode & 0o7777,
      };
    }
    throw new Error(`filesystem path is not a regular file or directory: ${path}`);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { exists: false };
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function readFileRange(
  path: string,
  offset: number,
  limit: number
): Promise<Record<string, unknown>> {
  const source = await readFile(path, "utf8");
  const lines = splitLines(source);
  const totalLines = lines.length;
  if (offset > totalLines) {
    // Report an empty range pinned to the file instead of echoing the request:
    // `offset: 99` on a three-line file used to answer startLine 99 / endLine
    // 98, which reads as a broken range rather than "you are past the end".
    const emptyAt = totalLines + 1;
    return {
      path,
      content: "",
      startLine: emptyAt,
      endLine: emptyAt - 1,
      totalLines,
      truncated: false,
    };
  }
  const startLine = Math.min(offset, totalLines);
  const endLine = Math.min(startLine + limit - 1, totalLines);

  return {
    path,
    content: lines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
    totalLines,
    truncated: endLine < totalLines,
  };
}

/**
 * Splits a file into lines the way an editor counts them: a trailing newline
 * terminates the last line instead of starting an empty one. `readFileRange`
 * reports `totalLines` to the model, and `"a\nb\n".split("\n")` used to answer
 * 3 lines for a two-line file, so the model paged one line past the end.
 */
function splitLines(source: string): string[] {
  if (source === "") {
    return [];
  }
  return (source.endsWith("\n") ? source.slice(0, -1) : source).split("\n");
}

/**
 * Replaces `oldText` with `newText`, but only when the snippet is unique:
 * a missing or ambiguous match is an error the model can correct.
 */
async function editFile(
  path: string,
  oldText: string,
  newText: string
): Promise<Record<string, unknown>> {
  const source = await readFile(path, "utf8");
  const updated = calculateEdit(source, oldText, newText, path);
  await writeFile(path, updated, "utf8");
  return { ok: true, path, replacements: 1 };
}

function calculateEdit(source: string, oldText: string, newText: string, path: string): string {
  const first = source.indexOf(oldText);
  if (first < 0) {
    throw new Error(`filesystem edit: the search text was not found in ${path}`);
  }

  const matches = countOccurrences(source, oldText);
  if (matches > 1) {
    throw new Error(
      `filesystem edit: the search text matches ${matches} locations in ${path}; include more surrounding context to make it unique`
    );
  }

  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = source.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Applies every hunk in order to an in-memory copy and writes once at the end,
 * so a failing or ambiguous hunk leaves the file exactly as it was.
 */
async function patchFile(
  path: string,
  hunks: readonly PatchHunk[]
): Promise<Record<string, unknown>> {
  const source = await readFile(path, "utf8");
  const working = calculatePatch(source, hunks, path);
  await writeFile(path, working, "utf8");
  return { ok: true, path, hunks: hunks.length };
}

function calculatePatch(
  source: string,
  hunks: readonly PatchHunk[],
  path = "the target file"
): string {
  let working = source;
  const applied: Array<{ hunk: number; start: number; end: number }> = [];

  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index]!;
    const first = working.indexOf(hunk.oldText);
    if (first < 0) {
      throw new Error(
        `filesystem patch: hunk ${index + 1} search text was not found in ${path}`
      );
    }

    const matches = countOccurrences(working, hunk.oldText);
    if (matches > 1) {
      throw new Error(
        `filesystem patch: hunk ${index + 1} matches ${matches} locations in ${path}; include more context to make it unique`
      );
    }

    const end = first + hunk.oldText.length;
    const overlapping = applied.find((range) => first < range.end && end > range.start);
    if (overlapping) {
      throw new Error(
        `filesystem patch: hunk ${index + 1} overlaps hunk ${overlapping.hunk} in ${path}`
      );
    }

    const delta = hunk.newText.length - hunk.oldText.length;
    for (const range of applied) {
      if (range.start >= end) {
        range.start += delta;
        range.end += delta;
      }
    }
    applied.push({ hunk: index + 1, start: first, end: first + hunk.newText.length });
    working = working.slice(0, first) + hunk.newText + working.slice(end);
  }

  return working;
}

function toMutationInput(input: FilesystemInput): FilesystemMutationInput {
  if (!isFilesystemMutationAction(input.action) || !input.path) {
    throw new Error("filesystem input is not a mutation");
  }
  return {
    action: input.action,
    path: input.path,
    content: input.content,
    oldText: input.oldText,
    newText: input.newText,
    hunks: input.hunks,
  };
}

function isFilesystemMutationAction(action: unknown): action is FilesystemMutationAction {
  return action === "write" || action === "edit" || action === "patch" || action === "mkdir";
}

function resolveRequiredPath(input: FilesystemInput): string {
  if (!input.path) {
    throw new Error("filesystem path must be a non-empty string");
  }
  return input.path;
}

function asRecord(input: unknown, label = "tool input"): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}
