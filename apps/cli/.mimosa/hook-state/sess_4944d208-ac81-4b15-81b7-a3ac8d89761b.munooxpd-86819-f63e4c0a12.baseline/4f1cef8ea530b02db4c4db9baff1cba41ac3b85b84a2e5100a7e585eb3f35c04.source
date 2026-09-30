import assert from "node:assert/strict";
import test from "node:test";

import { resolvePromptToolAccess } from "../dist/prompt-tool-policy.js";

test("omits workspace tools only for a standalone greeting", () => {
  for (const greeting of ["hi", " Hello! ", "good morning", "你好。", "哈喽～"]) {
    assert.equal(resolvePromptToolAccess(greeting), "none", greeting);
  }
});

test("keeps tools enabled for requests that include any task", () => {
  for (const prompt of [
    "hi, can you fix this bug?",
    "what does this repository do?",
    "read README.md",
    "你好，帮我看看这个错误",
    "",
  ]) {
    assert.equal(resolvePromptToolAccess(prompt), "all", prompt);
  }
});
