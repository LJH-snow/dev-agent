import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

type ClipboardModule = {
  copyText: (
    text: string,
    environment?: {
      clipboard?: { writeText: (value: string) => Promise<void> };
      document?: {
        body?: { appendChild: (node: unknown) => void };
        createElement?: (tag: string) => {
          value: string;
          style: Record<string, string>;
          setAttribute: (name: string, value: string) => void;
          select: () => void;
          remove?: () => void;
        };
        execCommand?: (command: string) => boolean;
      };
    },
  ) => Promise<boolean>;
};

async function loadClipboardModule(): Promise<ClipboardModule> {
  return (await import(new URL("../public/clipboard.js", import.meta.url).href)) as ClipboardModule;
}

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

test("clipboard helper prefers the asynchronous browser clipboard", async () => {
  const { copyText } = await loadClipboardModule();
  const copied: string[] = [];

  const ok = await copyText("assistant answer", {
    clipboard: {
      async writeText(value) {
        copied.push(value);
      },
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(copied, ["assistant answer"]);
});

test("clipboard helper falls back to a temporary textarea when needed", async () => {
  const { copyText } = await loadClipboardModule();
  const appended: Array<{ value: string; removed: boolean }> = [];
  let selected = false;

  const ok = await copyText("fallback answer", {
    document: {
      body: {
        appendChild(node: { value: string; remove: () => void }) {
          const entry = { value: node.value, removed: false };
          appended.push(entry);
          node.remove = () => {
            entry.removed = true;
          };
        },
      },
      createElement() {
        return {
          value: "",
          style: {},
          setAttribute() {},
          select() {
            selected = true;
          },
          remove() {},
        };
      },
      execCommand(command) {
        return command === "copy";
      },
    },
  });

  assert.equal(ok, true);
  assert.equal(selected, true);
  assert.deepEqual(appended, [{ value: "fallback answer", removed: true }]);
});

test("clipboard helper fails closed for empty text or unavailable browser APIs", async () => {
  const { copyText } = await loadClipboardModule();

  assert.equal(await copyText(""), false);
  assert.equal(await copyText("answer", { document: {} }), false);
});

test("GET / exposes bilingual assistant response copy controls", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /from "\/public\/clipboard\.js"/);
    assert.match(html, /"action\.copy": "Copy"/);
    assert.match(html, /"action\.copy": "复制"/);
    assert.match(html, /function copyAssistantResponse\(source, button\)/);
    assert.match(html, /function appendAssistantText\(turn, text\)/);
    assert.match(html, /className = "message-copy"/);
    assert.match(html, /data-i18n-title", "action\.copyTitle"/);
    assert.match(html, /copy\.addEventListener\("click"/);
  } finally {
    await close(server);
  }
});
