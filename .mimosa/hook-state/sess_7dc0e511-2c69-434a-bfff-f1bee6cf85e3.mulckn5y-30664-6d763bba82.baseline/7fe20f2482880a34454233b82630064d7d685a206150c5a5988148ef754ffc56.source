import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import { InkRuntimeStore } from "../dist/ink/runtime-store.js";
import { InkThemeProvider, getInkTheme } from "../dist/ink/theme.js";

test("Ink runtime projects an MCP capability snapshot for the status card", () => {
  const store = new InkRuntimeStore();
  const setMcpSnapshot = (store as unknown as {
    setMcpSnapshot(snapshot: unknown): void;
  }).setMcpSnapshot;
  setMcpSnapshot.call(store, {
    status: "degraded",
    servers: [{
      name: "filesystem",
      state: "timeout",
      reason: "timeout",
      latencyMs: 30000,
      tools: 3,
      resources: 2,
      prompts: 1,
    }],
    totals: { servers: 1, tools: 3, resources: 2, prompts: 1 },
  });

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.mcp?.status, "degraded");
  assert.equal(snapshot.mcp?.servers[0]?.state, "timeout");
  assert.equal(snapshot.mcp?.totals.tools, 3);
});

test("MCP status card renders capability counts and reconnect guidance", async () => {
  const moduleUrl = new URL("../dist/ink/mcp-panel.js", import.meta.url);
  const { McpPanel } = await import(moduleUrl.href) as unknown as {
    McpPanel(props: { snapshot: unknown; columns: number }): React.JSX.Element;
  };
  const output = renderToString(
    createElement(
      InkThemeProvider,
      {
        theme: getInkTheme("signal"),
        children: createElement(McpPanel, {
          columns: 100,
          snapshot: {
            status: "degraded",
            servers: [{
              name: "filesystem",
              state: "reconnecting",
              reason: "connection_failed",
              reconnectAttempt: 2,
              tools: 3,
              resources: 2,
              prompts: 1,
            }],
            totals: { servers: 1, tools: 3, resources: 2, prompts: 1 },
          },
        }),
      },
    ),
    { columns: 100 },
  );
  assert.match(output, /MCP CAPABILITIES/);
  assert.match(output, /filesystem/);
  assert.match(output, /T3/);
  assert.match(output, /R2/);
  assert.match(output, /P1/);
  assert.match(output, /:mcp test/);
});
