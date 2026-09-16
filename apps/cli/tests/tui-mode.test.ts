import assert from "node:assert/strict";
import test from "node:test";

import { richPromptPrefix, shouldUseRichUi } from "../dist/tui-mode.js";

test("uses rich UI only when both standard streams are TTYs", () => {
  assert.equal(
    shouldUseRichUi({ stdinIsTTY: true, stdoutIsTTY: true }),
    true
  );
  assert.equal(
    shouldUseRichUi({ stdinIsTTY: true, stdoutIsTTY: false }),
    false
  );
  assert.equal(
    shouldUseRichUi({ stdinIsTTY: false, stdoutIsTTY: true }),
    false
  );
  assert.equal(
    shouldUseRichUi({ stdinIsTTY: false, stdoutIsTTY: false }),
    false
  );
});

test("non-interactive modes disable rich UI even with TTY streams", () => {
  for (const option of ["once", "json", "mcpServer"] as const) {
    assert.equal(
      shouldUseRichUi({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        [option]: true,
      }),
      false,
      `${option} should disable rich UI`
    );
  }
});

test("missing options are treated as disabled", () => {
  assert.equal(shouldUseRichUi({}), false);
  assert.equal(
    shouldUseRichUi({ stdinIsTTY: true, stdoutIsTTY: true, once: false, json: false, mcpServer: false }),
    true
  );
});

test("rich prompt prefix is a readable visible prompt", () => {
  const prefix = richPromptPrefix();

  assert.equal(typeof prefix, "string");
  assert.notEqual(prefix, "");
  assert.match(prefix, /[^\s]/);
  assert.match(prefix, /\s$/);
});
