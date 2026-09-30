import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

function start(server: any): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as any;
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

function close(server: any): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("served Desktop HTML exposes the Codex-inspired shell regions", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /class="workspace-identity"/);
    assert.match(html, /class="workspace-nav"/);
    assert.match(html, /class="[^"]*conversation-context/);
    assert.match(html, /class="composer-meta"/);
    assert.match(html, /id="toggle-session-rail"/);
    assert.match(html, /aria-controls="session-rail"/);
    assert.match(html, /id="toggle-inspector"/);
    assert.match(html, /id="close-inspector"/);
    assert.match(html, /id="session"/);
    assert.match(html, /id="input"/);
    assert.match(html, /data-empty-state="true"/);
    assert.match(html, /conversation.starter.review/);
  } finally {
    await close(server);
  }
});

test("Desktop stylesheet defines the focused Codex-like layout contract", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const response = await fetch(`${base}/public/styles.css`);
    assert.equal(response.status, 200);
    const styles = await response.text();
    assert.match(styles, /\.workbench\s*\{[^}]*grid-template-columns:\s*minmax\(280px/);
    assert.match(styles, /\.inspector-shell\s*\{[^}]*display:\s*none/);
    assert.match(styles, /\.composer\s*\{[^}]*position:\s*sticky/);
    assert.match(styles, /\.composer:focus-within/);
    assert.match(styles, /--composer-blue:\s*#/);
    const finalComposerToolbar = styles.indexOf(
      "/* Keep the prompt bar controls visible after the final shell overrides. */"
    );
    assert.notEqual(finalComposerToolbar, -1);
    assert.match(
      styles.slice(finalComposerToolbar, finalComposerToolbar + 1000),
      /\.composer-toolbar\s*\{[\s\S]*display:\s*flex/
    );
    assert.match(styles, /\.workbench\.rail-collapsed/);
    assert.match(styles, /\.session-rail\.is-collapsed/);
    assert.match(styles, /\.inspector-shell\.is-open/);
    assert.match(styles, /\.inspector-shell\.is-collapsed/);
    assert.match(styles, /\*\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
    assert.match(styles, /\.empty\.empty-state\s*\{/);
    assert.match(styles, /\.empty-starters\s*\{/);
    assert.match(styles, /\.empty-starter:hover\s*\{/);
  } finally {
    await close(server);
  }
});

test("Desktop HTML wires independent rail collapse controls", async () => {
  const server = createDesktopServer();
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /toggleSessionRail/);
    assert.match(html, /toggleInspector/);
    assert.match(html, /session-rail-collapsed/);
    assert.match(html, /inspector-collapsed/);
  } finally {
    await close(server);
  }
});
