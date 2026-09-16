import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const PROJECT_DIRECTORY_NAME = ".dev-agent";
const CONFIG_FILE_NAME = "config.json";
const SESSIONS_DIRECTORY_NAME = "sessions";
const GITIGNORE_ENTRY = ".dev-agent/";
const DEFAULT_CONFIG = "{}\n";

type PathKind = "missing" | "directory" | "file" | "symlink" | "other";

export type ProjectInitStatus = "created" | "existing" | "changed" | "skipped";

export interface InitializeProjectOptions {
  readonly workingDirectory: string;
  readonly addGitignore?: boolean;
  readonly dryRun?: boolean;
}

export interface ProjectInitEntry {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly status: ProjectInitStatus;
}

export interface InitializeProjectResult {
  readonly workingDirectory: string;
  readonly projectDirectory: string;
  readonly configPath: string;
  readonly sessionsDirectory: string;
  readonly gitignorePath: string;
  readonly dryRun: boolean;
  /**
   * In dry-run mode, created and changed describe the work that would happen;
   * no filesystem mutation is performed.
   */
  readonly entries: readonly ProjectInitEntry[];
  readonly created: readonly string[];
  readonly existing: readonly string[];
  readonly changed: readonly string[];
  readonly skipped: readonly string[];
}

interface PlannedEntry extends ProjectInitEntry {
  status: ProjectInitStatus;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function inspectPath(path: string): Promise<PathKind> {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink()) {
      return "symlink";
    }
    if (details.isDirectory()) {
      return "directory";
    }
    if (details.isFile()) {
      return "file";
    }
    return "other";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

function describePathKind(kind: PathKind): string {
  switch (kind) {
    case "missing":
      return "missing";
    case "directory":
      return "a directory";
    case "file":
      return "a file";
    case "symlink":
      return "a symbolic link";
    case "other":
      return "an unsupported filesystem entry";
  }
}

function throwPathConflict(path: string, expected: "directory" | "file", actual: PathKind): never {
  throw new Error(
    `Cannot initialize ${path}: expected ${expected}, found ${describePathKind(actual)}.`
  );
}

function ensureDirectoryOrMissing(path: string, kind: PathKind): void {
  if (kind === "missing" || kind === "directory") {
    return;
  }
  throwPathConflict(path, "directory", kind);
}

function ensureFileOrMissing(path: string, kind: PathKind): void {
  if (kind === "missing" || kind === "file") {
    return;
  }
  throwPathConflict(path, "file", kind);
}

function containsGitignoreEntry(content: string): boolean {
  return content.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY);
}

function gitignoreSuffix(content: string): string {
  const separator = content.length === 0 || content.endsWith("\n") || content.endsWith("\r") ? "" : "\n";
  return `${separator}${GITIGNORE_ENTRY}\n`;
}

function resultFromEntries(
  paths: {
    workingDirectory: string;
    projectDirectory: string;
    configPath: string;
    sessionsDirectory: string;
    gitignorePath: string;
  },
  dryRun: boolean,
  entries: readonly PlannedEntry[]
): InitializeProjectResult {
  const byStatus = (status: ProjectInitStatus): string[] =>
    entries.filter((entry) => entry.status === status).map((entry) => entry.path);

  return {
    ...paths,
    dryRun,
    entries: entries.map((entry) => ({ ...entry })),
    created: byStatus("created"),
    existing: byStatus("existing"),
    changed: byStatus("changed"),
    skipped: byStatus("skipped"),
  };
}

async function validateWorkingDirectory(path: string): Promise<string> {
  if (typeof path !== "string" || path.trim() === "") {
    throw new TypeError("workingDirectory must be a non-empty path");
  }

  const workingDirectory = resolve(path);
  let details: Awaited<ReturnType<typeof stat>>;
  try {
    details = await stat(workingDirectory);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`workingDirectory does not exist: ${workingDirectory}`);
    }
    throw error;
  }

  if (!details.isDirectory()) {
    throw new Error(`workingDirectory must be a directory: ${workingDirectory}`);
  }

  return workingDirectory;
}

async function createDirectory(path: string, entry: PlannedEntry): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "EEXIST")) {
      throw error;
    }

    const actual = await inspectPath(path);
    if (actual !== "directory") {
      throwPathConflict(path, "directory", actual);
    }
    entry.status = "existing";
    return;
  }
}

async function createFile(path: string, content: string, entry: PlannedEntry): Promise<void> {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!(isNodeError(error) && error.code === "EEXIST")) {
      throw error;
    }

    const actual = await inspectPath(path);
    if (actual !== "file") {
      throwPathConflict(path, "file", actual);
    }
    entry.status = "existing";
  }
}

async function updateGitignore(path: string, entry: PlannedEntry): Promise<void> {
  const current = await readFile(path, "utf8");
  if (containsGitignoreEntry(current)) {
    entry.status = "existing";
    return;
  }

  await appendFile(path, gitignoreSuffix(current), "utf8");
}

/**
 * Creates the project-local state used by the CLI without changing existing
 * config or session data. The selected working directory is the only scope.
 */
export async function initializeProject(
  options: InitializeProjectOptions
): Promise<InitializeProjectResult> {
  const workingDirectory = await validateWorkingDirectory(options.workingDirectory);
  const projectDirectory = join(workingDirectory, PROJECT_DIRECTORY_NAME);
  const configPath = join(projectDirectory, CONFIG_FILE_NAME);
  const sessionsDirectory = join(projectDirectory, SESSIONS_DIRECTORY_NAME);
  const gitignorePath = join(workingDirectory, ".gitignore");
  const dryRun = options.dryRun === true;
  const addGitignore = options.addGitignore === true;

  const projectKind = await inspectPath(projectDirectory);
  ensureDirectoryOrMissing(projectDirectory, projectKind);
  const configKind = projectKind === "missing" ? "missing" : await inspectPath(configPath);
  ensureFileOrMissing(configPath, configKind);
  const sessionsKind = projectKind === "missing" ? "missing" : await inspectPath(sessionsDirectory);
  ensureDirectoryOrMissing(sessionsDirectory, sessionsKind);

  let gitignoreKind: PathKind = "missing";
  let gitignoreContent: string | undefined;
  if (addGitignore) {
    gitignoreKind = await inspectPath(gitignorePath);
    ensureFileOrMissing(gitignorePath, gitignoreKind);
    if (gitignoreKind === "file") {
      gitignoreContent = await readFile(gitignorePath, "utf8");
    }
  }

  const entries: PlannedEntry[] = [
    {
      path: projectDirectory,
      kind: "directory",
      status: projectKind === "missing" ? "created" : "existing",
    },
    {
      path: configPath,
      kind: "file",
      status: configKind === "missing" ? "created" : "existing",
    },
    {
      path: sessionsDirectory,
      kind: "directory",
      status: sessionsKind === "missing" ? "created" : "existing",
    },
    {
      path: gitignorePath,
      kind: "file",
      status: !addGitignore
        ? "skipped"
        : gitignoreKind === "missing"
          ? "created"
          : gitignoreContent !== undefined && containsGitignoreEntry(gitignoreContent)
            ? "existing"
            : "changed",
    },
  ];

  const paths = {
    workingDirectory,
    projectDirectory,
    configPath,
    sessionsDirectory,
    gitignorePath,
  };

  if (dryRun) {
    return resultFromEntries(paths, true, entries);
  }

  if (entries[0]?.status === "created") {
    await createDirectory(projectDirectory, entries[0]);
  }
  if (entries[1]?.status === "created") {
    await createFile(configPath, DEFAULT_CONFIG, entries[1]);
  }
  if (entries[2]?.status === "created") {
    await createDirectory(sessionsDirectory, entries[2]);
  }
  if (addGitignore && entries[3]) {
    if (entries[3].status === "created") {
      await createFile(gitignorePath, GITIGNORE_ENTRY + "\n", entries[3]);
    } else if (entries[3].status === "changed") {
      await updateGitignore(gitignorePath, entries[3]);
    }
  }

  return resultFromEntries(paths, false, entries);
}
