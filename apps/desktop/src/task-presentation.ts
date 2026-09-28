import { randomUUID } from "node:crypto";
import { mkdir, opendir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TaskPresentation {
  readonly title: string | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly updatedAt: string;
}
export type TaskPresentationPatch = Partial<Pick<TaskPresentation, "title" | "pinned" | "archived">>;
export class TaskPresentationError extends Error {}
export const isTaskSessionId = (id: string): boolean => /^[a-z0-9_-]{1,96}$/.test(id);

export function parseTaskPresentationPatch(value: unknown): TaskPresentationPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskPresentationError("expected a task presentation object");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length || keys.some((key) => !["title", "pinned", "archived"].includes(key))) {
    throw new TaskPresentationError("only title, pinned and archived can be changed");
  }
  const patch: { title?: string | null; pinned?: boolean; archived?: boolean } = {};
  if (Object.hasOwn(record, "title")) {
    if (record.title === null) patch.title = null;
    else if (typeof record.title !== "string" || !record.title.trim() || record.title.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(record.title)) {
      throw new TaskPresentationError("title must be 1–120 characters on one line, or null");
    } else patch.title = record.title.trim();
  }
  for (const key of ["pinned", "archived"] as const) {
    if (Object.hasOwn(record, key)) {
      if (typeof record[key] !== "boolean") throw new TaskPresentationError(`${key} must be a boolean`);
      patch[key] = record[key];
    }
  }
  return patch;
}

// Serialize updates to a record even if two server instances share this directory.
const mutations = new Map<string, Promise<unknown>>();
async function serialize<T>(path: string, action: () => Promise<T>): Promise<T> {
  const result = (mutations.get(path) ?? Promise.resolve()).catch(() => undefined).then(action);
  mutations.set(path, result);
  try { return await result; }
  finally { if (mutations.get(path) === result) mutations.delete(path); }
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }

/** Sidecars never alter FileMemory, session identity, worktrees or runtime state. */
export class TaskPresentationStore {
  private readonly directory: string;
  constructor(sessionDirectory: string) { this.directory = join(sessionDirectory, ".desktop-tasks"); }
  private path(id: string): string {
    if (!isTaskSessionId(id)) throw new TaskPresentationError("invalid session id");
    return join(this.directory, `${id}.json`);
  }
  async read(id: string): Promise<TaskPresentation | undefined> {
    const path = this.path(id);
    try {
      if ((await stat(path)).size > 8192) throw new Error("task presentation is too large");
      const value = JSON.parse(await readFile(path, "utf8"));
      if (value?.version !== 1 || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("invalid task presentation record");
      const patch = parseTaskPresentationPatch({ title: value.title, pinned: value.pinned, archived: value.archived });
      return { title: patch.title ?? null, pinned: patch.pinned!, archived: patch.archived!, updatedAt: value.updatedAt };
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }
  async list(limit = 256): Promise<Map<string, TaskPresentation>> {
    const result = new Map<string, TaskPresentation>();
    try {
      for await (const entry of await opendir(this.directory)) {
        if (result.size >= limit) break;
        const id = entry.name.slice(0, -5);
        if (!entry.isFile() || !entry.name.endsWith(".json") || !isTaskSessionId(id)) continue;
        // A malformed sidecar must not make conversation history inaccessible.
        const record = await this.read(id).catch(() => undefined);
        if (record) result.set(id, record);
      }
    } catch (error) { if (!missing(error)) throw error; }
    return result;
  }
  async update(id: string, patch: TaskPresentationPatch): Promise<TaskPresentation> {
    const validated = parseTaskPresentationPatch(patch);
    const path = this.path(id);
    return serialize(path, async () => {
      const previous = await this.read(id);
      const record: TaskPresentation = {
        title: null, pinned: false, archived: false, ...previous, ...validated,
        updatedAt: new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt ?? "") + 1 || 0)).toISOString(),
      };
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, ...record }) + "\n", { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
      return record;
    });
  }
  async remove(id: string): Promise<boolean> {
    const path = this.path(id);
    return serialize(path, async () => {
      try { await rm(path); return true; }
      catch (error) { if (missing(error)) return false; throw error; }
    });
  }
  async move(from: string, to: string): Promise<void> {
    if (from === to) return;
    const record = await this.read(from);
    if (!record) return;
    await this.update(to, { title: record.title, pinned: record.pinned, archived: record.archived });
    await this.remove(from);
  }
}

export function taskExcerpt(text: string | undefined, limit: number): string | undefined {
  const normalized = text?.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length <= limit ? normalized : normalized.slice(0, limit - 1) + "…";
}
