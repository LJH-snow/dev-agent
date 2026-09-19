import assert from "node:assert/strict";
import test from "node:test";

import {
  createInputEditorState,
  reduceInputKey,
  type InputKey,
} from "../dist/tui-input.js";

function key(value: string): InputKey {
  if (value === "shift+enter") return { type: "enter", shift: true };
  if (value === "enter") return { type: "enter", shift: false };
  if (value === "tab") return { type: "tab" };
  if (value === "escape") return { type: "escape" };
  return { type: "text", value };
}

test("input reducer supports multiline editing and command palette filtering", () => {
  let state = createInputEditorState();
  state = reduceInputKey(state, key("h"));
  state = reduceInputKey(state, key("i"));
  state = reduceInputKey(state, key("shift+enter"));
  state = reduceInputKey(state, key("/"));

  assert.equal(state.value, "hi\n/");
  assert.equal(state.palette.open, true);
  assert.ok(state.palette.matches.some((item) => item.command === "/help"));
});

test("input reducer treats slash and colon as aliases for the same command palette", () => {
  const slash = reduceInputKey(
    createInputEditorState(),
    { type: "text", value: "/" },
    [{ command: ":help", description: "Show help" }]
  );
  const colon = reduceInputKey(
    createInputEditorState(),
    { type: "text", value: ":" },
    [{ command: ":help", description: "Show help" }]
  );

  assert.deepEqual(
    slash.palette.matches.map((item) => item.command.replace(/^[:/]/, "")),
    colon.palette.matches.map((item) => item.command.replace(/^[:/]/, ""))
  );
});

test("input reducer uses tab to complete a matching command without submitting", () => {
  let state = createInputEditorState();
  state = reduceInputKey(state, { type: "text", value: "/" });
  state = reduceInputKey(state, { type: "tab" }, [
    { command: "/help", description: "Show help" },
  ]);

  assert.equal(state.value, "/help");
  assert.equal(state.submitted, false);
});
