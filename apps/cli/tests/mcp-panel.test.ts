import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import { InkRuntimeStore } from "../dist/ink/runtime-store.js";
import { InkThemeProvider, getInkTheme } from "../dist/ink/theme.js";
import { isPointerInPanel } from "../dist/ink/panel-hitbox.js";

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

function serverFixture(count: number) {
  return {
    status: "ready" as const,
    servers: Array.from({ length: count }, (_, index) => ({
      name: `server-${index + 1}`,
      state: "ready" as const,
      tools: 1,
      resources: 0,
      prompts: 0,
    })),
    totals: { servers: count, tools: count, resources: 0, prompts: 0 },
  };
}

async function renderMcpPanel(snapshot: unknown, offset?: number): Promise<string> {
  const moduleUrl = new URL("../dist/ink/mcp-panel.js", import.meta.url);
  const { McpPanel } = await import(moduleUrl.href) as unknown as {
    McpPanel(props: Record<string, unknown>): React.JSX.Element;
  };
  return renderToString(
    createElement(
      InkThemeProvider,
      {
        theme: getInkTheme("signal"),
        children: createElement(McpPanel, {
          columns: 100,
          snapshot,
          ...(offset === undefined ? {} : { offset }),
        }),
      },
    ),
    { columns: 100 },
  );
}

test("MCP capability card paints a bounded window with a position hint", async () => {
  const output = await renderMcpPanel(serverFixture(12));

  assert.match(output, /server-8/);
  assert.doesNotMatch(output, /server-9\b/, "only the visible window is painted");
  assert.match(output, /1–8\/12/, "the footer hints at the window position");
});

test("MCP capability card offset scrolls the painted window", async () => {
  const scrolled = await renderMcpPanel(serverFixture(12), 4);

  assert.match(scrolled, /server-5/);
  assert.match(scrolled, /server-12/);
  assert.doesNotMatch(scrolled, /server-4\b/, "rows above the window stay hidden");
  assert.match(scrolled, /5–12\/12/);
});

test("isPointerInPanel containment honors measured panel bounds", () => {
  const layout = { top: 10, height: 8 };
  assert.equal(isPointerInPanel({ x: 3, y: 11 }, layout), true, "top border row");
  assert.equal(isPointerInPanel({ x: 3, y: 18 }, layout), true, "last box row");
  assert.equal(isPointerInPanel({ x: 3, y: 10 }, layout), false, "row above the box");
  assert.equal(isPointerInPanel({ x: 3, y: 19 }, layout), false, "row below the box");
  assert.equal(isPointerInPanel({ x: 3, y: 12 }, undefined), false, "unmeasured panels never hover");
  assert.equal(isPointerInPanel({ x: 3, y: 12 }, { top: 10, height: 0 }), false, "empty panels never hover");
  assert.equal(
    isPointerInPanel({ x: Number.NaN, y: 12 }, layout),
    false,
    "non-finite pointer rows never hover",
  );
});
