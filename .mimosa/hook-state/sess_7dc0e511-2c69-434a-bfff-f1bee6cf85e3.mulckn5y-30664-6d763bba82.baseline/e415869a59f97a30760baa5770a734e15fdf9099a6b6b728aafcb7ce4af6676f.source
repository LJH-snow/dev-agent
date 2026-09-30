import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  formatSessionExport,
  parseSessionExportCommand,
  writeSessionExport,
} from "../dist/session-export.js";

const ENTRIES = [
  {
    id: "one",
    role: "user" as const,
    content: "review token=secret-value",
    createdAt: "2026-09-21T00:00:00.000Z",
  },
  {
    id: "two",
    role: "assistant" as const,
    content: "\u001b[31m# Answer\u001b[0m\n\nDone.",
    createdAt: "2026-09-21T00:01:00.000Z",
  },
  {
    id: "three",
    role: "tool" as const,
    toolName: "filesystem",
    toolCallId: "call-1",
    content: "wrote package.json",
    createdAt: "2026-09-21T00:02:00.000Z",
  },
];

test("parses export aliases and formats", () => {
  assert.deepEqual(parseSessionExportCommand(":export"), {
    handled: true,
    format: "markdown",
  });
  assert.deepEqual(parseSessionExportCommand("/export json"), {
    handled: true,
    format: "json",
  });
  assert.deepEqual(parseSessionExportCommand(":export markdown"), {
    handled: true,
    format: "markdown",
  });
  const invalidFormat = parseSessionExportCommand(":export yaml");
  assert.equal(invalidFormat.handled, true);
  assert.match(
    (invalidFormat as { readonly error?: string }).error ?? "",
    /markdown|json/,
  );
  const invalidPath = parseSessionExportCommand(":export /tmp/out");
  assert.equal(invalidPath.handled, true);
  assert.match((invalidPath as { readonly error?: string }).error ?? "", /Usage/);
  assert.equal(parseSessionExportCommand("export json").handled, false);
});

test("formats redacted bounded Markdown and parseable JSON", () => {
  const markdown = formatSessionExport(ENTRIES, "markdown", {
    exportedAt: "2026-09-21T01:00:00.000Z",
  });
  assert.match(markdown, /^# dev-agent session export/m);
  assert.match(markdown, /You/);
  assert.match(markdown, /filesystem/);
  assert.match(markdown, /\[redacted\]/);
  assert.doesNotMatch(markdown, /\u001b/);

  const json = formatSessionExport(ENTRIES, "json", {
    exportedAt: "2026-09-21T01:00:00.000Z",
  });
  const parsed = JSON.parse(json) as {
    version: number;
    exportedAt: string;
    entries: Array<{ role: string; content: string }>;
  };
  assert.equal(parsed.version, 1);
  assert.equal(parsed.exportedAt, "2026-09-21T01:00:00.000Z");
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[0]?.role, "user");
  assert.match(parsed.entries[0]?.content ?? "", /\[redacted\]/);
  assert.doesNotMatch(json, /\u001b/);
});

test("bounds export size while keeping JSON valid", () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    id: `entry-${index}`,
    role: "assistant" as const,
    content: "x".repeat(1_000),
    createdAt: "2026-09-21T00:00:00.000Z",
  }));
  const json = formatSessionExport(entries, "json", {
    maxEntries: 5,
    maxEntryChars: 100,
    maxOutputBytes: 1_500,
  });
  assert.ok(Buffer.byteLength(json, "utf8") <= 1_500);
  const parsed = JSON.parse(json) as { entries: unknown[] };
  assert.ok(parsed.entries.length <= 5);
});

test("writes an atomic workspace export under .dev-agent/exports", async () => {
  const workingDirectory = await mkdtemp(join(tmpdir(), "dev-agent-export-"));
  try {
    const path = await writeSessionExport(ENTRIES, {
      workingDirectory,
      sessionId: "my/session",
      format: "json",
      now: new Date("2026-09-21T01:02:03.000Z"),
    });
    assert.equal(path.startsWith(join(workingDirectory, ".dev-agent", "exports")), true);
    assert.match(path, /my-session-20260921-010203\.json$/);
    const parsed = JSON.parse(await readFile(path, "utf8")) as { entries: unknown[] };
    assert.equal(parsed.entries.length, 3);
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
});
