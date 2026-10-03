import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStoredSessionRow,
  parseSessionResumeCommand,
} from "../dist/session-resume.js";

test("parses session picker aliases and optional search", () => {
  assert.deepEqual(parseSessionResumeCommand(":sessions"), {
    handled: true,
    action: "open",
  });
  assert.deepEqual(parseSessionResumeCommand("/resume build api"), {
    handled: true,
    action: "open",
    query: "build api",
  });
  assert.deepEqual(parseSessionResumeCommand(":resume"), {
    handled: true,
    action: "open",
  });
});

test("rejects malformed session picker syntax without handling ordinary prompts", () => {
  assert.deepEqual(parseSessionResumeCommand(":sessions a b"), {
    handled: true,
    action: "open",
    query: "a b",
  });
  assert.deepEqual(parseSessionResumeCommand(":resume\u0000bad"), {
    handled: true,
    error: "Usage: :sessions [query]",
  });
  assert.deepEqual(parseSessionResumeCommand("please resume this"), {
    handled: false,
  });
});

test("formats a bounded sanitized session row", () => {
  const row = formatStoredSessionRow({
    id: "work",
    file: "work.json",
    size: 42,
    modifiedAt: "2026-09-21T00:00:00.000Z",
    entryCount: 4,
    preview: "token=secret fix the API",
    readable: true,
  });
  assert.match(row, /work/);
  assert.match(row, /4 entries/);
  assert.doesNotMatch(row, /secret/);
  assert.match(row, /\[redacted\]/);
});
