import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const sendButton = html.match(/<button[^>]*id="send"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";

test("desktop send button uses a decorative SVG arrow and keeps its accessible label", () => {
  assert.match(sendButton, /<svg[^>]*class="send-icon"[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.match(sendButton, /<path d="M12 19V5"><\/path>/);
  assert.match(sendButton, /<path d="m5 12 7-7 7 7"><\/path>/);
  assert.match(sendButton, /<span class="sr-only" data-i18n="action\.send">Send<\/span>/);
  assert.doesNotMatch(sendButton, /<span aria-hidden="true">↑<\/span>/);
});

test("send icon uses rounded strokes and motion-sensitive hover feedback", () => {
  assert.ok(/#send\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*min-height:\s*36px;/s.test(styles));
  assert.ok(/#send \.send-icon\s*\{[^}]*stroke-linecap:\s*round;[^}]*stroke-linejoin:\s*round;/s.test(styles));
  assert.ok(/#send:hover \.send-icon\s*\{\s*transform:\s*translateY\(-1px\);/.test(styles));
  const sendIconRule = styles.indexOf("#send .send-icon");
  const reducedMotionStart = styles.indexOf("@media (prefers-reduced-motion: reduce)", sendIconRule);
  assert.notEqual(reducedMotionStart, -1);
  assert.ok(/#send:hover \.send-icon\s*\{\s*transform:\s*none;/.test(styles.slice(reducedMotionStart, reducedMotionStart + 260)));
});
