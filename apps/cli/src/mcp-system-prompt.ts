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
      const label = resource.name
        ? `${resource.name} (${resource.uri})`
        : resource.uri;
      const description = resource.description ? ` - ${resource.description}` : "";
      lines.push(`- ${resource.prefix}:resource ${label}${description}`);
    }
  }

  if (prompts.length > 0) {
    lines.push(
      "Available MCP prompts (use the `<prefix>:prompt` tool to get by name):"
    );
    for (const prompt of prompts) {
      const args = prompt.argumentNames?.length
        ? ` (arguments: ${prompt.argumentNames.join(", ")})`
        : "";
      const description = prompt.description ? ` - ${prompt.description}` : "";
      lines.push(`- ${prompt.prefix}:prompt ${prompt.name}${description}${args}`);
    }
  }

  return lines.join("\n");
}
