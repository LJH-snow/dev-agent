import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSessionHistory,
  formatSessionSearch,
  parseSessionHistoryCommand,
  parseSessionSearchCommand,
} from "../dist/session-history.js";

test("history command accepts colon and slash aliases with a bounded count", () => {
  assert.deepEqual(parseSessionHistoryCommand(":history"), {
    handled: true,
    limit: 10,
  });
  assert.deepEqual(parseSessionHistoryCommand("/history 4"), {
    handled: true,
    limit: 4,
  });
  assert.deepEqual(parseSessionHistoryCommand(":history 999"), {
    handled: true,
    limit: 50,
  });
});

test("history command rejects malformed counts without handling ordinary prompts", () => {
  assert.deepEqual(parseSessionHistoryCommand(":history nope"), {
    handled: true,
    error: "Usage: :history [count]",
  });
  assert.deepEqual(parseSessionHistoryCommand(":history 0"), {
    handled: true,
    error: "Usage: :history [count]",
  });
  assert.deepEqual(parseSessionHistoryCommand(":history 2 extra"), {
    handled: true,
    error: "Usage: :history [count]",
  });
  assert.deepEqual(parseSessionHistoryCommand("history"), { handled: false });
  assert.deepEqual(parseSessionHistoryCommand("please show history"), { handled: false });
});

test("history formatter shows the newest entries and redacts unsafe content", () => {
  const output = formatSessionHistory(
    [
      {
        id: "one",
        role: "user",
        content: "old request",
        createdAt: "2026-09-21T00:00:00.000Z",
      },
      {
        id: "two",
        role: "assistant",
        content: "token=secret-value \u001b[31mnew answer\u001b[0m",
        createdAt: "2026-09-21T00:01:00.000Z",
      },
      {
        id: "three",
        role: "tool",
        toolName: "shell",
        content: "x".repeat(500),
        createdAt: "2026-09-21T00:02:00.000Z",
      },
    ],
    { limit: 2, maxContentChars: 80 },
  );

  assert.match(output, /History: showing 2 of 3 entries/);
  assert.doesNotMatch(output, /old request/);
  assert.match(output, /Agent:/);
  assert.match(output, /Tool \(shell\):/);
  assert.doesNotMatch(output, /\u001b/);
  assert.match(output, /\[redacted\]/);
  assert.match(output, /\.\.\./);
});

test("history formatter reports an empty session", () => {
  assert.equal(formatSessionHistory([], { limit: 10 }), "No conversation history.");
});

test("history search command accepts aliases and requires a query", () => {
  assert.deepEqual(parseSessionSearchCommand(":search"), {
    handled: true,
    error: "Usage: :search <query>",
  });
  assert.deepEqual(parseSessionSearchCommand("/search terminal errors"), {
    handled: true,
    query: "terminal errors",
  });
  assert.deepEqual(parseSessionSearchCommand("search terminal"), { handled: false });
});

test("history search returns newest matching entries and searches tool names", () => {
  const output = formatSessionSearch(
    [
      {
        id: "one",
        role: "user",
        content: "build the web app",
        createdAt: "2026-09-21T00:00:00.000Z",
      },
      {
        id: "two",
        role: "tool",
        toolName: "filesystem",
        content: "wrote package.json",
        createdAt: "2026-09-21T00:01:00.000Z",
      },
      {
        id: "three",
        role: "assistant",
        content: "The terminal command completed.",
        createdAt: "2026-09-21T00:02:00.000Z",
      },
    ],
    "fileSYSTEM",
  );

  assert.match(output, /Search: "fileSYSTEM" · showing 1 of 1 matches/);
  assert.match(output, /Tool \(filesystem\): wrote package\.json/);
  assert.doesNotMatch(output, /build the web app/);
});

test("history search bounds output and reports no matches", () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({
    id: `entry-${index}`,
    role: "assistant" as const,
    content: `needle ${index} token=secret-${index}`,
    createdAt: `2026-09-21T00:0${index}:00.000Z`,
  }));
  const output = formatSessionSearch(entries, "needle", {
    limit: 2,
    maxContentChars: 30,
  });

  assert.match(output, /showing 2 of 8 matches/);
  assert.match(output, /needle 6/);
  assert.match(output, /needle 7/);
  assert.doesNotMatch(output, /needle 5/);
  assert.match(output, /\[redacted\]/);

  assert.equal(
    formatSessionSearch(entries, "missing"),
    'No history entries matching "missing".',
  );
});
