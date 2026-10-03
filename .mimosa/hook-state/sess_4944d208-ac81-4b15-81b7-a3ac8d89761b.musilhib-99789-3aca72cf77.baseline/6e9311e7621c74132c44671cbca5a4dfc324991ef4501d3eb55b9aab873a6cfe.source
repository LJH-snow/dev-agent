export type InteractiveMcpCommand =
  | { readonly handled: true; readonly kind: "help" | "list" | "status" | "validate" | "test" | "health" | "templates" }
  | { readonly handled: true; readonly kind: "add"; readonly name: string; readonly command?: string; readonly args?: readonly string[]; readonly environment?: readonly string[]; readonly timeoutMs?: number; readonly template?: string }
  | { readonly handled: true; readonly kind: "remove" | "enable" | "disable"; readonly name: string }
  | { readonly handled: true; readonly kind: "error"; readonly error: string }
  | { readonly handled: false };

export function parseMcpInteractiveCommand(value: string): InteractiveMcpCommand {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("/")
    ? `:${trimmed.slice(1)}`
    : trimmed;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens[0]?.toLowerCase() !== ":mcp") {
    return { handled: false };
  }
  const subcommand = tokens[1]?.toLowerCase();
  if (subcommand === undefined) {
    return { handled: true, kind: "help" };
  }
  if (subcommand === "template" && tokens[2]?.toLowerCase() === "list") {
    return { handled: true, kind: "templates" };
  }
  if (subcommand === "templates") {
    return tokens.length === 2
      ? { handled: true, kind: "templates" }
      : mcpUsageError();
  }
  if (subcommand === "list" || subcommand === "status" || subcommand === "validate" ||
      subcommand === "test" || subcommand === "health") {
    return tokens.length === 2
      ? { handled: true, kind: subcommand }
      : mcpUsageError();
  }
  if (subcommand === "remove" || subcommand === "enable" || subcommand === "disable") {
    if (tokens.length !== 3 || !tokens[2]) {
      return mcpUsageError(`Usage: :mcp ${subcommand} <name>`);
    }
    return { handled: true, kind: subcommand, name: tokens[2] };
  }
  if (subcommand === "add") {
    return parseAdd(tokens.slice(2));
  }
  return mcpUsageError();
}

function parseAdd(tokens: readonly string[]): InteractiveMcpCommand {
  const name = tokens[0];
  if (!name || name.startsWith("-")) {
    return mcpUsageError("Usage: :mcp add <name> --command <command> [--arg <arg>] [--env KEY=VALUE]");
  }
  const args: string[] = [];
  const environment: string[] = [];
  let command: string | undefined;
  let template: string | undefined;
  let timeoutMs: number | undefined;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--command") {
      command = tokens[++index];
      if (!command) return mcpUsageError("Usage: :mcp add <name> --command <command>");
      continue;
    }
    if (token === "--template") {
      template = tokens[++index];
      if (!template) return mcpUsageError("Usage: :mcp add <name> --template <template>");
      continue;
    }
    if (token === "--arg") {
      const arg = tokens[++index];
      if (arg === undefined) return mcpUsageError("Usage: :mcp add <name> --arg <arg>");
      args.push(arg);
      continue;
    }
    if (token === "--env") {
      const env = tokens[++index];
      if (env === undefined) return mcpUsageError("Usage: :mcp add <name> --env KEY=VALUE");
      environment.push(env);
      continue;
    }
    if (token === "--timeout-ms") {
      const raw = tokens[++index];
      if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1) {
        return mcpUsageError("Usage: :mcp add <name> --timeout-ms <positive integer>");
      }
      timeoutMs = Number(raw);
      continue;
    }
    return mcpUsageError(`Unknown MCP add option '${token}'.`);
  }
  if (command !== undefined && template !== undefined) {
    return mcpUsageError("Choose either --command or --template, not both.");
  }
  return {
    handled: true,
    kind: "add",
    name,
    ...(command === undefined ? {} : { command }),
    ...(args.length === 0 ? {} : { args }),
    ...(environment.length === 0 ? {} : { environment }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(template === undefined ? {} : { template }),
  };
}

function mcpUsageError(error = "Usage: :mcp <list|status|validate|test|health|templates|add|remove|enable|disable>"): InteractiveMcpCommand {
  return { handled: true, kind: "error", error };
}
