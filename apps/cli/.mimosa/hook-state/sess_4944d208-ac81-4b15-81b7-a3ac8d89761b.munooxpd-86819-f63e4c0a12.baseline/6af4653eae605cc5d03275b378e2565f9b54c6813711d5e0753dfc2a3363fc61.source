import { resolve } from "node:path";

export interface McpTemplate {
  readonly name: string;
  readonly description: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly requiredEnvironment: readonly string[];
}

export interface ResolvedMcpTemplate extends McpTemplate {
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

const MCP_TEMPLATES: readonly McpTemplate[] = [
  {
    name: "filesystem",
    description: "Expose a workspace directory as MCP filesystem tools.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "<workspace>"],
    requiredEnvironment: [],
  },
  {
    name: "fetch",
    description: "Fetch web pages through the lightweight fetch MCP server.",
    command: "uvx",
    args: ["mcp-server-fetch"],
    requiredEnvironment: [],
  },
  {
    name: "github",
    description: "Use GitHub tools; provide a personal access token in --env.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiredEnvironment: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
];

export function listMcpTemplates(): readonly McpTemplate[] {
  return MCP_TEMPLATES.map((template) => ({
    ...template,
    args: [...template.args],
    requiredEnvironment: [...template.requiredEnvironment],
  }));
}

export function resolveMcpTemplate(
  name: string,
  workingDirectory = process.cwd(),
): ResolvedMcpTemplate {
  const normalized = name.trim().toLowerCase();
  const template = MCP_TEMPLATES.find((candidate) => candidate.name === normalized);
  if (template === undefined) {
    throw new Error(
      `Unknown MCP template '${name}'. Available templates: ${MCP_TEMPLATES.map((item) => item.name).join(", ")}.`,
    );
  }
  const resolvedWorkingDirectory = resolve(workingDirectory);
  return {
    ...template,
    args: template.args.map((arg) =>
      arg === "<workspace>" ? resolvedWorkingDirectory : arg
    ),
    workingDirectory: resolvedWorkingDirectory,
  };
}
