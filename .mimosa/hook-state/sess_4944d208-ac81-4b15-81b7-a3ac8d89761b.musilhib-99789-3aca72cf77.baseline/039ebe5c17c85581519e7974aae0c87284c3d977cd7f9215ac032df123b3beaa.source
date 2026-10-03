import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  listStoredSessions,
  searchStoredSessions,
} from "../dist/session-registry.js";

function sessionFile(sessionId: string, entries: readonly unknown[]): string {
  return JSON.stringify({
    version: 1,
    metadata: {
      sessionId,
      createdAt: "2026-09-21T00:00:00.000Z",
      lastActiveAt: "2026-09-21T00:02:00.000Z",
      entryCount: entries.length,
    },
    entries,
  });
}

test("lists newest safe sessions with metadata and a redacted preview", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-registry-"));
  try {
    const older = join(directory, "older.json");
    const newer = join(directory, "newer.json");
    await writeFile(
      older,
      sessionFile("older", [
        {
          id: "older-user",
          role: "user",
          content: "old request",
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ]),
      "utf8",
    );
    await writeFile(
      newer,
      sessionFile("newer", [
        {
          id: "newer-user",
          role: "user",
          content: "token=super-secret inspect deployment",
          createdAt: "2026-09-21T00:01:00.000Z",
        },
        {
          id: "newer-assistant",
          role: "assistant",
          content: "I found the deployment issue. token=super-secret",
          createdAt: "2026-09-21T00:02:00.000Z",
        },
      ]),
      "utf8",
    );
    const now = Date.now() / 1000;
    await utimes(older, now - 20, now - 20);
    await utimes(newer, now, now);

    const sessions = await listStoredSessions(directory);
    assert.deepEqual(sessions.map((item) => item.id), ["newer", "older"]);
    assert.equal(sessions[0]?.entryCount, 2);
    assert.match(sessions[0]?.preview ?? "", /deployment issue/);
    assert.doesNotMatch(sessions[0]?.preview ?? "", /super-secret/);
    assert.match(sessions[0]?.preview ?? "", /\[redacted\]/);
    assert.equal(sessions[0]?.readable, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("skips unsafe filenames and keeps malformed files non-blocking", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-registry-"));
  try {
    await writeFile(join(directory, "valid_session.json"), sessionFile("valid_session", []), "utf8");
    await writeFile(join(directory, "bad name.json"), sessionFile("bad name", []), "utf8");
    await writeFile(join(directory, "broken.json"), "{not-json", "utf8");
    await writeFile(
      join(directory, "unreadable.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "unreadable-user",
            role: "user",
            content: "cannot restore this",
            createdAt: "2026-09-21T00:00:00.000Z",
          },
        ],
        summary: "malformed summary",
      }),
      "utf8",
    );
    await mkdir(join(directory, "nested.json"), { recursive: true });

    const sessions = await listStoredSessions(directory);
    assert.equal(sessions.some((item) => item.id === "bad name"), false);
    assert.equal(sessions.find((item) => item.id === "broken")?.readable, false);
    assert.equal(sessions.find((item) => item.id === "unreadable")?.readable, false);
    assert.equal(sessions.find((item) => item.id === "valid_session")?.readable, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bounds the complete preview to 240 Unicode characters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-registry-"));
  try {
    await writeFile(
      join(directory, "unicode.json"),
      sessionFile("unicode", [
        {
          id: "unicode-user",
          role: "user",
          content: "🧪".repeat(300),
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ]),
      "utf8",
    );

    const sessions = await listStoredSessions(directory);
    const preview = sessions[0]?.preview ?? "";
    assert.ok(Array.from(preview).length <= 240);
    assert.match(preview, /\.\.\.$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("caps the newest session list and searches id and preview safely", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-registry-"));
  try {
    await Promise.all(
      Array.from({ length: 300 }, (_, index) =>
        writeFile(
          join(directory, `session-${String(index).padStart(3, "0")}.json`),
          sessionFile(`session-${String(index).padStart(3, "0")}`, [
            {
              id: `entry-${index}`,
              role: "user",
              content: index === 299 ? "find this release note" : `message ${index}`,
              createdAt: "2026-09-21T00:00:00.000Z",
            },
          ]),
          "utf8",
        ),
      ),
    );
    const baseTime = Date.now() / 1000 - 300;
    await Promise.all(
      Array.from({ length: 300 }, (_, index) => {
        const filePath = join(directory, `session-${String(index).padStart(3, "0")}.json`);
        const modifiedAt = baseTime + index;
        return utimes(filePath, modifiedAt, modifiedAt);
      }),
    );
    const sessions = await listStoredSessions(directory, { limit: 256 });
    assert.equal(sessions.length, 256);
    assert.equal(searchStoredSessions(sessions, "release note")[0]?.id, "session-299");
    assert.equal(searchStoredSessions(sessions, "session-100")[0]?.id, "session-100");
    assert.equal(searchStoredSessions(sessions, "not-present").length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
