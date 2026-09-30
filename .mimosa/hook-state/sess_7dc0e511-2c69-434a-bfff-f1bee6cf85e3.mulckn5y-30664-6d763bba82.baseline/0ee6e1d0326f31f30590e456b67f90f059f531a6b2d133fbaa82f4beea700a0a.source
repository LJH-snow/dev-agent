import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopServer } from "../dist/server.js";

type MarkdownModule = {
  markdownToHtml: (source: string) => string;
  renderMarkdown: (target: { innerHTML: string }, source: string) => void;
};

async function loadMarkdownModule(): Promise<MarkdownModule> {
  return (await import(new URL("../public/markdown.js", import.meta.url).href)) as MarkdownModule;
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

test("markdown renderer creates safe structure for common assistant content", async () => {
  const { markdownToHtml } = await loadMarkdownModule();
  const html = markdownToHtml(
    [
      "# Release notes",
      "",
      "**Ready** with `pnpm test`.",
      "",
      "- first item",
      "- second item",
      "",
      "```ts",
      "const answer = 42 < 43;",
      "```",
      "",
      "[read docs](https://example.com/docs)",
    ].join("\n"),
  );

  assert.match(html, /<h1>Release notes<\/h1>/);
  assert.match(html, /<strong>Ready<\/strong>/);
  assert.match(html, /<code>pnpm test<\/code>/);
  assert.match(html, /<ul><li>first item<\/li><li>second item<\/li><\/ul>/);
  assert.match(html, /<pre><code class="language-ts">const answer = 42 &lt; 43;<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noreferrer">read docs<\/a>/);
});

test("markdown renderer escapes HTML and rejects unsafe links", async () => {
  const { markdownToHtml } = await loadMarkdownModule();
  const html = markdownToHtml(
    '<script>alert("x")</script>\n\n[run](javascript:alert("x"))',
  );

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /run/);
});

test("renderMarkdown replaces the rendered view without changing the source contract", async () => {
  const { renderMarkdown } = await loadMarkdownModule();
  const target = { innerHTML: "stale" };

  renderMarkdown(target, "**fresh**");

  assert.equal(target.innerHTML, "<p><strong>fresh</strong></p>");
});

test("served Desktop HTML wires safe Markdown rendering and raw-source copying", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /from "\/public\/markdown\.js"/);
    assert.match(html, /function renderAssistantMarkdown\(target, source\)/);
    assert.match(html, /renderAssistantMarkdown\(assistant, text\)/);
    assert.match(html, /copyText\(getAssistantSourceText\(source\)\)/);
    assert.match(html, /dataset\.rawMarkdown/);
  } finally {
    await close(server);
  }
});

test("served Desktop HTML wires independent code-block copy actions", async () => {
  const server = createDesktopServer({ session: { async run() {} } });
  const base = await start(server);
  try {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /"action\.copyCode": "Copy code"/);
    assert.match(html, /"action\.copyCode": "复制代码"/);
    assert.match(html, /function decorateAssistantCodeBlocks\(target\)/);
    assert.match(html, /codeCopy\.addEventListener\("click"/);
    assert.match(html, /copyText\(code\.textContent \|\| ""\)/);
  } finally {
    await close(server);
  }
});
