import type {
  ExtensionDefinition,
  ExtensionRegistry,
} from "@dev-agent/agent-core";

export type ExtensionCommandResult =
  | { readonly handled: false }
  | {
      readonly handled: true;
      readonly kind: "list";
      readonly extensions: readonly ExtensionDefinition[];
    }
  | {
      readonly handled: true;
      readonly kind: "inspect";
      readonly extension: ExtensionDefinition;
    }
  | { readonly handled: true; readonly kind: "usage" }
  | { readonly handled: true; readonly kind: "unknown"; readonly id: string };

const NOT_HANDLED: ExtensionCommandResult = { handled: false };

export function isExtensionCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return normalized === ":extensions" ||
    normalized === ":extension" ||
    normalized.startsWith(":extension ");
}

export function executeExtensionCommand(
  command: string,
  registry: ExtensionRegistry,
): ExtensionCommandResult {
  const normalized = normalizeCommand(command);
  if (normalized === ":extensions") {
    return {
      handled: true,
      kind: "list",
      extensions: registry.list(),
    };
  }
  if (normalized === ":extension") {
    return { handled: true, kind: "usage" };
  }
  if (!normalized.startsWith(":extension ")) {
    return NOT_HANDLED;
  }

  const id = normalized.slice(":extension ".length).trim();
  if (id === "" || /\s/u.test(id)) {
    return { handled: true, kind: "usage" };
  }
  const extension = registry.get(id);
  return extension === undefined
    ? { handled: true, kind: "unknown", id }
    : { handled: true, kind: "inspect", extension };
}

export function formatExtensionCommandResult(result: ExtensionCommandResult): string {
  if (!result.handled) {
    return "";
  }
  switch (result.kind) {
    case "list":
      return result.extensions.length === 0
        ? "No extensions available."
        : [
            "Available extensions:",
            ...result.extensions.map(formatListRow),
          ].join("\n");
    case "inspect":
      return [
        `Extension: ${result.extension.id}`,
        `Name: ${result.extension.name}`,
        `Version: ${result.extension.version ?? "unversioned"}`,
        `Scope: ${result.extension.scope}`,
        `Description: ${compact(result.extension.description)}`,
        `Surfaces: ${formatSurfaces(result.extension.surfaces)}`,
      ].join("\n");
    case "usage":
      return "Usage: :extensions | :extension <id>";
    case "unknown":
      return `Unknown extension: ${result.id}`;
  }
}

function formatListRow(extension: ExtensionDefinition): string {
  return `- ${extension.id} · ${extension.name} · ${
    extension.version ?? "unversioned"
  } · ${extension.scope} · ${formatSurfaces(extension.surfaces)}`;
}

function formatSurfaces(surfaces: ExtensionDefinition["surfaces"]): string {
  return [
    `tools ${surfaces.tools}`,
    `commands ${surfaces.commands}`,
    `skills ${surfaces.skills}`,
    `MCP ${surfaces.mcpServers}`,
    `config ${surfaces.configKeys}`,
    `resources ${surfaces.resources}`,
  ].join(", ");
}

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed.startsWith("/")
    ? `:${trimmed.slice(1)}`
    : trimmed;
}
