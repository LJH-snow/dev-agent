import { redactSensitiveText, sanitizeTerminalText } from "./tui-renderer.js";

export interface McpResourceLine {
  readonly prefix: string;
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
}

export interface McpPromptLine {
  readonly prefix: string;
  readonly name: string;
  readonly description?: string;
  readonly argumentNames?: readonly string[];
}

const MAX_MCP_METADATA_CHARS = 2000;

export function buildMcpSystemPromptSupplement(
  resources: readonly McpResourceLine[],
  prompts: readonly McpPromptLine[]
): string {
  if (resources.length === 0 && prompts.length === 0) {
    return "";
  }

  const lines: string[] = [];

  if (resources.length > 0) {
    lines.push(
      "Available MCP resources (use the `<prefix>:resource` tool to read by URI):"
    );
    for (const resource of resources) {
      const prefix = safeMcpMetadata(resource.prefix);
      const uri = safeMcpMetadata(resource.uri);
      const name = safeMcpMetadata(resource.name);
      const label = name ? `${name} (${uri})` : uri;
      const description = safeMcpMetadata(resource.description);
      lines.push(`- ${prefix}:resource ${label}${description ? ` - ${description}` : ""}`);
    }
  }

  if (prompts.length > 0) {
    lines.push(
      "Available MCP prompts (use the `<prefix>:prompt` tool to get by name):"
    );
    for (const prompt of prompts) {
      const prefix = safeMcpMetadata(prompt.prefix);
      const name = safeMcpMetadata(prompt.name);
      const args = prompt.argumentNames?.length
        ? ` (arguments: ${prompt.argumentNames.map((argument) => safeMcpMetadata(argument)).join(", ")})`
        : "";
      const description = safeMcpMetadata(prompt.description);
      lines.push(`- ${prefix}:prompt ${name}${description ? ` - ${description}` : ""}${args}`);
    }
  }

  return lines.join("\n");
}

function safeMcpMetadata(value: unknown): string {
  const normalized = redactSensitiveText(sanitizeTerminalText(String(value ?? "")))
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= MAX_MCP_METADATA_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_MCP_METADATA_CHARS - 1)}…`;
}
