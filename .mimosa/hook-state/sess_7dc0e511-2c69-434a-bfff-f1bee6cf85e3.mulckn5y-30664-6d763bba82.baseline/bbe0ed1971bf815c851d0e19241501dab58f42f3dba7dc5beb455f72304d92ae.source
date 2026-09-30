import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executeProjectMemoryCommand,
  parseProjectMemoryCommand,
  ProjectMemoryStore,
  type ProjectMemoryRecord,
} from "../dist/project-memory.js";

const base = { cwd: "/workspace/project" };

test("parses bounded memory commands and slash aliases", () => {
  assert.deepEqual(parseProjectMemoryCommand(":memory"), { kind: "list" });
  assert.deepEqual(
    parseProjectMemoryCommand('/memory add --source "team docs" --confidence high "Use pnpm test"'),
    {
      kind: "add",
      content: "Use pnpm test",
      source: "team docs",
      confidence: "high",
    },
  );
  assert.deepEqual(parseProjectMemoryCommand(":memory search " + '"pnpm"'), {
    kind: "search",
    query: "pnpm",
  });
  assert.deepEqual(parseProjectMemoryCommand(":memory forget memory-1234"), {
    kind: "forget",
    id: "memory-1234",
  });
  assert.equal(parseProjectMemoryCommand(":memory add --confidence extreme note"), undefined);
  assert.equal(parseProjectMemoryCommand(":memory forget ../outside"), undefined);
});

test("persists project memory with source, confidence, time, and bounded search", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-project-memory-"));
  const filePath = join(directory, "project-memory.json");
  try {
    const store = new ProjectMemoryStore({ filePath });
    const record = await store.add({
      content: "Run the focused CLI tests before the full suite.",
      source: "user",
      confidence: "high",
    });
    assert.match(record.id, /^memory-[a-f0-9]{8}$/);
    assert.equal(record.source, "user");
    assert.equal(record.confidence, "high");
    assert.ok(record.createdAt.length > 10);
    assert.deepEqual(await store.search("focused cli"), [record]);

    const reloaded = new ProjectMemoryStore({ filePath });
    assert.deepEqual(await reloaded.list(), [record]);
    assert.deepEqual(await reloaded.search("missing"), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("add and forget require confirmation and never mutate on denial", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-project-memory-command-"));
  try {
    const store = new ProjectMemoryStore({ filePath: join(directory, "memory.json") });
    const prompts: string[] = [];
    const denied = await executeProjectMemoryCommand(":memory add note", {
      ...base,
      store,
      confirm: async (prompt) => {
        prompts.push(prompt);
        return false;
      },
    });
    assert.equal(denied.ok, false);
    assert.equal((await store.list()).length, 0);
    assert.match(prompts[0] ?? "", /save/i);

    const added = await executeProjectMemoryCommand(":memory add --source docs note", {
      ...base,
      store,
      confirm: async () => true,
    });
    assert.equal(added.ok, true);
    const record = (await store.list())[0] as ProjectMemoryRecord;

    const forgetPrompt: string[] = [];
    const forgot = await executeProjectMemoryCommand(`:memory forget ${record.id}`, {
      ...base,
      store,
      confirm: async (prompt) => {
        forgetPrompt.push(prompt);
        return true;
      },
    });
    assert.equal(forgot.ok, true);
    assert.match(forgetPrompt[0] ?? "", /forget/i);
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("search and list are read-only and format without absolute paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-agent-project-memory-view-"));
  try {
    const store = new ProjectMemoryStore({ filePath: join(directory, "memory.json") });
    await store.add({ content: "Keep generated files out of commits", source: "review", confidence: "medium" });
    const calls: string[] = [];
    const result = await executeProjectMemoryCommand(":memory search generated", {
      ...base,
      store,
      confirm: async (prompt) => {
        calls.push(prompt);
        return true;
      },
    });
    assert.equal(result.ok, true);
    assert.match(result.message, /generated files/);
    assert.doesNotMatch(result.message, /workspace\/project/);
    assert.deepEqual(calls, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
