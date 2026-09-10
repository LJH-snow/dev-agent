import { spawn } from "node:child_process";

import type { Executor, ExecutorResult, ExecutorRunOptions } from "./index.js";

export interface LocalExecutorOptions {
  readonly historyLimit?: number;
  readonly maxConcurrentExecutions?: number;
  readonly defaultMaxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_MAX_CONCURRENT = 5;

export class LocalExecutor implements Executor {
  private readonly history: ExecutorResult[] = [];
  private readonly historyLimit?: number;
  private readonly defaultMaxOutputBytes: number;
  private readonly maxConcurrentExecutions: number;
  private activeCount = 0;

  constructor(options: LocalExecutorOptions = {}) {
    this.historyLimit = options.historyLimit;
    this.defaultMaxOutputBytes = options.defaultMaxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.maxConcurrentExecutions = options.maxConcurrentExecutions ?? DEFAULT_MAX_CONCURRENT;
  }

  async run(
    command: string,
    args: readonly string[] = [],
    options: ExecutorRunOptions = {}
  ): Promise<ExecutorResult> {
    if (!command.trim()) {
      throw new Error("LocalExecutor command must be a non-empty string");
    }

    if (this.activeCount >= this.maxConcurrentExecutions) {
      throw new Error(
        `Concurrent execution limit reached (${this.maxConcurrentExecutions}). Try again later.`
      );
    }

    const maxOutputBytes = options.maxOutputBytes ?? this.defaultMaxOutputBytes;
    this.activeCount += 1;

    try {
      return await this.execute(command, args, options, maxOutputBytes);
    } finally {
      this.activeCount -= 1;
    }
  }

  private execute(
    command: string,
    args: readonly string[],
    options: ExecutorRunOptions,
    maxOutputBytes: number
  ): Promise<ExecutorResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: mergeEnv(options.env),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let truncated = false;
      const startedAt = Date.now();

      const timer = options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(chunkStr, "utf8") > maxOutputBytes) {
          if (!truncated) {
            truncated = true;
            child.kill("SIGTERM");
          }
          return;
        }
        stdout += chunkStr;
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        if (Buffer.byteLength(stderr, "utf8") + Buffer.byteLength(chunkStr, "utf8") > maxOutputBytes) {
          return;
        }
        stderr += chunkStr;
      });

      child.on("error", (error) => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(error);
      });

      child.on("close", (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        const result: ExecutorResult = {
          stdout,
          stderr,
          exitCode: code ?? -1,
          timedOut: timedOut ? true : undefined,
          durationMs: Date.now() - startedAt,
          command,
          bytesTruncated: truncated ? true : undefined,
        };
        this.recordHistory(result);
        resolve(result);
      });

      if (options.input === undefined) {
        child.stdin?.end();
      } else {
        child.stdin?.write(options.input, () => {
          child.stdin?.end();
        });
      }
    });
  }

  private recordHistory(result: ExecutorResult): void {
    if (this.historyLimit === undefined || this.historyLimit <= 0) {
      return;
    }
    this.history.push(result);
    while (this.history.length > this.historyLimit) {
      this.history.shift();
    }
  }

  getHistory(): readonly ExecutorResult[] {
    return [...this.history];
  }

  getActiveCount(): number {
    return this.activeCount;
  }
}

function mergeEnv(
  overrides?: Readonly<Record<string, string | undefined>>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!overrides) {
    return env;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
