import assert from "node:assert/strict";
import test from "node:test";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type QueuePersistenceModule = {
  getQueueStorageKey(sessionId: string, version?: number): string;
  movePersistedQueue(
    storage: StorageLike | null | undefined,
    fromSessionId: string,
    toSessionId: string,
    now?: number,
  ): { ok: true; moved: number } | { ok: false; reason: string };
  writePersistedQueue(
    storage: StorageLike | null | undefined,
    sessionId: string,
    items: readonly { message: string; mode?: "normal" | "plan" }[],
    now?: number,
  ): { ok: true; stored: number } | { ok: false; reason: string };
  readPersistedQueue(
    storage: StorageLike | null | undefined,
    sessionId: string,
    now?: number,
  ): {
    items: { message: string; mode: "normal" | "plan" }[];
    reason?: string;
  };
};

function createStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function loadPersistenceModule(): Promise<QueuePersistenceModule> {
  return (await import(new URL("../public/queue-persistence.js", import.meta.url).href)) as QueuePersistenceModule;
}

test("persisted queue keeps FIFO waiting prompts and removes the active turn", async () => {
  const { readPersistedQueue, writePersistedQueue } = await loadPersistenceModule();
  const storage = createStorage();

  assert.deepEqual(
    writePersistedQueue(
      storage,
      "desktop-default",
      [{ message: " first ", mode: "plan" }, { message: "second" }],
      1_000,
    ),
    { ok: true, stored: 2 },
  );
  assert.deepEqual(readPersistedQueue(storage, "desktop-default", 1_000), {
    items: [
      { message: "first", mode: "plan" },
      { message: "second", mode: "normal" },
    ],
  });
});

test("empty or unavailable persistence clears without blocking the queue", async () => {
  const { readPersistedQueue, writePersistedQueue } = await loadPersistenceModule();
  const storage = createStorage();

  writePersistedQueue(storage, "desktop-default", [{ message: "waiting" }], 1_000);
  assert.deepEqual(writePersistedQueue(storage, "desktop-default", [], 1_001), {
    ok: true,
    stored: 0,
  });
  assert.deepEqual(readPersistedQueue(storage, "desktop-default", 1_001), { items: [] });
  assert.deepEqual(writePersistedQueue(null, "desktop-default", [{ message: "waiting" }]), {
    ok: false,
    reason: "storage_unavailable",
  });
  assert.deepEqual(readPersistedQueue(null, "desktop-default"), {
    items: [],
    reason: "storage_unavailable",
  });
});

test("corrupt, cross-session, expired, and oversized queue snapshots fail closed", async () => {
  const { getQueueStorageKey, readPersistedQueue, writePersistedQueue } = await loadPersistenceModule();
  const storage = createStorage();
  const key = getQueueStorageKey("desktop-default");

  storage.setItem(key, "{not-json");
  assert.deepEqual(readPersistedQueue(storage, "desktop-default", 1_000), {
    items: [],
    reason: "invalid_snapshot",
  });

  storage.setItem(
    key,
    JSON.stringify({
      version: 1,
      sessionId: "other-session",
      savedAt: 1_000,
      messages: ["should not load"],
    }),
  );
  assert.deepEqual(readPersistedQueue(storage, "desktop-default", 1_000), {
    items: [],
    reason: "invalid_snapshot",
  });

  writePersistedQueue(storage, "desktop-default", [{ message: "expired" }], 1_000);
  assert.deepEqual(readPersistedQueue(storage, "desktop-default", 86_401_001), {
    items: [],
    reason: "expired",
  });

  assert.deepEqual(
    writePersistedQueue(storage, "desktop-default", [{ message: "x".repeat(16 * 1024 + 1) }], 2_000),
    { ok: false, reason: "prompt_too_long" },
  );
});

test("renaming a session moves its waiting queue and clears the old storage key", async () => {
  const { getQueueStorageKey, movePersistedQueue, readPersistedQueue, writePersistedQueue } =
    await loadPersistenceModule();
  const storage = createStorage();

  writePersistedQueue(storage, "old-session", [{ message: "keep me queued" }], 1_000);
  assert.deepEqual(movePersistedQueue(storage, "old-session", "new-session", 1_001), {
    ok: true,
    moved: 1,
  });
  assert.deepEqual(readPersistedQueue(storage, "new-session", 1_001), {
    items: [{ message: "keep me queued", mode: "normal" }],
  });
  assert.equal(storage.getItem(getQueueStorageKey("old-session")), null);
});

test("version one snapshots migrate queued messages to normal mode", async () => {
  const { getQueueStorageKey, readPersistedQueue } = await loadPersistenceModule();
  const storage = createStorage();

  storage.setItem(
    getQueueStorageKey("desktop-default", 1),
    JSON.stringify({
      version: 1,
      sessionId: "desktop-default",
      savedAt: 1_000,
      messages: ["legacy prompt"],
    }),
  );

  assert.deepEqual(readPersistedQueue(storage, "desktop-default", 1_000), {
    items: [{ message: "legacy prompt", mode: "normal" }],
  });
});
