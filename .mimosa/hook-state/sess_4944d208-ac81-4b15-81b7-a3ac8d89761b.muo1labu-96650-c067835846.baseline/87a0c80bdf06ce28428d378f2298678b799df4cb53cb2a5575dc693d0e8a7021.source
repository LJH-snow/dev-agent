import assert from "node:assert/strict";
import test from "node:test";

interface InteractiveMcpModule {
  parseMcpInteractiveCommand(value: string): {
    readonly handled: boolean;
    readonly kind?: string;
    readonly name?: string;
    readonly request?: string;
    readonly template?: string;
    readonly error?: string;
  };
}

async function loadModule(): Promise<InteractiveMcpModule> {
  const moduleUrl = new URL("../dist/mcp-interactive-command.js", import.meta.url);
  return await import(moduleUrl.href) as unknown as InteractiveMcpModule;
}

test("interactive MCP parser recognizes management, lifecycle, and template commands", async () => {
  const { parseMcpInteractiveCommand } = await loadModule();
  assert.deepEqual(parseMcpInteractiveCommand(":mcp list"), {
    handled: true,
    kind: "list",
  });
  assert.deepEqual(parseMcpInteractiveCommand(":mcp status"), {
    handled: true,
    kind: "status",
  });
  assert.deepEqual(parseMcpInteractiveCommand(":mcp disable filesystem"), {
    handled: true,
    kind: "disable",
    name: "filesystem",
  });
  assert.deepEqual(parseMcpInteractiveCommand(":mcp add workspace --template filesystem"), {
    handled: true,
    kind: "add",
    name: "workspace",
    template: "filesystem",
  });
  assert.deepEqual(parseMcpInteractiveCommand(":mcp templates"), {
    handled: true,
    kind: "templates",
  });
});

test("interactive MCP parser gives actionable usage for malformed commands", async () => {
  const { parseMcpInteractiveCommand } = await loadModule();
  const result = parseMcpInteractiveCommand(":mcp add");
  assert.equal(result.handled, true);
  assert.equal(result.kind, "error");
  assert.match(result.error ?? "", /Usage/);
});
