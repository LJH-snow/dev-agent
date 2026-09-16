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

export function richPromptPrefix(): string {
  return "› ";
}
