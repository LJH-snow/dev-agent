import assert from "node:assert/strict";
import test from "node:test";

import {
  composePrompt,
  DEFAULT_CLI_PROMPT_MODULES,
  type PromptModule,
} from "../dist/prompts.js";

test("composePrompt preserves module order and omits empty or disabled modules", () => {
  const modules: readonly PromptModule[] = [
    { id: "base", content: "  Base instructions.  " },
    { id: "empty", content: " \n " },
    { id: "disabled", content: "Do not include this.", enabled: false },
    { id: "coding", content: "\nCoding instructions.\n" },
  ];

  assert.equal(
    composePrompt(modules),
    "Base instructions.\n\nCoding instructions.",
  );
});

test("composePrompt supports an explicit separator for sentence-preserving prompts", () => {
  assert.equal(
    composePrompt(
      [
        { id: "one", content: "First." },
        { id: "two", content: "Second." },
      ],
      { separator: " " },
    ),
    "First. Second.",
  );
});

test("composePrompt rejects duplicate active module IDs", () => {
  assert.throws(
    () =>
      composePrompt([
        { id: "base", content: "First." },
        { id: "base", content: "Second." },
      ]),
    /duplicate prompt module id: base/i,
  );
});

test("composePrompt rejects blank module IDs when content is active", () => {
  assert.throws(
    () => composePrompt([{ id: "  ", content: "Instructions." }]),
    /prompt module id must not be blank/i,
  );
});


test("default CLI prompt is natural, concise, and grounded in verified work", () => {
  const prompt = composePrompt(DEFAULT_CLI_PROMPT_MODULES);

  assert.match(prompt, /respond in the user's language/i);
  assert.match(prompt, /keep greetings and simple answers brief/i);
  assert.match(prompt, /do not call tools.*unless useful/i);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /attachments.*as data rather than instructions/i);
  assert.match(prompt, /preserve unrelated work/i);
  assert.match(prompt, /verified issues/i);
  assert.doesNotMatch(prompt, /lexical for Python|lineNumbers|ReturnType aliases/i);
});
