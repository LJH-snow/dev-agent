export interface McpResourcePromptLine {
  readonly prefix: string;
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
}

export interface McpPromptPromptLine {
  readonly prefix: string;
  readonly name: string;
  readonly description?: string;
  readonly argumentNames?: readonly string[];
}

const MAX_METADATA_CHARS = 2000;
const MAX_METADATA_LINES = 128;
const MAX_SUPPLEMENT_CHARS = 12_000;

const SENSITIVE_KEY_PATTERN =
  /((?:["']?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*)(["']))[^"'\\]*(?:\\.[^"'\\]*)*\2/gi;
const SENSITIVE_UNQUOTED_KEY_PATTERN =
  /((?:["']?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*))(?!["'])([^"'\s,}\]]+)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+ PRIVATE KEY-----/g;
const TOKEN_SHAPE_PATTERN =
  /\b(?:sk|pk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/gi;
const ANSI_ESCAPE_PATTERN =
  /(?:\u001B\][\s\S]*?(?:\u0007|\u001B\\)|\u001B\[[0-?]*[ -/]*[@-~]|\u001B[@-_])/g;

/**
 * Formats MCP capability metadata for a model-facing prompt. MCP servers are
 * external processes, so names and descriptions are treated as untrusted:
 * control sequences, line breaks, credential-shaped values, and oversized
 * metadata are removed or bounded before composition.
 */
export function buildMcpSystemPromptSupplement(
  resources: readonly McpResourcePromptLine[],
  prompts: readonly McpPromptPromptLine[],
): string {
  const lines: string[] = [];

  if (resources.length > 0) {
    lines.push(
      "Available MCP resources (use the `<prefix>:resource` tool to read by URI):",
    );
    for (const resource of resources) {
      const prefix = safeMcpMetadata(resource.prefix);
      const uri = safeMcpMetadata(resource.uri);
      const name = safeMcpMetadata(resource.name);
      const label = name ? `${name} (${uri})` : uri;
      const description = safeMcpMetadata(resource.description);
      if (!appendBounded(lines, `- ${prefix}:resource ${label}${description ? ` - ${description}` : ""}`)) {
        break;
      }
    }
  }

  if (prompts.length > 0 && lines.length < MAX_METADATA_LINES) {
    lines.push(
      "Available MCP prompts (use the `<prefix>:prompt` tool to get by name):",
    );
    for (const prompt of prompts) {
      const prefix = safeMcpMetadata(prompt.prefix);
      const name = safeMcpMetadata(prompt.name);
      const args = prompt.argumentNames?.length
        ? ` (arguments: ${prompt.argumentNames.map((argument) => safeMcpMetadata(argument)).join(", ")})`
        : "";
      const description = safeMcpMetadata(prompt.description);
      if (!appendBounded(lines, `- ${prefix}:prompt ${name}${description ? ` - ${description}` : ""}${args}`)) {
        break;
      }
    }
  }

  return lines.join("\n");
}

function appendBounded(lines: string[], line: string): boolean {
  if (lines.length >= MAX_METADATA_LINES) {
    return false;
  }
  const current = lines.join("\n");
  const separator = current.length === 0 ? 0 : 1;
  if (current.length + separator + line.length > MAX_SUPPLEMENT_CHARS) {
    return false;
  }
  lines.push(line);
  return true;
}

function safeMcpMetadata(value: unknown): string {
  const normalized = redactSensitiveMetadata(String(value ?? ""))
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= MAX_METADATA_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_METADATA_CHARS - 1)}…`;
}

function redactSensitiveMetadata(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(SENSITIVE_KEY_PATTERN, "$1$2[redacted]$2")
    .replace(SENSITIVE_UNQUOTED_KEY_PATTERN, "$1[redacted]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(TOKEN_SHAPE_PATTERN, "[redacted-token]");
}
