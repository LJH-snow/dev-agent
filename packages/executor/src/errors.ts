/** Raised when a run was stopped because its abort signal fired. */
export class ExecutorCancelledError extends Error {
  readonly command: string;

  constructor(command: string) {
    super(`Command cancelled: ${command}`);
    this.name = "ExecutorCancelledError";
    this.command = command;
  }
}
