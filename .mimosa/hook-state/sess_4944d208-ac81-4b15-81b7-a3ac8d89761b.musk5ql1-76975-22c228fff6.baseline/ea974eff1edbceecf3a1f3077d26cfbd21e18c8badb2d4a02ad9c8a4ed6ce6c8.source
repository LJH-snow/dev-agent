export function shouldUseRichUi(options: {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  once?: boolean;
  json?: boolean;
  mcpServer?: boolean;
}): boolean {
  return (
    options.stdinIsTTY === true &&
    options.stdoutIsTTY === true &&
    options.once !== true &&
    options.json !== true &&
    options.mcpServer !== true
  );
}

export type TuiRenderer = "ink" | "none";

export function resolveTuiRenderer(options: {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  once?: boolean;
  json?: boolean;
  mcpServer?: boolean;
  env?: NodeJS.ProcessEnv;
}): TuiRenderer {
  if (!shouldUseRichUi(options)) {
    return "none";
  }
  // Keep accepting the environment object for callers that already pass it,
  // but do not expose a second interactive renderer. Ink owns every TTY
  // session now.
  return "ink";
}

export function richPromptPrefix(): string {
  return "› ";
}
