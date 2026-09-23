import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "ink";

import {
  MarkdownView,
  parseMarkdown,
} from "../dist/ink/markdown.js";

test("markdown parser groups streamed text into semantic blocks", () => {
  const blocks = parseMarkdown(
    [
      "# Heading",
      "",
      "- first item",
      "- second item with `code`",
      "",
      "```ts",
      "const answer = 42;",
    ].join("\n"),
  );

  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "list", "code"],
  );
  assert.equal(blocks[0]?.text, "Heading");
  assert.deepEqual(blocks[1]?.items, ["first item", "second item with `code`"]);
  assert.equal(blocks[2]?.language, "ts");
  assert.deepEqual(blocks[2]?.lines, ["const answer = 42;"]);
  assert.equal(blocks[2]?.closed, false);
});

test("markdown view renders inline emphasis and a partial code fence", () => {
  const output = renderToString(
    createElement(MarkdownView, {
      text: [
        "Use **bold**, *italic*, and `inline()`.",
        "",
        "```js",
        "console.log('streaming');",
      ].join("\n"),
      width: 72,
    }),
    { columns: 72 },
  );

  assert.match(output, /bold/);
  assert.match(output, /italic/);
  assert.match(output, /inline\(\)/);
  assert.match(output, /console\.log/);
  assert.match(output, /js/);
});

test("markdown view bounds very long streamed answers", () => {
  const blocks = parseMarkdown(
    Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n"),
    { maxLines: 8 },
  );

  assert.ok(blocks.length <= 8);
});
