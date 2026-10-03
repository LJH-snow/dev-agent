import { spawn } from "node:child_process";

const DEFAULT_LIMITS = {
  maxBytes: 1_000_000,
  maxLines: 20_000,
  maxFiles: 500,
} as const;

export type ReviewMode = "working-tree" | "base-head";
export type ReviewStatus = "ok" | "skipped" | "error" | "limited";
export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";

export interface ChangedFile {
  readonly path: string;
  readonly status: ChangedFileStatus;
  readonly additions: number;
  readonly deletions: number;
}

export interface ReviewSummary {
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly reason?: ReviewReason;
}

export type ReviewReason =
  | "base_head_required"
  | "invalid_git_ref"
  | "not_git_repository"
  | "git_failed"
  | "diff_bytes_exceeded"
  | "diff_lines_exceeded"
  | "diff_files_exceeded";

export interface ReviewResult {
  readonly command: "review";
  readonly mode: ReviewMode;
  readonly status: ReviewStatus;
  readonly changedFiles: readonly ChangedFile[];
  readonly summary: ReviewSummary;
  readonly warnings: readonly string[];
}

export interface ReviewLimits {
  readonly maxBytes?: number;
  readonly maxLines?: number;
  readonly maxFiles?: number;
  readonly maxDiffBytes?: number;
  readonly maxDiffLines?: number;
}

export interface GitRunnerResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr?: string;
  readonly truncated?: boolean;
}

export type GitRunner = (
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<GitRunnerResult>;

export interface ReviewCommandOptions {
  readonly cwd?: string;
  readonly base?: string;
  readonly head?: string;
  readonly limits?: ReviewLimits;
  readonly gitRunner?: GitRunner;
}

interface MutableChangedFile {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
}

function defaultGitRunner(args: readonly string[], options: { readonly cwd: string }): Promise<GitRunnerResult> {
  return new Promise((resolve) => {
    const child = spawn("git", [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutTruncated = false;

    child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = DEFAULT_LIMITS.maxBytes + 1 - stdoutBytes;
      if (remaining <= 0) {
        stdoutTruncated = true;
        return;
      }
      if (bytes.length > remaining) {
        stdoutChunks.push(bytes.subarray(0, remaining));
        stdoutBytes += remaining;
        stdoutTruncated = true;
      } else {
        stdoutChunks.push(bytes);
        stdoutBytes += bytes.length;
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (Buffer.concat(stderrChunks).length < 8_192) {
        stderrChunks.push(bytes.subarray(0, 8_192));
      }
    });
    child.on("error", () => resolve({ code: 1, stdout: "", stderr: "" }));
    child.on("close", (code) =>
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        ...(stdoutTruncated ? { truncated: true } : {}),
      }),
    );
  });
}

function emptySummary(reason?: ReviewReason): ReviewSummary {
  return reason
    ? { changedFiles: 0, additions: 0, deletions: 0, reason }
    : { changedFiles: 0, additions: 0, deletions: 0 };
}

function result(
  mode: ReviewMode,
  status: ReviewStatus,
  changedFiles: readonly ChangedFile[],
  summary: ReviewSummary,
  warnings: readonly string[],
): ReviewResult {
  return { command: "review", mode, status, changedFiles, summary, warnings };
}

function limitValue(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function sanitizePath(value: string): string {
  let path = value.trim();
  if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
    path = path.slice(1, -1).replace(/\\([\\"])/g, "$1");
  }
  path = path.replace(/\\/g, "/");
  if (path.startsWith("a/") || path.startsWith("b/")) {
    path = path.slice(2);
  }
  if (!path || isAbsolutePath(path) || path === ".." || path.startsWith("../") || path.includes("\0")) {
    return "[redacted-path]";
  }
  return path;
}

function parseHeaderPath(value: string): string {
  return value.replace(/^a\//, "").replace(/^b\//, "");
}

function parseDiff(stdout: string): MutableChangedFile[] {
  const files: MutableChangedFile[] = [];
  let current: MutableChangedFile | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const rest = line.slice("diff --git ".length);
      const separator = rest.lastIndexOf(" b/");
      const oldPath = separator >= 0 ? rest.slice(0, separator) : "";
      const newPath = separator >= 0 ? rest.slice(separator + 1) : "";
      current = {
        path: sanitizePath(parseHeaderPath(newPath || oldPath)),
        status: "modified",
        additions: 0,
        deletions: 0,
      };
      files.push(current);
      continue;
    }

    if (!current) {
      continue;
    }
    if (line === "new file mode" || line.startsWith("new file mode ")) {
      current.status = "added";
      continue;
    }
    if (line === "deleted file mode" || line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("similarity index ") || line.startsWith("rename from ")) {
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("copy from ")) {
      current.status = "copied";
      continue;
    }
    if (line.startsWith("+++")) {
      const path = line.slice(3).trim();
      if (path !== "/dev/null") {
        current.path = sanitizePath(path);
      }
      continue;
    }
    if (line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
    }
  }

  return files;
}

function freezeChangedFiles(files: readonly MutableChangedFile[]): ChangedFile[] {
  return files.map((file) => ({
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

function summarize(files: readonly ChangedFile[], reason?: ReviewReason): ReviewSummary {
  return {
    changedFiles: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    ...(reason ? { reason } : {}),
  };
}

function isNotGitRepository(stderr: string): boolean {
  return /not a git repository|outside a work tree/i.test(stderr);
}

function isSafeGitRef(value: string): boolean {
  return value.length > 0 && !value.startsWith("-") && !value.includes("\0");
}

export async function executeReviewCommand(options: ReviewCommandOptions = {}): Promise<ReviewResult> {
  const mode: ReviewMode = options.base !== undefined || options.head !== undefined ? "base-head" : "working-tree";
  const baseProvided = typeof options.base === "string" && options.base.length > 0;
  const headProvided = typeof options.head === "string" && options.head.length > 0;
  if (baseProvided !== headProvided) {
    return result(mode, "error", [], emptySummary("base_head_required"), ["base_head_required"]);
  }
  if (baseProvided && headProvided && (!isSafeGitRef(options.base as string) || !isSafeGitRef(options.head as string))) {
    return result(mode, "error", [], emptySummary("invalid_git_ref"), ["invalid_git_ref"]);
  }

  const cwd = options.cwd ?? process.cwd();
  const args = ["diff", "--no-ext-diff", "--unified=3"];
  if (baseProvided && headProvided) {
    args.push(options.base as string, options.head as string);
  }

  let gitResult: GitRunnerResult;
  try {
    gitResult = await (options.gitRunner ?? defaultGitRunner)(args, { cwd });
  } catch {
    return result(mode, "error", [], emptySummary("git_failed"), ["git_failed"]);
  }

  if (gitResult.code !== 0) {
    const reason: ReviewReason = isNotGitRepository(gitResult.stderr ?? "")
      ? "not_git_repository"
      : "git_failed";
    return result(mode, reason === "not_git_repository" ? "skipped" : "error", [], emptySummary(reason), [reason]);
  }

  const limits = {
    maxBytes: limitValue(options.limits?.maxDiffBytes ?? options.limits?.maxBytes, DEFAULT_LIMITS.maxBytes),
    maxLines: limitValue(options.limits?.maxDiffLines ?? options.limits?.maxLines, DEFAULT_LIMITS.maxLines),
    maxFiles: limitValue(options.limits?.maxFiles, DEFAULT_LIMITS.maxFiles),
  };
  const diffBytes = Buffer.byteLength(gitResult.stdout, "utf8");
  if (gitResult.truncated || diffBytes > limits.maxBytes) {
    return result(mode, "limited", [], emptySummary("diff_bytes_exceeded"), ["diff_bytes_exceeded"]);
  }
  const diffLines = gitResult.stdout === "" ? 0 : gitResult.stdout.split(/\r?\n/).length;
  if (diffLines > limits.maxLines) {
    return result(mode, "limited", [], emptySummary("diff_lines_exceeded"), ["diff_lines_exceeded"]);
  }

  const parsedFiles = parseDiff(gitResult.stdout);
  if (parsedFiles.length > limits.maxFiles) {
    const files = freezeChangedFiles(parsedFiles.slice(0, limits.maxFiles));
    return result(mode, "limited", files, summarize(files, "diff_files_exceeded"), ["diff_files_exceeded"]);
  }

  const files = freezeChangedFiles(parsedFiles);
  return result(mode, "ok", files, summarize(files), []);
}

export function formatReviewResult(reviewResult: ReviewResult): string {
  return JSON.stringify(reviewResult);
}
