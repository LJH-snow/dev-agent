const DEFAULT_MAX_QUEUED = 32;
const DEFAULT_MAX_PROMPT_LENGTH = 16 * 1024;
const PROMPT_MODES = new Set(["normal", "plan"]);

let nextId = 0;

function createId(prefix) {
  nextId += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextId.toString(36)}`;
}

function copyItem(item) {
  return item ? { ...item } : undefined;
}

function normalizePromptMode(value) {
  return PROMPT_MODES.has(value) ? value : "normal";
}

export function createPromptQueue(options = {}) {
  const maxQueued = Number.isInteger(options.maxQueued) && options.maxQueued >= 0
    ? options.maxQueued
    : DEFAULT_MAX_QUEUED;
  const maxPromptLength = Number.isInteger(options.maxPromptLength) && options.maxPromptLength > 0
    ? options.maxPromptLength
    : DEFAULT_MAX_PROMPT_LENGTH;

  let active;
  let mode = "idle";
  const queued = [];

  return {
    enqueue(rawMessage, ids = {}) {
      const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
      if (!message) return { ok: false, reason: "empty_prompt" };
      if (message.length > maxPromptLength) return { ok: false, reason: "prompt_too_long" };
      if (queued.length >= maxQueued) return { ok: false, reason: "queue_full" };

      const item = {
        queueId: ids.queueId || createId("queue"),
        turnId: ids.turnId || createId("turn"),
        message,
        mode: normalizePromptMode(ids.mode),
      };
      queued.push(item);
      return { ok: true, item: copyItem(item) };
    },

    startNext() {
      if (active || mode === "paused" || queued.length === 0) return undefined;
      active = queued.shift();
      mode = "running";
      return copyItem(active);
    },

    setWaitingApproval() {
      if (active) mode = "waiting-approval";
    },

    complete(status) {
      if (!active) return;
      active = undefined;
      mode = status === "done" ? "idle" : "paused";
    },

    requeueActive() {
      if (!active) return undefined;
      const item = active;
      active = undefined;
      queued.unshift(item);
      mode = "paused";
      return copyItem(item);
    },

    remove(queueId) {
      const index = queued.findIndex((item) => item.queueId === queueId);
      if (index < 0) return false;
      queued.splice(index, 1);
      return true;
    },

    clearQueued() {
      const count = queued.length;
      queued.length = 0;
      return count;
    },

    resume() {
      if (mode === "paused") mode = "idle";
    },

    snapshot() {
      return {
        mode,
        ...(active ? { active: copyItem(active) } : {}),
        queued: queued.map(copyItem),
      };
    },
  };
}

const TERMINAL_STATUSES = new Set(["done", "failed", "aborted"]);

export function createTurnLedger() {
  const turns = new Map();

  return {
    create(turnId, message) {
      if (!turnId || turns.has(turnId)) return false;
      turns.set(turnId, { message, status: "queued" });
      return true;
    },

    start(turnId) {
      const turn = turns.get(turnId);
      if (!turn || TERMINAL_STATUSES.has(turn.status)) return false;
      turn.status = "running";
      return true;
    },

    reopen(turnId) {
      const turn = turns.get(turnId);
      if (!turn) return false;
      turn.status = "running";
      return true;
    },

    close(turnId, status) {
      const turn = turns.get(turnId);
      if (!turn || !TERMINAL_STATUSES.has(status)) return false;
      turn.status = status;
      return true;
    },

    acceptEvent(turnId) {
      const turn = turns.get(turnId);
      return Boolean(turn && !TERMINAL_STATUSES.has(turn.status));
    },
  };
}

export function createReplayCursor() {
  let runId;
  let lastSequence = -1;

  return {
    accept(nextRunId, sequence) {
      if (!nextRunId || !Number.isSafeInteger(sequence) || sequence < 0) return false;
      if (nextRunId !== runId) {
        runId = nextRunId;
        lastSequence = -1;
      }
      if (sequence <= lastSequence) return false;
      lastSequence = sequence;
      return true;
    },
  };
}
