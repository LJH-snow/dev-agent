export async function withDesktopDeadline<Result>(
  work: () => Promise<Result>,
  controller: AbortController,
  timeoutMs: number,
  timeoutMessage: string,
  options: { readonly rejectOnAbort?: boolean } = {},
): Promise<Result> {
  controller.signal.throwIfAborted();
  const rejectOnAbort = options.rejectOnAbort !== false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    if (rejectOnAbort) {
      onAbort = () => reject(controller.signal.reason ?? new Error("Operation cancelled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    }
    timer = setTimeout(() => {
      const timeoutError = new Error(timeoutMessage);
      if (!controller.signal.aborted) controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work();
    }), interrupted]);
  } finally {
    clearTimeout(timer);
    if (rejectOnAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}
