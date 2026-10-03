// Drafts belong to a conversation, not to the shared textarea. Only bounded
// snapshots go into sessionStorage; prompts never enter preference exports.
export const COMPOSER_DRAFT_STORAGE_KEY = "dev-agent.desktop.drafts.v1";
const MAX_DRAFTS = 32;
const MAX_TEXT_LENGTH = 16 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const byteLength = (value) => new TextEncoder().encode(value).byteLength;
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 96;

export function shouldSubmitComposer(event, composing = false) {
  return event.key === "Enter" && !event.shiftKey && !event.repeat
    && !event.defaultPrevented && !composing && !event.isComposing && event.keyCode !== 229;
}

export function createComposerDrafts({ storage = null, now = Date.now } = {}) {
  const drafts = new Map();
  let persistedIds = new Set();
  const discardSnapshot = () => {
    try { storage?.removeItem(COMPOSER_DRAFT_STORAGE_KEY); } catch { /* Optional storage. */ }
  };
  try {
    const raw = storage?.getItem(COMPOSER_DRAFT_STORAGE_KEY);
    if (raw) {
      if (raw.length > MAX_SNAPSHOT_BYTES || byteLength(raw) > MAX_SNAPSHOT_BYTES) throw Error("size");
      const snapshot = JSON.parse(raw);
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.entries) || snapshot.entries.length > MAX_DRAFTS) throw Error("schema");
      const time = now();
      for (const entry of snapshot.entries) {
        if (!validId(entry?.sessionId) || typeof entry.text !== "string" || !entry.text.length
          || entry.text.length > MAX_TEXT_LENGTH || !Number.isSafeInteger(entry.savedAt)
          || entry.savedAt > time || time - entry.savedAt > MAX_AGE_MS) continue;
        drafts.set(entry.sessionId, { text: entry.text, mode: entry.mode === "plan" ? "plan" : "normal", savedAt: entry.savedAt });
        persistedIds.add(entry.sessionId);
      }
      if (!drafts.size) discardSnapshot();
    }
  } catch {
    drafts.clear();
    persistedIds.clear();
    discardSnapshot();
  }

  function persist() {
    persistedIds = new Set();
    const entries = Array.from(drafts, ([sessionId, draft]) => ({ sessionId, ...draft }))
      .filter((entry) => entry.text.length <= MAX_TEXT_LENGTH);
    if (!entries.length) { discardSnapshot(); return; }
    let raw = JSON.stringify({ version: 1, entries });
    // Prefer the most recently edited drafts without silently truncating text.
    while (entries.length && byteLength(raw) > MAX_SNAPSHOT_BYTES) {
      entries.shift();
      raw = JSON.stringify({ version: 1, entries });
    }
    try {
      if (typeof storage?.setItem !== "function") return;
      storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, raw);
      persistedIds = new Set(entries.map((entry) => entry.sessionId));
    } catch {
      discardSnapshot(); // Never resurrect an older text after a failed write.
    }
  }

  return {
    read(sessionId) {
      const draft = drafts.get(sessionId);
      return draft ? { text: draft.text, mode: draft.mode } : undefined;
    },
    save(sessionId, draft) {
      if (!validId(sessionId) || typeof draft?.text !== "string") return;
      drafts.delete(sessionId);
      if (draft.text.length) {
        drafts.set(sessionId, { text: draft.text, mode: draft.mode === "plan" ? "plan" : "normal", savedAt: now() });
      }
      while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value);
      persist();
    },
    remove(sessionId) {
      drafts.delete(sessionId);
      persist();
    },
    move(fromSessionId, toSessionId) {
      if (fromSessionId === toSessionId || !validId(toSessionId)) return;
      const draft = drafts.get(fromSessionId);
      drafts.delete(fromSessionId);
      if (draft) {
        drafts.delete(toSessionId);
        drafts.set(toSessionId, draft);
      }
      persist();
    },
    sessionIds: () => Array.from(drafts.keys()),
    isPersisted: (sessionId) => persistedIds.has(sessionId),
  };
}
