import assert from "node:assert/strict";
import test from "node:test";

import {
  executeExtensionCommand,
  formatExtensionCommandResult,
  type ExtensionCommandResult,
} from "../dist/extension-command.js";
import type { ExtensionDefinition, ExtensionRegistry } from "@dev-agent/agent-core";

const projectExtension: ExtensionDefinition = {
  id: "review-kit",
  name: "Review Kit",
  version: "1.2.0",
  description: "Review workflow metadata",
  scope: "project",
  surfaces: {
    tools: 2,
    commands: 1,
    skills: 2,
    mcpServers: 1,
    configKeys: 1,
    resources: 3,
  },
};

const userExtension: ExtensionDefinition = {
  id: "notes",
  name: "Notes",
  version: null,
  description: "Small notes helper",
  scope: "user",
  surfaces: {
    tools: 0,
    commands: 1,
    skills: 0,
    mcpServers: 0,
    configKeys: 0,
    resources: 0,
  },
};

const registry = {
  list: () => [projectExtension, userExtension],
  get: (id: string) =>
    [projectExtension, userExtension].find((extension) => extension.id === id),
} as unknown as ExtensionRegistry;

function handled(result: ExtensionCommandResult): Extract<ExtensionCommandResult, { handled: true }> {
  assert.equal(result.handled, true);
  if (!result.handled) {
    throw new Error("expected handled extension command");
  }
  return result;
}

test("extension command lists metadata without exposing paths or manifest content", () => {
  const result = handled(executeExtensionCommand(":extensions", registry));
  assert.equal(result.kind, "list");
  const output = formatExtensionCommandResult(result);
  assert.match(output, /review-kit/);
  assert.match(output, /Review Kit/);
  assert.match(output, /tools 2/);
  assert.match(output, /MCP 1/);
  assert.doesNotMatch(output, /extension\.json|\/tmp|rm -rf/);
});

test("extension command inspects one extension and accepts slash aliases", () => {
  const result = handled(executeExtensionCommand("/extension review-kit", registry));
  assert.equal(result.kind, "inspect");
  const output = formatExtensionCommandResult(result);
  assert.match(output, /Extension: review-kit/);
  assert.match(output, /Description: Review workflow metadata/);
  assert.match(output, /Scope: project/);
  assert.match(output, /resources 3/);
});

test("extension command reports usage and unknown ids", () => {
  const usage = handled(executeExtensionCommand(":extension", registry));
  assert.equal(usage.kind, "usage");
  assert.match(formatExtensionCommandResult(usage), /:extension <id>/);

  const unknown = handled(executeExtensionCommand(":extension missing", registry));
  assert.equal(unknown.kind, "unknown");
  assert.match(formatExtensionCommandResult(unknown), /Unknown extension: missing/);
});

test("ordinary prompts are not treated as extension commands", () => {
  assert.deepEqual(executeExtensionCommand("build an extension", registry), {
    handled: false,
  });
});
