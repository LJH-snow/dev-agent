import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

const maxCommandBytes = 4096;
const maxInputBytes = 8192;
const maxOutputBytes = 256 * 1024;
const maxOutputEvents = 512;
const maxRunsPerSession = 4;
const maxConcurrentRuns = 24;
const maxRetainedRuns = 128;
const maxRunLifetimeMs = 30 * 60 * 1000;
const retainedRunLifetimeMs = 60 * 60 * 1000;

export type TaskTerminalState = "running" | "exited" | "stopped" | "failed";
export type TaskTerminalStream = "stdout" | "stderr" | "input" | "system";

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

export class DesktopTaskTerminalManager {
  private readonly runs = new Map<string, TerminalRun>();

  start(sessionId: string, workingDirectory: string, command: string): TaskTerminalSnapshot {
    const commandBytes = Buffer.byteLength(command, "utf8");
    if (!command.trim() || commandBytes > maxCommandBytes || command.includes("\0")) {
      throw new TaskTerminalError("Command must be between 1 byte and 4 KiB.", 400, "terminal-command-invalid");
    }
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

    const shell = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
    const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
    let child: ChildProcess;
    try {
      child = spawn(shell, args, {
        cwd: workingDirectory,
        env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
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
      command,
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
    this.append(run, "system", `$ ${command}\n`);

    child.stdout?.on("data", (chunk: Buffer | string) => this.append(run, "stdout", String(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => this.append(run, "stderr", String(chunk)));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (run.state !== "running") return;
      run.state = "failed";
      run.finishedAt = new Date().toISOString();
      this.append(run, "system", `\n[process could not start: ${error.code ?? "spawn-failed"}]\n`);
      this.finalize(run);
    });
    child.on("close", (code) => {
      if (run.state !== "running") return;
      run.state = run.stopRequested ? "stopped" : code === 0 ? "exited" : "failed";
      run.exitCode = code;
      run.finishedAt = new Date().toISOString();
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
    this.append(run, "input", text);
    return this.snapshot(run);
  }

  stop(sessionId: string, id: string): TaskTerminalSnapshot {
    const run = this.requireRun(sessionId, id);
    if (run.state !== "running") return this.snapshot(run);
    run.stopRequested = true;
    try {
      if (process.platform !== "win32" && run.process.pid) process.kill(-run.process.pid, "SIGTERM");
      else run.process.kill("SIGTERM");
    } catch {
      try { run.process.kill("SIGTERM"); } catch { /* process already exited */ }
    }
    const timer = setTimeout(() => {
      if (run.state !== "running") return;
      try {
        if (process.platform !== "win32" && run.process.pid) process.kill(-run.process.pid, "SIGKILL");
        else run.process.kill("SIGKILL");
      } catch {
        try { run.process.kill("SIGKILL"); } catch { /* process already exited */ }
      }
    }, 1500);
    timer.unref();
    return this.snapshot(run);
  }

  hasRunning(sessionId: string): boolean {
    return [...this.runs.values()].some((run) => run.sessionId === sessionId && run.state === "running");
  }

  closeAll(): void {
    for (const run of this.runs.values()) {
      clearTimeout(run.lifetimeTimer);
      if (run.retentionTimer) clearTimeout(run.retentionTimer);
      if (run.state === "running") {
        run.stopRequested = true;
        try {
          if (process.platform !== "win32" && run.process.pid) process.kill(-run.process.pid, "SIGTERM");
          else run.process.kill("SIGTERM");
        } catch {
          try { run.process.kill("SIGTERM"); } catch { /* process already exited */ }
        }
      }
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
