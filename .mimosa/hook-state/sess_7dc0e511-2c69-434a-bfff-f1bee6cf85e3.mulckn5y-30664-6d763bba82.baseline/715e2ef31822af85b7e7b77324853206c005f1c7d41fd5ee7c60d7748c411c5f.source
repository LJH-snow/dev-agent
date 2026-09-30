const STORAGE_PREFIX = "dev-agent.desktop.queue";
const STORAGE_VERSION = 2;
const LEGACY_STORAGE_VERSION = 1;
const MAX_ITEMS = 32;
const MAX_PROMPT_LENGTH = 16 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function hasStorage(storage) {
  return storage
    && typeof storage.getItem === "function"
    && typeof storage.setItem === "function"
    && typeof storage.removeItem === "function";
}

function normalizeSessionId(sessionId) {
  return typeof sessionId === "string" ? sessionId.trim() : "";
}

function byteLength(value) {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(value).byteLength;
  }
  return unescape(encodeURIComponent(value)).length;
}

function empty(reason) {
  return reason ? { items: [], reason } : { items: [] };
}

function removeSnapshot(storage, sessionId, version = STORAGE_VERSION) {
  try {
    storage.removeItem(getQueueStorageKey(sessionId, version));
  } catch {
    // Storage failures must not block the chat surface.
  }
}

export function getQueueStorageKey(sessionId, version = STORAGE_VERSION) {
  const normalized = normalizeSessionId(sessionId);
  const safeVersion = version === LEGACY_STORAGE_VERSION ? LEGACY_STORAGE_VERSION : STORAGE_VERSION;
  return `${STORAGE_PREFIX}.v${safeVersion}.${encodeURIComponent(normalized)}`;
}

export function writePersistedQueue(storage, sessionId, items, now = Date.now()) {
  if (!hasStorage(storage)) return { ok: false, reason: "storage_unavailable" };

  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId || !Array.isArray(items)) {
    return { ok: false, reason: "invalid_snapshot" };
  }
  if (items.length > MAX_ITEMS) return { ok: false, reason: "too_many_items" };

  const normalizedItems = [];
  for (const item of items) {
    const message = typeof item?.message === "string" ? item.message.trim() : "";
    if (!message) return { ok: false, reason: "invalid_item" };
    if (message.length > MAX_PROMPT_LENGTH) {
      return { ok: false, reason: "prompt_too_long" };
    }
    normalizedItems.push({
      message,
      mode: item?.mode === "plan" ? "plan" : "normal",
    });
  }

  if (normalizedItems.length === 0) {
    removeSnapshot(storage, normalizedSessionId);
    removeSnapshot(storage, normalizedSessionId, LEGACY_STORAGE_VERSION);
    return { ok: true, stored: 0 };
  }

  const serialized = JSON.stringify({
    version: STORAGE_VERSION,
    sessionId: normalizedSessionId,
    savedAt: Number.isSafeInteger(now) ? now : Date.now(),
    items: normalizedItems,
  });
  if (byteLength(serialized) > MAX_SNAPSHOT_BYTES) {
    return { ok: false, reason: "snapshot_too_large" };
  }

  try {
    storage.setItem(getQueueStorageKey(normalizedSessionId), serialized);
    return { ok: true, stored: normalizedItems.length };
  } catch {
    return { ok: false, reason: "storage_error" };
  }
}

export function movePersistedQueue(storage, fromSessionId, toSessionId, now = Date.now()) {
  if (!hasStorage(storage)) return { ok: false, reason: "storage_unavailable" };

  const source = readPersistedQueue(storage, fromSessionId, now);
  if (source.reason && source.reason !== "expired" && source.reason !== "invalid_snapshot") {
    return { ok: false, reason: source.reason };
  }

  const result = writePersistedQueue(
    storage,
    toSessionId,
    source.items,
    now,
  );
  if (!result.ok) return result;
  removeSnapshot(storage, fromSessionId);
  removeSnapshot(storage, fromSessionId, LEGACY_STORAGE_VERSION);
  return { ok: true, moved: source.items.length };
}

export function readPersistedQueue(storage, sessionId, now = Date.now()) {
  if (!hasStorage(storage)) return empty("storage_unavailable");

  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return empty("invalid_snapshot");

  let raw;
  let sourceVersion = STORAGE_VERSION;
  try {
    raw = storage.getItem(getQueueStorageKey(normalizedSessionId));
    if (raw === null) {
      sourceVersion = LEGACY_STORAGE_VERSION;
      raw = storage.getItem(getQueueStorageKey(normalizedSessionId, LEGACY_STORAGE_VERSION));
    }
  } catch {
    return empty("storage_error");
  }
  if (raw === null) return empty();
  if (byteLength(raw) > MAX_SNAPSHOT_BYTES) {
    removeSnapshot(storage, normalizedSessionId);
    return empty("snapshot_too_large");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    removeSnapshot(storage, normalizedSessionId);
    return empty("invalid_snapshot");
  }

  const isCurrentSnapshot =
    payload
    && payload.version === STORAGE_VERSION
    && Array.isArray(payload.items);
  const isLegacySnapshot =
    payload
    && payload.version === LEGACY_STORAGE_VERSION
    && Array.isArray(payload.messages);
  if (
    !payload
    || (sourceVersion === STORAGE_VERSION && !isCurrentSnapshot)
    || (sourceVersion === LEGACY_STORAGE_VERSION && !isLegacySnapshot)
    || payload.sessionId !== normalizedSessionId
    || !Number.isSafeInteger(payload.savedAt)
  ) {
    removeSnapshot(storage, normalizedSessionId, sourceVersion);
    return empty("invalid_snapshot");
  }

  if (Number.isSafeInteger(now) && now >= payload.savedAt && now - payload.savedAt > MAX_AGE_MS) {
    removeSnapshot(storage, normalizedSessionId, sourceVersion);
    return empty("expired");
  }

  const items = [];
  const rawItems = isCurrentSnapshot
    ? payload.items
    : payload.messages.map((message) => ({ message, mode: "normal" }));
  if (rawItems.length > MAX_ITEMS) {
    removeSnapshot(storage, normalizedSessionId, sourceVersion);
    return empty("invalid_snapshot");
  }
  for (const rawItem of rawItems) {
    const rawMessage = typeof rawItem === "string" ? rawItem : rawItem?.message;
    if (typeof rawMessage !== "string") {
      removeSnapshot(storage, normalizedSessionId, sourceVersion);
      return empty("invalid_snapshot");
    }
    const message = rawMessage.trim();
    if (!message || message.length > MAX_PROMPT_LENGTH) {
      removeSnapshot(storage, normalizedSessionId, sourceVersion);
      return empty("invalid_snapshot");
    }
    items.push({
      message,
      mode: typeof rawItem === "object" && rawItem?.mode === "plan" ? "plan" : "normal",
    });
  }

  return { items };
}
