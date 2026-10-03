import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

const maxCommandBytes = 4096;
const maxInputBytes = 8192;
const maxOutputBytes = 256 * 1024;
const maxOutputEvents = 512;
const maxRunsPerSession = 4;
const maxConcurrentRuns = 24;
const maxRetainedRuns = 128;
const maxRunLifetimeMs = 30 * 60 * 1000;
const retainedRunLifetimeMs = 60 * 60 * 1000;
const terminationGraceMs = 1_500;

const SENSITIVE_KEY_PATTERN =
  /((?:["']?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*)(["']))[^"'\\]*(?:\\.[^"'\\]*)*\2/gi;
const SENSITIVE_UNQUOTED_KEY_PATTERN =
  /((?:["']?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*))(?!["'])([^"'\s,}\]]+)/gi;
const SENSITIVE_FLAG_PATTERN =
  /((?:^|\s)--?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)(?:=|\s+))(["']?)([^"'\s,}\]]+)\2/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+ PRIVATE KEY-----/g;
const TOKEN_SHAPE_PATTERN =
  /\b(?:sk|pk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/gi;
const ANSI_ESCAPE_PATTERN =
  /(?:\u001B\][\s\S]*?(?:\u0007|\u001B\\)|\u001B\[[0-?]*[ -/]*[@-~]|\u001B[@-_])/g;

export type TaskTerminalState = "running" | "exited" | "stopped" | "failed";
export type TaskTerminalStream = "stdout" | "stderr" | "input" | "system";
export type TaskTerminalLifecycleStatus = "started" | "completed" | "stopped" | "failed";

export interface DesktopTaskTerminalManagerOptions {
  readonly onLifecycle?: (event: { readonly sessionId: string; readonly status: TaskTerminalLifecycleStatus }) => void;
}

export interface TaskTerminalEvent {
  readonly sequence: number;
  readonly stream: TaskTerminalStream;
  readonly text: string;
}

export interface TaskTerminalSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly command: string;
  readonly state: TaskTerminalState;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly exitCode?: number | null;
  readonly lastSequence: number;
  readonly firstSequence: number;
  readonly events: readonly TaskTerminalEvent[];
  readonly outputTruncated: boolean;
}

export interface TaskTerminalSummary {
  readonly id: string;
  readonly sessionId: string;
  readonly command: string;
  readonly state: TaskTerminalState;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly exitCode?: number | null;
  readonly lastSequence: number;
}

interface TerminalRun {
  readonly id: string;
  readonly sessionId: string;
  readonly command: string;
  readonly process: ChildProcess;
  readonly startedAt: string;
  readonly events: TaskTerminalEvent[];
  state: TaskTerminalState;
  finishedAt?: string;
  exitCode?: number | null;
  nextSequence: number;
  eventBytes: number;
  outputTruncated: boolean;
  stopRequested: boolean;
  lifetimeTimer: NodeJS.Timeout;
  retentionTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
}

export class TaskTerminalError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message);
    this.name = "TaskTerminalError";
  }
}

function safeText(value: string): string {
  return value.replace(/\0/g, "�");
}

function redactSensitiveText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(SENSITIVE_KEY_PATTERN, "$1$2[redacted]$2")
    .replace(SENSITIVE_UNQUOTED_KEY_PATTERN, "$1[redacted]")
    .replace(SENSITIVE_FLAG_PATTERN, "$1$2[redacted]$2")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(TOKEN_SHAPE_PATTERN, "[redacted-token]");
}

function displayCommand(command: string): string {
  const normalized = redactSensitiveText(safeText(command))
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= maxCommandBytes
    ? normalized
    : `${normalized.slice(0, maxCommandBytes - 1)}…`;
}

/**
 * Terminal cwd is an internal capability selected by the Desktop workspace
 * manager. Resolve it immediately before spawning and reject symlinked or
 * missing directories so a stale task record cannot redirect a process to an
 * arbitrary path. The workspace manager performs the repository/worktree
 * ownership check; this second check closes the terminal's own spawn seam.
 */
function canonicalWorkingDirectory(workingDirectory: string): string {
  try {
    const requested = lstatSync(workingDirectory);
    if (!requested.isDirectory() || requested.isSymbolicLink()) {
      throw new Error("not a real directory");
    }
    const canonical = realpathSync(workingDirectory);
    const resolved = lstatSync(canonical);
    if (!resolved.isDirectory() || resolved.isSymbolicLink()) {
      throw new Error("not a real directory");
    }
    return canonical;
  } catch {
    throw new TaskTerminalError(
      "The terminal working directory is unavailable or unsafe.",
      409,
      "terminal-working-directory-invalid",
    );
  }
}

export class DesktopTaskTerminalManager {
  private readonly runs = new Map<string, TerminalRun>();
  private readonly onLifecycle?: DesktopTaskTerminalManagerOptions["onLifecycle"];

  constructor(options: DesktopTaskTerminalManagerOptions = {}) {
    this.onLifecycle = options.onLifecycle;
  }

  start(sessionId: string, workingDirectory: string, command: string): TaskTerminalSnapshot {
    const commandBytes = Buffer.byteLength(command, "utf8");
    if (!command.trim() || commandBytes > maxCommandBytes || command.includes("\0")) {
      throw new TaskTerminalError("Command must be between 1 byte and 4 KiB.", 400, "terminal-command-invalid");
    }
    const canonicalCwd = canonicalWorkingDirectory(workingDirectory);
    const allRuns = [...this.runs.values()];
    const activeRuns = allRuns.filter((run) => run.state === "running");
    if (activeRuns.length >= maxConcurrentRuns) {
      throw new TaskTerminalError("The desktop terminal process limit has been reached.", 409, "terminal-limit");
    }
    if (activeRuns.filter((run) => run.sessionId === sessionId).length >= maxRunsPerSession) {
      throw new TaskTerminalError("This task already has four running terminal processes.", 409, "terminal-session-limit");
    }
    this.prune();
    if (this.runs.size >= maxRetainedRuns) {
      throw new TaskTerminalError("The retained terminal history limit has been reached.", 409, "terminal-history-limit");
    }

    const safeCommand = displayCommand(command);
    const shell = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
    const guardedCommand = process.platform === "win32"
      ? command
      : [
        'if [ "$(pwd -P)" != "$DEV_AGENT_TERMINAL_EXPECTED_CWD" ]; then',
        '  printf "%s\\n" "[terminal cwd verification failed]" >&2; exit 125;',
        "fi",
        "unset DEV_AGENT_TERMINAL_EXPECTED_CWD",
        command,
      ].join("\n");
    const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", guardedCommand];
    let child: ChildProcess;
    try {
      child = spawn(shell, args, {
        cwd: canonicalCwd,
        env: {
          ...process.env,
          TERM: "dumb",
          NO_COLOR: "1",
          DEV_AGENT_TERMINAL_EXPECTED_CWD: canonicalCwd,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch {
      throw new TaskTerminalError("Terminal command could not be started.", 500, "terminal-start-failed");
    }

    const id = randomUUID();
    const run: TerminalRun = {
      id,
      sessionId,
      command: safeCommand,
      process: child,
      startedAt: new Date().toISOString(),
      events: [],
      state: "running",
      nextSequence: 1,
      eventBytes: 0,
      outputTruncated: false,
      stopRequested: false,
      lifetimeTimer: setTimeout(() => this.stop(sessionId, id), maxRunLifetimeMs),
    };
    run.lifetimeTimer.unref();
    this.runs.set(id, run);
    this.append(run, "system", `$ ${safeCommand}\n`);
    this.notifyLifecycle(sessionId, "started");

    child.stdout?.on("data", (chunk: Buffer | string) => this.append(run, "stdout", String(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => this.append(run, "stderr", String(chunk)));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (run.state !== "running") return;
      run.state = "failed";
      run.finishedAt = new Date().toISOString();
      this.append(run, "system", `\n[process could not start: ${error.code ?? "spawn-failed"}]\n`);
      this.notifyLifecycle(run.sessionId, "failed");
      this.finalize(run);
    });
    child.on("close", (code) => {
      if (run.state !== "running") return;
      run.state = run.stopRequested ? "stopped" : code === 0 ? "exited" : "failed";
      run.exitCode = code;
      run.finishedAt = new Date().toISOString();
      this.notifyLifecycle(run.sessionId, run.state === "stopped" ? "stopped" : run.state === "exited" ? "completed" : "failed");
      this.finalize(run);
    });
    return this.snapshot(run);
  }

  list(sessionId: string): readonly TaskTerminalSummary[] {
    this.prune();
    return [...this.runs.values()]
      .filter((run) => run.sessionId === sessionId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((run) => this.summary(run));
  }

  get(sessionId: string, id: string, afterSequence = 0): TaskTerminalSnapshot {
    const run = this.requireRun(sessionId, id);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new TaskTerminalError("Invalid terminal output cursor.", 400, "terminal-cursor-invalid");
    }
    const firstRetainedSequence = run.events[0]?.sequence ?? run.nextSequence;
    const cursorExpired = afterSequence > 0 && afterSequence < firstRetainedSequence - 1;
    const events = run.events.filter((event) => cursorExpired || event.sequence > afterSequence);
    return { ...this.snapshot(run, events), outputTruncated: run.outputTruncated || cursorExpired };
  }

  writeInput(sessionId: string, id: string, text: string): TaskTerminalSnapshot {
    const run = this.requireRun(sessionId, id);
    if (run.state !== "running") throw new TaskTerminalError("This terminal process is no longer running.", 409, "terminal-not-running");
    if (Buffer.byteLength(text, "utf8") > maxInputBytes || text.includes("\0")) {
      throw new TaskTerminalError("Terminal input exceeds the 8 KiB limit.", 413, "terminal-input-too-large");
    }
    if (!run.process.stdin || run.process.stdin.destroyed || !run.process.stdin.writable) {
      throw new TaskTerminalError("Terminal input is unavailable.", 409, "terminal-input-unavailable");
    }
    run.process.stdin.write(text);
    this.append(run, "input", `[input ${Buffer.byteLength(text, "utf8")} bytes]\n`);
    return this.snapshot(run);
  }

  stop(sessionId: string, id: string): TaskTerminalSnapshot {
    const run = this.requireRun(sessionId, id);
    if (run.state !== "running") return this.snapshot(run);
    this.requestStop(run);
    return this.snapshot(run);
  }

  hasRunning(sessionId: string): boolean {
    return [...this.runs.values()].some((run) => run.sessionId === sessionId && run.state === "running");
  }

  async stopSession(sessionId: string, timeoutMs = terminationGraceMs + 500): Promise<boolean> {
    const active = [...this.runs.values()].filter((run) => run.sessionId === sessionId && run.state === "running");
    if (active.length === 0) return true;
    for (const run of active) this.requestStop(run);
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(finish, timeoutMs);
      timer.unref();
      const checkClosed = (): void => {
        if (active.every((run) => run.state !== "running")) finish();
      };
      for (const run of active) run.process.once("close", checkClosed);
      if (active.every((run) => run.state !== "running")) finish();
    });
    return !this.hasRunning(sessionId);
  }

  closeAll(): void {
    for (const run of this.runs.values()) {
      clearTimeout(run.lifetimeTimer);
      if (run.retentionTimer) clearTimeout(run.retentionTimer);
      if (run.state === "running") {
        this.requestStop(run);
      }
    }
  }

  private notifyLifecycle(sessionId: string, status: TaskTerminalLifecycleStatus): void {
    try {
      this.onLifecycle?.({ sessionId, status });
    } catch {
      // Metadata observers must never change terminal execution behavior.
    }
  }

  private requestStop(run: TerminalRun): void {
    if (run.state !== "running") return;
    run.stopRequested = true;
    this.signal(run, "SIGTERM");
    if (run.killTimer) return;
    run.killTimer = setTimeout(() => {
      run.killTimer = undefined;
      if (run.state === "running") this.signal(run, "SIGKILL");
    }, terminationGraceMs);
    run.killTimer.unref();
  }

  private signal(run: TerminalRun, signal: "SIGTERM" | "SIGKILL"): void {
    try {
      if (process.platform !== "win32" && run.process.pid) process.kill(-run.process.pid, signal);
      else run.process.kill(signal);
    } catch {
      try { run.process.kill(signal); } catch { /* process already exited */ }
    }
  }

  private append(run: TerminalRun, stream: TaskTerminalStream, rawText: string): void {
    let text = safeText(rawText);
    let bytes = Buffer.from(text, "utf8");
    if (bytes.byteLength > maxOutputBytes) {
      bytes = bytes.subarray(bytes.byteLength - maxOutputBytes);
      while (bytes.length > 0 && ((bytes[0] ?? 0) & 0xc0) === 0x80) bytes = bytes.subarray(1);
      text = bytes.toString("utf8");
      run.events.length = 0;
      run.eventBytes = 0;
      run.outputTruncated = true;
    }
    const event: TaskTerminalEvent = { sequence: run.nextSequence++, stream, text };
    run.events.push(event);
    run.eventBytes += Buffer.byteLength(text, "utf8");
    while (run.events.length > maxOutputEvents || run.eventBytes > maxOutputBytes) {
      const removed = run.events.shift();
      if (!removed) break;
      run.eventBytes -= Buffer.byteLength(removed.text, "utf8");
      run.outputTruncated = true;
    }
  }

  private finalize(run: TerminalRun): void {
    clearTimeout(run.lifetimeTimer);
    if (run.killTimer) {
      clearTimeout(run.killTimer);
      run.killTimer = undefined;
    }
    run.retentionTimer = setTimeout(() => this.runs.delete(run.id), retainedRunLifetimeMs);
    run.retentionTimer.unref();
  }

  private prune(): void {
    const cutoff = Date.now() - retainedRunLifetimeMs;
    for (const run of this.runs.values()) {
      if (run.state !== "running" && Date.parse(run.startedAt) < cutoff) {
        clearTimeout(run.lifetimeTimer);
        if (run.retentionTimer) clearTimeout(run.retentionTimer);
        this.runs.delete(run.id);
      }
    }
  }

  private requireRun(sessionId: string, id: string): TerminalRun {
    const run = this.runs.get(id);
    if (!run || run.sessionId !== sessionId) {
      throw new TaskTerminalError("Terminal process not found.", 404, "terminal-not-found");
    }
    return run;
  }

  private summary(run: TerminalRun): TaskTerminalSummary {
    return {
      id: run.id,
      sessionId: run.sessionId,
      command: run.command,
      state: run.state,
      startedAt: run.startedAt,
      ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
      ...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }),
      lastSequence: run.nextSequence - 1,
    };
  }

  private snapshot(run: TerminalRun, events = run.events): TaskTerminalSnapshot {
    return {
      ...this.summary(run),
      firstSequence: run.events[0]?.sequence ?? run.nextSequence,
      events,
      outputTruncated: run.outputTruncated,
    };
  }
}
