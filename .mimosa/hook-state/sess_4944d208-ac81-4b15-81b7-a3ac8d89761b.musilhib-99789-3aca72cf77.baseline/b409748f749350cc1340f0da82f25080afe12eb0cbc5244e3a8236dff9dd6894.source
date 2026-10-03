const MAX_ID_LENGTH = 96;
const MAX_ENTRIES = 128;
const TERMINAL_STATUSES = new Set(["done", "failed", "aborted"]);

export function createExecutionNotificationStore(options = {}) {
  const maxEntries = normalizeLimit(options.maxEntries);
  const entries = [];

  return {
    record(input) {
      const sessionId = normalizeId(input?.sessionId);
      const runId = normalizeId(input?.runId);
      const status = isNotificationStatus(input?.status) ? input.status : undefined;
      const finishedAt = normalizeTimestamp(input?.finishedAt);
      if (!sessionId || !runId || !status || !finishedAt) return false;
      if (entries.some((entry) => entry.sessionId === sessionId && entry.runId === runId)) return false;
      entries.unshift({ sessionId, runId, status, finishedAt, unread: true });
      entries.splice(maxEntries);
      return true;
    },
    list(sessionId) {
      return entries
        .filter((entry) => sessionId === undefined || entry.sessionId === sessionId)
        .map((entry) => ({ ...entry }));
    },
    unreadCount(sessionId) {
      return entries.filter((entry) => (
        entry.unread && (sessionId === undefined || entry.sessionId === sessionId)
      )).length;
    },
    markRead(sessionId, runId) {
      const entry = entries.find((candidate) => candidate.sessionId === sessionId && candidate.runId === runId);
      if (!entry || !entry.unread) return false;
      const index = entries.indexOf(entry);
      entries[index] = { ...entry, unread: false };
      return true;
    },
    markAllRead(sessionId) {
      let changed = 0;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry) continue;
        if (entry.unread && (sessionId === undefined || entry.sessionId === sessionId)) {
          entries[index] = { ...entry, unread: false };
          changed += 1;
        }
      }
      return changed;
    },
    clear(sessionId, runId) {
      const index = entries.findIndex((entry) => entry.sessionId === sessionId && entry.runId === runId);
      if (index < 0) return false;
      entries.splice(index, 1);
      return true;
    },
    moveSession(fromSessionId, toSessionId) {
      const from = normalizeId(fromSessionId);
      const to = normalizeId(toSessionId);
      if (!from || !to || from === to) return 0;
      let changed = 0;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (!entry || entry.sessionId !== from) continue;
        const duplicate = entries.some((candidate, candidateIndex) => (
          candidateIndex !== index && candidate.sessionId === to && candidate.runId === entry.runId
        ));
        if (duplicate) entries.splice(index, 1);
        else entries[index] = { ...entry, sessionId: to };
        changed += 1;
      }
      return changed;
    },
    clearSession(sessionId) {
      const normalized = normalizeId(sessionId);
      if (!normalized) return 0;
      let removed = 0;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index]?.sessionId === normalized) {
          entries.splice(index, 1);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

function normalizeLimit(value) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(MAX_ENTRIES, Math.max(1, value))
    : 32;
}

function normalizeId(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (!normalized || normalized.length > MAX_ID_LENGTH || normalized.includes("/")
    || normalized.includes("\\") || normalized.includes("..")) return undefined;
  return normalized;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function isNotificationStatus(value) {
  return typeof value === "string" && TERMINAL_STATUSES.has(value);
}
