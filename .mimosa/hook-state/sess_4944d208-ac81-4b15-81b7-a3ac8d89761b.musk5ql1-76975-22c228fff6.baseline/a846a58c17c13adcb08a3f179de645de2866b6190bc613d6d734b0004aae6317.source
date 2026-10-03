import { redactSensitiveText } from "./tui-renderer.js";

const MAX_BRANCH_CHARS = 128;
const MAX_COMMIT_MESSAGE_CHARS = 200;
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 4_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;
const GITHUB_URL_PATTERN = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/u;

export interface GitWorkflowExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr?: string;
  readonly timedOut?: boolean;
}

export type GitWorkflowRunner = (
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
  },
) => Promise<GitWorkflowExecResult>;

export interface GitWorkflowOptions {
  readonly cwd: string;
  readonly runner: GitWorkflowRunner;
  readonly confirm: (prompt: string) => Promise<boolean>;
  readonly signal?: AbortSignal;
}

export type GitWorkflowCommand =
  | { readonly kind: "status" }
  | { readonly kind: "create-branch"; readonly name: string }
  | { readonly kind: "commit"; readonly message: string; readonly stageAll: boolean }
  | { readonly kind: "push"; readonly remote?: string; readonly branch?: string }
  | { readonly kind: "pr"; readonly title?: string; readonly base?: string; readonly body?: string };

export interface GitWorkflowResult {
  readonly ok: boolean;
  readonly message: string;
  readonly command?: GitWorkflowCommand["kind"];
}

interface RepositoryStatus {
  readonly branch: string;
  readonly files: readonly string[];
  readonly remoteUrl?: string;
}

/** Parses colon/slash aliases without ever constructing a shell command. */
export function parseGitWorkflowCommand(value: string): GitWorkflowCommand | undefined {
  const normalized = value.trim().replace(/^\//u, ":");
  const tokens = tokenize(normalized);
  if (tokens === undefined || tokens.length === 0) return undefined;
  const command = tokens[0]?.toLowerCase();
  if (!command?.startsWith(":")) return undefined;
  switch (command) {
    case ":branch":
      if (tokens.length === 1) return { kind: "status" };
      if (tokens.length === 3 && tokens[1]?.toLowerCase() === "create" && isSafeRef(tokens[2]!)) {
        return { kind: "create-branch", name: tokens[2]! };
      }
      return undefined;
    case ":commit": {
      const args = tokens.slice(1);
      const stageAll = args.includes("--all");
      const messageParts = args.filter((token) => token !== "--all");
      const message = messageParts.join(" ").trim();
      return isSafeCommitMessage(message)
        ? { kind: "commit", message, stageAll }
        : undefined;
    }
    case ":push": {
      const args = tokens.slice(1);
      if (args.length > 2 || args.some((arg) => !isSafeRef(arg))) return undefined;
      return {
        kind: "push",
        ...(args[0] === undefined ? {} : { remote: args[0] }),
        ...(args[1] === undefined ? {} : { branch: args[1] }),
      };
    }
    case ":pr": {
      let title: string | undefined;
      let base: string | undefined;
      let body: string | undefined;
      const freeform: string[] = [];
      for (let index = 1; index < tokens.length; index += 1) {
        const token = tokens[index]!;
        if (token === "--base" || token === "--title" || token === "--body") {
          const next = tokens[index + 1];
          if (next === undefined) return undefined;
          if (token === "--base") base = next;
          if (token === "--title") title = next;
          if (token === "--body") body = next;
          index += 1;
          continue;
        }
        if (token.startsWith("--")) return undefined;
        freeform.push(token);
      }
      if (title === undefined && freeform.length > 0) title = freeform.join(" ");
      if (title !== undefined && !isSafeCommitMessage(title, MAX_TITLE_CHARS)) return undefined;
      if (base !== undefined && !isSafeRef(base)) return undefined;
      if (body !== undefined && !isSafeCommitMessage(body, MAX_BODY_CHARS)) return undefined;
      return {
        kind: "pr",
        ...(title === undefined ? {} : { title }),
        ...(base === undefined ? {} : { base }),
        ...(body === undefined ? {} : { body }),
      };
    }
    default:
      return undefined;
  }
}

/** Identifies command-looking input so the UI can show usage instead of sending it to the model. */
export function isGitWorkflowCommand(value: string): boolean {
  const normalized = value.trim().replace(/^\//u, ":");
  return /^:(?:branch|commit|push|pr)(?:\s|$)/iu.test(normalized);
}

export async function executeGitWorkflowCommand(
  value: string | GitWorkflowCommand,
  options: GitWorkflowOptions,
): Promise<GitWorkflowResult> {
  const command = typeof value === "string" ? parseGitWorkflowCommand(value.replace(/^\//u, ":")) : value;
  if (command === undefined) {
    return { ok: false, message: "Usage: :branch [create <name>] · :commit [--all] <message> · :push [remote] [branch] · :pr [--base <branch>] [--body <text>] <title>" };
  }
  try {
    switch (command.kind) {
      case "status":
        return withKind(command.kind, await statusCommand(options));
      case "create-branch":
        return withKind(command.kind, await createBranchCommand(command.name, options));
      case "commit":
        return withKind(command.kind, await commitCommand(command, options));
      case "push":
        return withKind(command.kind, await pushCommand(command, options));
      case "pr":
        return withKind(command.kind, await pullRequestCommand(command, options));
    }
  } catch (error) {
    if (options.signal?.aborted) {
      return withKind(command.kind, { ok: false, message: "GitHub workflow cancelled." });
    }
    return withKind(command.kind, {
      ok: false,
      message: `GitHub workflow failed: ${safeError(error)}`,
    });
  }
}

async function statusCommand(options: GitWorkflowOptions): Promise<GitWorkflowResult> {
  const status = await readRepositoryStatus(options);
  if (!isRepositoryStatus(status)) return status;
  const remote = status.value.remoteUrl === undefined ? "no origin remote" : describeRemote(status.value.remoteUrl);
  const count = status.value.files.length;
  return {
    ok: true,
    message: `Branch ${status.value.branch} · ${count} changed file${count === 1 ? "" : "s"} · ${remote}.`,
  };
}

async function createBranchCommand(
  branch: string,
  options: GitWorkflowOptions,
): Promise<GitWorkflowResult> {
  const accepted = await confirm(options, `Create local branch ${branch}?`);
  if (!accepted) return { ok: false, message: "Branch creation cancelled." };
  const result = await run(options, "git", ["switch", "--create", branch]);
  return result.exitCode === 0
    ? { ok: true, message: `Created and switched to branch ${branch}.` }
    : failedCommand("Branch creation", result);
}

async function commitCommand(
  command: Extract<GitWorkflowCommand, { kind: "commit" }>,
  options: GitWorkflowOptions,
): Promise<GitWorkflowResult> {
  const status = await readRepositoryStatus(options, { includeRemote: false });
  if (!isRepositoryStatus(status)) return status;
  if (status.value.files.length === 0) return { ok: false, message: "Commit blocked: the worktree has no changes." };
  if (hasSensitivePath(status.value.files)) {
    return { ok: false, message: "Commit blocked: a sensitive-looking file is present; inspect and stage files manually." };
  }

  const check = await run(options, "git", ["diff", "--check", "HEAD", "--"]);
  if (check.exitCode !== 0) {
    return { ok: false, message: "Commit blocked: git diff check failed. Fix whitespace errors before committing." };
  }

  if (!command.stageAll) {
    const staged = await run(options, "git", ["diff", "--cached", "--name-only"]);
    if (staged.exitCode !== 0 || staged.stdout.trim() === "") {
      return { ok: false, message: "Commit blocked: no staged changes. Use :commit --all <message> or stage files manually." };
    }
  }

  const accepted = await confirm(
    options,
    `Commit ${status.value.files.length} changed file${status.value.files.length === 1 ? "" : "s"} on ${status.value.branch} with message "${command.message}"?`,
  );
  if (!accepted) return { ok: false, message: "Commit cancelled." };

  if (command.stageAll) {
    const add = await run(options, "git", ["add", "--all", "--", "."]);
    if (add.exitCode !== 0) return failedCommand("Staging", add);
  }
  const commit = await run(options, "git", ["commit", "--message", command.message]);
  if (commit.exitCode !== 0) return failedCommand("Commit", commit);
  const hash = await run(options, "git", ["rev-parse", "--short", "HEAD"]);
  return hash.exitCode === 0 && hash.stdout.trim() !== ""
    ? { ok: true, message: `Committed ${hash.stdout.trim().split(/\s+/u)[0]}.` }
    : { ok: true, message: "Commit created." };
}

async function pushCommand(
  command: Extract<GitWorkflowCommand, { kind: "push" }>,
  options: GitWorkflowOptions,
): Promise<GitWorkflowResult> {
  const status = await readRepositoryStatus(options, { includeRemote: true });
  if (!isRepositoryStatus(status)) return status;
  if (status.value.files.length > 0) return { ok: false, message: "Push blocked: commit or discard the worktree changes first." };
  const remote = command.remote ?? "origin";
  const branch = command.branch ?? status.value.branch;
  if (branch === "HEAD") return { ok: false, message: "Push blocked: detached HEAD has no branch to push." };
  const remoteUrl = remote === "origin" ? status.value.remoteUrl : await readRemote(options, remote);
  if (remoteUrl === undefined) return { ok: false, message: `Push blocked: remote ${remote} is not configured.` };
  const accepted = await confirm(options, `Push ${branch} to ${remote} (${describeRemote(remoteUrl)})?`);
  if (!accepted) return { ok: false, message: "Push cancelled." };
  const pushed = await run(options, "git", ["push", "--set-upstream", remote, branch]);
  return pushed.exitCode === 0
    ? { ok: true, message: `Pushed ${branch} to ${remote}.` }
    : failedCommand("Push", pushed);
}

async function pullRequestCommand(
  command: Extract<GitWorkflowCommand, { kind: "pr" }>,
  options: GitWorkflowOptions,
): Promise<GitWorkflowResult> {
  const status = await readRepositoryStatus(options, { includeRemote: true });
  if (!isRepositoryStatus(status)) return status;
  if (status.value.files.length > 0) return { ok: false, message: "PR blocked: commit and push the branch before creating a pull request." };
  if (status.value.branch === "HEAD") return { ok: false, message: "PR blocked: detached HEAD has no branch to review." };

  const upstream = await run(options, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.exitCode !== 0 || upstream.stdout.trim() === "") {
    return { ok: false, message: "PR blocked: push the branch first so it has an upstream remote." };
  }
  const auth = await run(options, "gh", ["auth", "status", "--hostname", "github.com"]);
  if (auth.exitCode !== 0) return { ok: false, message: "PR blocked: GitHub CLI authentication is unavailable." };

  let title = command.title;
  if (title === undefined) {
    const subject = await run(options, "git", ["log", "-1", "--format=%s"]);
    title = subject.exitCode === 0 && subject.stdout.trim() !== "" ? subject.stdout.trim().slice(0, MAX_TITLE_CHARS) : "Update workspace";
  }
  const body = command.body ?? "Created by dev-agent";
  const args = ["pr", "create", "--title", title, "--body", body, "--head", status.value.branch];
  if (command.base !== undefined) args.push("--base", command.base);
  const accepted = await confirm(options, `Create a remote pull request for ${status.value.branch}?`);
  if (!accepted) return { ok: false, message: "Pull request creation cancelled." };
  const created = await run(options, "gh", args);
  if (created.exitCode !== 0) return { ok: false, message: "Pull request creation failed; no remote review was created." };
  const url = `${created.stdout}\n${created.stderr ?? ""}`.match(GITHUB_URL_PATTERN)?.[0];
  return { ok: true, message: url === undefined ? "Pull request created." : `Pull request created: ${url}` };
}

function isRepositoryStatus(
  result: { ok: true; value: RepositoryStatus } | GitWorkflowResult,
): result is { ok: true; value: RepositoryStatus } {
  return "value" in result;
}

async function readRepositoryStatus(
  options: GitWorkflowOptions,
  settings: { readonly includeRemote: boolean } = { includeRemote: true },
): Promise<{ ok: true; value: RepositoryStatus } | GitWorkflowResult> {
  const branch = await run(options, "git", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.exitCode !== 0 || branch.stdout.trim() === "") {
    return { ok: false, message: "Git workflow requires a repository with an attached branch." };
  }
  const filesResult = await run(options, "git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (filesResult.exitCode !== 0) return failedCommand("Repository status", filesResult);
  const files = parseStatusFiles(filesResult.stdout);
  const remoteUrl = settings.includeRemote ? await readRemote(options, "origin") : undefined;
  return { ok: true, value: { branch: branch.stdout.trim(), files, ...(remoteUrl === undefined ? {} : { remoteUrl }) } };
}

async function readRemote(options: GitWorkflowOptions, remote: string): Promise<string | undefined> {
  const result = await run(options, "git", ["remote", "get-url", remote]);
  return result.exitCode === 0 && result.stdout.trim() !== "" ? result.stdout.trim().split(/\r?\n/u)[0] : undefined;
}

async function run(
  options: GitWorkflowOptions,
  command: string,
  args: readonly string[],
): Promise<GitWorkflowExecResult> {
  return options.runner(command, args, {
    cwd: options.cwd,
    signal: options.signal,
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });
}

async function confirm(options: GitWorkflowOptions, prompt: string): Promise<boolean> {
  return options.confirm(prompt);
}

function parseStatusFiles(output: string): readonly string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 2)
    .map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
    .map((path) => path.replace(/^"|"$/gu, "").replace(/\\/gu, "/"))
    .filter((path) => path.length > 0 && isSafeRelativePath(path));
}

function hasSensitivePath(paths: readonly string[]): boolean {
  return paths.some((path) => /(^|\/)(?:\.env(?:\.|$)|.*\.(?:pem|key|p12|pfx)$|id_(?:rsa|dsa|ed25519)$|credentials(?:\..*)?$|.*secret.*)/iu.test(path));
}

function isSafeRef(value: string): boolean {
  return value.length > 0 && value.length <= MAX_BRANCH_CHARS &&
    !/[\u0000\s]/u.test(value) && !value.startsWith("-") &&
    !value.includes("..") && !value.includes("@{") &&
    !value.endsWith("/") && !value.endsWith(".") &&
    !value.includes("\\");
}

function isSafeCommitMessage(value: string, max = MAX_COMMIT_MESSAGE_CHARS): boolean {
  return value.length > 0 && value.length <= max && !/[\u0000\r\n]/u.test(value);
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0 && !value.startsWith("/") && !value.startsWith("../") && value !== ".." && !value.includes("\u0000");
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
    if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (quote !== undefined || escaped) return undefined;
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function describeRemote(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "github.com" ? "github.com remote" : `${parsed.hostname} remote`;
  } catch {
    return "configured remote";
  }
}

function failedCommand(label: string, result: GitWorkflowExecResult): GitWorkflowResult {
  if (result.timedOut) return { ok: false, message: `${label} timed out.` };
  return { ok: false, message: `${label} failed; no further changes were attempted.` };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message).replace(/[\r\n]+/gu, " ").slice(0, 320) || "unknown error";
}

function withKind(
  kind: GitWorkflowCommand["kind"],
  result: GitWorkflowResult,
): GitWorkflowResult {
  return { ...result, command: kind };
}
