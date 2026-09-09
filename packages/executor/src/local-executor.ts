import { spawn } from "node:child_process";

import type { Executor, ExecutorResult, ExecutorRunOptions } from "./index.js";

export class LocalExecutor implements Executor {
  async run(
    command: string,
    args: readonly string[] = [],
    options: ExecutorRunOptions = {}
  ): Promise<ExecutorResult> {
    if (!command.trim()) {
      throw new Error("LocalExecutor command must be a non-empty string");
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: mergeEnv(options.env),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
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
        resolve({
          stdout,
          stderr,
          exitCode: code ?? -1,
          timedOut: timedOut ? true : undefined,
        });
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
