import type {
  Executor,
  ExecutorResult,
  ExecutorRunOptions,
  SandboxExecutor,
} from "@dev-agent/executor";
import type { ToolExecutionContext } from "@dev-agent/agent-core";

export async function runExecutorCommand(
  executor: Executor,
  command: string,
  args: readonly string[],
  context?: ToolExecutionContext
): Promise<ExecutorResult> {
  const options: ExecutorRunOptions = {
    ...(context?.workingDirectory === undefined ? {} : { cwd: context.workingDirectory }),
    ...(context?.signal === undefined ? {} : { signal: context.signal }),
  };

  if (context?.sandbox === undefined) {
    return executor.run(command, args, options);
  }

  const sandboxExecutor = executor as Partial<SandboxExecutor>;
  if (typeof sandboxExecutor.runSandboxed !== "function") {
    throw new Error(
      "sandbox execution requested but the selected executor does not support sandbox profiles"
    );
  }

  return sandboxExecutor.runSandboxed(command, args, {
    ...options,
    profile: context.sandbox,
  });
}
