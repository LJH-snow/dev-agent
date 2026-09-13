import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import {
  DEFAULT_EVIDENCE_RETENTION,
  FileMemory,
  type AppliedChangeSetRecord,
  type EvidencePruneOptions,
  type EvidencePruneResult,
  type EvidenceSummary,
  type MemoryEntry,
  type SessionMetadata,
  type ValidationRecord,
  type ValidationResult,
  type ValidationStatus,
} from "@dev-agent/agent-core";
import type { ChatUsage } from "@dev-agent/model";

import {
  ChatSession,
  normalizeSessionId,
  type ApprovalPrompt,
  type ApprovalRequester,
  type StreamEvent,
} from "./chat-session.js";

/** The slice of a chat session the server needs; tests inject fakes. */
export interface DesktopChatSession {
  readonly id?: string;
  /** Estimates the USD cost of a usage total with the session's current model. */
  estimateCost?(usage: ChatUsage): number | undefined;
  run(
    message: string,
    emit: (event: StreamEvent) => void,
    options?: {
      readonly signal?: AbortSignal;
      readonly requestApproval?: ApprovalRequester;
    }
  ): Promise<void>;
  /** Applies a guarded rollback for a change set prepared by this session. */
  rollbackChangeSet?(changeSetId: string): Promise<unknown>;
  /** Removes bounded, metadata-only evidence without touching the workspace. */
  pruneEvidence?(options?: EvidencePruneOptions): Promise<EvidencePruneResult>;
  /** Returns non-executable evidence counts and the effective retention limits. */
  evidenceSummary?(): Promise<EvidenceSummary>;
  /** Reruns trusted validation for an applied change set without changing files. */
  rerunValidation?(
    changeSetId: string,
    options?: { readonly signal?: AbortSignal }
  ): Promise<ValidationResult>;
  close?(): Promise<void>;
}

export interface DesktopServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly session?: DesktopChatSession;
  /** Builds a session that is not in memory yet. */
  readonly createSession?: (sessionId: string) => DesktopChatSession;
}

export interface DesktopSessionSummary {
  readonly sessionId: string;
  readonly entryCount: number;
  readonly createdAt?: string;
  readonly lastActiveAt?: string;
  readonly usage?: ChatUsage;
  readonly evidenceSummary?: EvidenceSummary;
  /** Present when the running session could price `usage`. */
  readonly cost?: number;
}

export interface DesktopHistoryMessage {
  readonly role: string;
  readonly content: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
}

type ApprovalDecision = "allow" | "deny" | "allow-always";
type EvidenceFilterResult =
  | { readonly filters: EvidenceFilters }
  | { readonly error: string };
type EvidenceCleanupOptionsResult =
  | { readonly options: EvidencePruneOptions }
  | { readonly error: string };

interface EvidenceFilters {
  readonly changeSetId?: string;
  readonly validationId?: string;
  readonly status?: ValidationStatus;
}

const validationStatuses: readonly ValidationStatus[] = [
  "passed",
  "failed",
  "skipped",
  "blocked",
];

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function createDesktopServer(options: DesktopServerOptions = {}): Server {
  const defaultSession: DesktopChatSession = options.session ?? new ChatSession();
  const defaultSessionId = defaultSession.id ?? "desktop-default";
  const createSession =
    options.createSession ?? ((sessionId: string) => new ChatSession({ sessionId }));
  const sessions = new Map<string, DesktopChatSession>([[defaultSessionId, defaultSession]]);
  const inFlight = new Set<string>();
  // One controller per running session, so a cancel request can abort it the
  // same way a dropped connection does.
  const runControllers = new Map<string, AbortController>();
  const approvals = new Map<string, (decision: ApprovalDecision) => void>();
  const sessionAllowlist = new Map<string, Set<string>>();
  const host = options.host ?? process.env.DEV_AGENT_DESKTOP_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.DEV_AGENT_DESKTOP_PORT ?? 4317);

  const sessionFor = (sessionId?: string): { id: string; session: DesktopChatSession } => {
    const id = normalizeSessionId(sessionId ?? defaultSessionId);
    const existing = sessions.get(id);
    if (existing) {
      return { id, session: existing };
    }
    const created = createSession(id);
    sessions.set(id, created);
    return { id, session: created };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    try {
      if (req.method === "GET" && url.pathname === "/") {
        await serveFile(res, join(publicDir, "index.html"), ".html");
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/sessions") {
        const summaries = await listSessions([...sessions.keys()]);
        const withCost = summaries.map((summary) => {
          if (!summary.usage) {
            return summary;
          }
          const session = sessions.get(summary.sessionId) ?? defaultSession;
          const cost = session.estimateCost?.(summary.usage);
          return cost === undefined ? summary : { ...summary, cost };
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            activeSessionId: defaultSessionId,
            sessions: withCost,
          })
        );
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/messages")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/messages".length);
        const sessionId = normalizeSessionId(decodeURIComponent(rawId));
        const filterResult = parseEvidenceFilters(url);
        if ("error" in filterResult) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: filterResult.error }));
          return;
        }
        const history = await readHistory(sessionId, filterResult.filters);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId, ...history }));
        return;
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/api/sessions/")) {
        const rawId = url.pathname.slice("/api/sessions/".length);
        const sessionId = normalizeSessionId(decodeURIComponent(rawId));
        sessions.delete(sessionId);

        let deleted = false;
        try {
          await rm(memoryPathFor(sessionId));
          deleted = true;
        } catch (error) {
          if (!isNodeError(error) || error.code !== "ENOENT") {
            throw error;
          }
        }

        if (!deleted) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId, deleted: true }));
        return;
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/rename")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/rename".length);
        const from = normalizeSessionId(decodeURIComponent(rawId));
        const body = await readBody(req);
        let parsed: { sessionId?: unknown };
        try {
          parsed = JSON.parse(body) as { sessionId?: unknown };
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request body must be valid JSON" }));
          return;
        }

        const to =
          typeof parsed.sessionId === "string" ? normalizeSessionId(parsed.sessionId) : "";
        if (!to) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is required" }));
          return;
        }

        const source = memoryPathFor(from);
        if (from === to) {
          // Renaming to the same name is idempotent when the session exists,
          // and still a 404 when it does not -- previously this answered
          // `renamed: false` for both, so a caller could not tell them apart.
          if (!existsSync(source)) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "unknown session" }));
            return;
          }
        } else {
          if (!existsSync(source)) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "unknown session" }));
            return;
          }
          if (existsSync(memoryPathFor(to))) {
            res.writeHead(409, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: `session ${to} already exists` }));
            return;
          }
          await rename(source, memoryPathFor(to));
          // The in-memory session is bound to the old path; drop it so the new
          // id is created fresh against the renamed file.
          sessions.delete(from);
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ from, to, renamed: from !== to }));
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/export")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/export".length);
        const sessionId = normalizeSessionId(decodeURIComponent(rawId));
        const memory = new FileMemory({ filePath: memoryPathFor(sessionId) });
        if (!existsSync(memoryPathFor(sessionId))) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }

        const filterResult = parseEvidenceFilters(url);
        if ("error" in filterResult) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: filterResult.error }));
          return;
        }

        const entries = await memory.entries();
        const validations = await memory.validations();
        const changeSets = await memory.changeSets();
        const metadata = await memory.getMetadata();
        const evidenceSummary = await memory.evidenceSummary();
        const evidence = filterEvidence(validations, changeSets, filterResult.filters);
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${sessionId}.md"`,
        });
        res.end(
          renderTranscript(
            sessionId,
            entries,
            metadata,
            evidence.validations,
            evidence.changeSets,
            evidenceSummary
          )
        );
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/public/")) {
        const relative = url.pathname.slice("/public/".length);
        const filePath = join(publicDir, relative);
        if (!filePath.startsWith(publicDir)) {
          res.writeHead(400).end("invalid path");
          return;
        }
        await serveFile(res, filePath, extname(filePath));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        const body = await readBody(req);
        let parsed: { message?: unknown; sessionId?: unknown };
        try {
          parsed = JSON.parse(body) as { message?: unknown; sessionId?: unknown };
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request body must be valid JSON" }));
          return;
        }

        const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
        if (!message) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "message is required" }));
          return;
        }

        const { id, session } = sessionFor(
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
        );
        if (inFlight.has(id)) {
          // A second run would interleave two histories in the same session.
          req.resume();
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: "a chat request is already running in this session" })
          );
          return;
        }

        inFlight.add(id);
        const controller = new AbortController();
        runControllers.set(id, controller);
        try {
          await streamChat(res, session, message, approvals, sessionAllowlist, id, controller);
        } finally {
          inFlight.delete(id);
          if (runControllers.get(id) === controller) {
            runControllers.delete(id);
          }
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat/cancel") {
        const body = await readBody(req);
        let parsed: { sessionId?: unknown };
        try {
          parsed = JSON.parse(body) as { sessionId?: unknown };
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request body must be valid JSON" }));
          return;
        }

        const sessionId = normalizeSessionId(
          typeof parsed.sessionId === "string" ? parsed.sessionId : defaultSessionId
        );
        const controller = runControllers.get(sessionId);
        if (controller) {
          controller.abort();
          runControllers.delete(sessionId);
        }
        res.writeHead(200, { "content-type": "application/json" });
        // Cancelling an idle session is a no-op, not an error, so the UI can
        // call this idempotently.
        res.end(JSON.stringify({ sessionId, cancelled: controller !== undefined }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/changesets/validate") {
        const body = await readBody(req);
        let parsed: { sessionId?: unknown; changeSetId?: unknown };
        try {
          parsed = JSON.parse(body) as { sessionId?: unknown; changeSetId?: unknown };
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request body must be valid JSON" }));
          return;
        }

        const changeSetId =
          typeof parsed.changeSetId === "string" ? parsed.changeSetId.trim() : "";
        if (!changeSetId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is required" }));
          return;
        }

        const sessionId = normalizeSessionId(
          typeof parsed.sessionId === "string" ? parsed.sessionId : defaultSessionId
        );
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: "a chat or validation request is already running in this session" })
          );
          return;
        }

        const session = sessions.get(sessionId);
        if (!session) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        if (!session.rerunValidation) {
          res.writeHead(501, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "validation rerun is unavailable" }));
          return;
        }

        const controller = new AbortController();
        inFlight.add(sessionId);
        runControllers.set(sessionId, controller);
        try {
          const result = await session.rerunValidation(changeSetId, {
            signal: controller.signal,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sessionId, ...result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(validationErrorStatus(message), { "content-type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        } finally {
          inFlight.delete(sessionId);
          if (runControllers.get(sessionId) === controller) {
            runControllers.delete(sessionId);
          }
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/changesets/cleanup") {
        const body = await readBody(req);
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(body);
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request body must be valid JSON" }));
          return;
        }
        if (
          typeof parsedValue !== "object" ||
          parsedValue === null ||
          Array.isArray(parsedValue)
        ) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request body must be a JSON object" }));
          return;
        }
        const parsed = parsedValue as Record<string, unknown>;
        if (parsed.sessionId !== undefined && typeof parsed.sessionId !== "string") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId must be a string" }));
          return;
        }

        const parsedOptions = parseEvidenceCleanupOptions(parsed);
        if ("error" in parsedOptions) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedOptions.error }));
          return;
        }

        const sessionId = normalizeSessionId(
          typeof parsed.sessionId === "string" ? parsed.sessionId : defaultSessionId
        );
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: "a chat, validation, or cleanup request is already running in this session" })
          );
          return;
        }

        const session = sessions.get(sessionId);
        if (!session) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        if (!session.pruneEvidence) {
          res.writeHead(501, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "evidence cleanup is unavailable" }));
          return;
        }

        inFlight.add(sessionId);
        try {
          const result = await session.pruneEvidence(parsedOptions.options);
          const evidenceSummary = await session.evidenceSummary?.();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              sessionId,
              ...result,
              ...(evidenceSummary === undefined ? {} : { evidenceSummary }),
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        } finally {
          inFlight.delete(sessionId);
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/changesets/rollback") {
        const body = await readBody(req);
        let parsed: { sessionId?: unknown; changeSetId?: unknown };
        try {
          parsed = JSON.parse(body) as { sessionId?: unknown; changeSetId?: unknown };
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request body must be valid JSON" }));
          return;
        }

        const changeSetId =
          typeof parsed.changeSetId === "string" ? parsed.changeSetId.trim() : "";
        if (!changeSetId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is required" }));
          return;
        }

        const sessionId = normalizeSessionId(
          typeof parsed.sessionId === "string" ? parsed.sessionId : defaultSessionId
        );
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: "a chat request is already running in this session" })
          );
          return;
        }

        const session = sessions.get(sessionId);
        if (!session) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        if (!session.rollbackChangeSet) {
          res.writeHead(501, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "change-set rollback is unavailable" }));
          return;
        }

        try {
          const result = await session.rollbackChangeSet(changeSetId);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const status = rollbackErrorStatus(message);
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/approval") {
        const body = await readBody(req);
        let parsed: { id?: unknown; decision?: unknown };
        try {
          parsed = JSON.parse(body) as { id?: unknown; decision?: unknown };
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "request body must be valid JSON" }));
          return;
        }

        const id = typeof parsed.id === "string" ? parsed.id : "";
        const decision =
          parsed.decision === "allow" ||
          parsed.decision === "deny" ||
          parsed.decision === "allow-always"
            ? parsed.decision
            : undefined;
        if (!id || !decision) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "id and decision are required" }));
          return;
        }

        const resolve = approvals.get(id);
        if (!resolve) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown approval request" }));
          return;
        }

        resolve(decision);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, decision }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  server.on("error", (error) => {
    console.error(`[desktop] server error: ${error.message}`);
  });

  server.once("close", () => {
    void Promise.all(
      [...sessions.values()].map((session) => session.close?.())
    ).catch(() => undefined);
  });

  return server;
}

async function serveFile(res: ServerResponse, filePath: string, ext: string): Promise<void> {
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch {
    // Missing files, directories, and unreadable paths are client errors.
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  res.writeHead(200, { "content-type": mimeTypes[ext] ?? "application/octet-stream" });
  res.end(content);
}

async function streamChat(
  res: ServerResponse,
  session: DesktopChatSession,
  message: string,
  approvals: Map<string, (decision: ApprovalDecision) => void>,
  sessionAllowlist: Map<string, Set<string>>,
  sessionId: string,
  controller: AbortController
): Promise<void> {
  const onClose = (): void => {
    // `close` also fires after a normal end; only a real disconnect aborts.
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  res.on("close", onClose);

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(`retry: 3000\n\n`);

  // A client that stops reading (or reads slowly) must not let the server
  // buffer an unbounded amount: emitting 200k token events into a paused socket
  // pushed the heap to ~192 MB. Cap what one stream may write, then stop the run
  // instead of growing further.
  const maxStreamBytes = sseMaxBytes();
  let streamBytes = 0;
  let capped = false;
  const emit = (event: StreamEvent) => {
    if (capped || res.writableEnded || res.destroyed) {
      return;
    }
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    streamBytes += Buffer.byteLength(frame, "utf8");
    if (streamBytes > maxStreamBytes) {
      capped = true;
      const notice = `event: error\ndata: ${JSON.stringify({
        message: `stream exceeded ${maxStreamBytes} bytes and was closed`,
      })}\n\n`;
      res.write(notice);
      res.end();
      // Stop the work that is producing the output; otherwise it keeps running
      // (and holding memory) with nowhere to deliver the result.
      controller.abort();
      return;
    }
    res.write(frame);
  };

  try {
    await session.run(message, emit, {
      signal: controller.signal,
      requestApproval: (prompt) => {
        const allowed = sessionAllowlist.get(sessionId);
        if (prompt.key && allowed?.has(prompt.key)) {
          return Promise.resolve("allow");
        }
        return waitForApproval(approvals, emit, prompt, controller.signal).then((decision) => {
          if (decision !== "allow-always") {
            return decision;
          }
          if (prompt.key) {
            const set = sessionAllowlist.get(sessionId) ?? new Set<string>();
            set.add(prompt.key);
            sessionAllowlist.set(sessionId, set);
          }
          return "allow";
        });
      },
    });
  } catch (error) {
    emit({
      type: "error",
      data: { message: error instanceof Error ? error.message : String(error) },
    });
  } finally {
    res.off("close", onClose);
  }

  if (!res.writableEnded) {
    res.end();
  }
}

function approvalTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.DEV_AGENT_APPROVAL_TIMEOUT_MS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 120_000;
}

/** Bytes one SSE stream may buffer before the server stops the run. */
function sseMaxBytes(): number {
  const parsed = Number.parseInt(process.env.DEV_AGENT_SSE_MAX_BYTES ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 32 * 1024 * 1024;
}

function validationErrorStatus(message: string): 404 | 409 | 500 {
  if (/unknown|expired/i.test(message)) {
    return 404;
  }
  if (/conflict|cannot be used|already in flight|prepared|rolled-back/i.test(message)) {
    return 409;
  }
  return 500;
}

function rollbackErrorStatus(message: string): 404 | 409 | 500 {
  if (/unknown|expired/i.test(message)) {
    return 404;
  }
  if (/conflict|cannot be rolled back|already rolled back/i.test(message)) {
    return 409;
  }
  return 500;
}

/** Asks the client for a decision, denying when nothing comes back in time. */
function waitForApproval(
  approvals: Map<string, (decision: ApprovalDecision) => void>,
  emit: (event: StreamEvent) => void,
  prompt: ApprovalPrompt,
  signal?: AbortSignal
): Promise<ApprovalDecision> {
  const id = randomUUID();
  emit({
    type: "approval-request",
    data: {
      id,
      tool: prompt.tool,
      reason: prompt.reason,
      input: prompt.input,
      ...(prompt.review === undefined ? {} : { review: prompt.review }),
    },
  });

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const settle = (decision: ApprovalDecision): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      approvals.delete(id);
      resolve(decision);
    };
    const onAbort = (): void => settle("deny");
    timer = setTimeout(() => settle("deny"), approvalTimeoutMs());
    approvals.set(id, settle);

    // A disconnected client can never answer, so drop the prompt immediately
    // instead of leaving it in the map until the timeout fires.
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function emptyEvidenceSummary(): EvidenceSummary {
  return {
    validations: 0,
    changeSets: 0,
    protectedChangeSets: 0,
    rolledBackChangeSets: 0,
    retention: { ...DEFAULT_EVIDENCE_RETENTION },
    protectedChangeSetsReason: "applied change-set guards are retained for validation",
  };
}

/** Renders a session as a Markdown transcript for download. */
function renderTranscript(
  sessionId: string,
  entries: readonly MemoryEntry[],
  metadata: SessionMetadata | undefined,
  validations: readonly ValidationRecord[] = [],
  changeSets: readonly AppliedChangeSetRecord[] = [],
  evidenceSummary: EvidenceSummary = emptyEvidenceSummary()
): string {
  const lines: string[] = [`# Session ${sessionId}`, ""];
  if (metadata) {
    lines.push(
      `- created: ${metadata.createdAt}`,
      `- last active: ${metadata.lastActiveAt}`,
      `- entries: ${metadata.entryCount}`,
      ""
    );
  }

  for (const entry of entries) {
    if (entry.role === "tool") {
      const label = entry.toolName ? `tool (${entry.toolName})` : "tool";
      lines.push(`## ${label}`, "", "```", entry.content, "```", "");
      continue;
    }
    lines.push(`## ${entry.role}`, "", entry.content, "");
  }

  if (validations.length > 0) {
    lines.push(
      "## Validation evidence",
      "",
      "```json",
      JSON.stringify(validations, null, 2),
      "```",
      ""
    );
  }

  if (changeSets.length > 0) {
    lines.push(
      "## Change-set evidence",
      "",
      "```json",
      JSON.stringify(changeSets, null, 2),
      "```",
      ""
    );
  }

  lines.push(
    "## Evidence retention",
    "",
    "```json",
    JSON.stringify(evidenceSummary, null, 2),
    "```",
    ""
  );

  return lines.join("\n");
}

export function sessionsDir(): string {
  return process.env.DEV_AGENT_SESSION_DIR ?? join(homedir(), ".dev-agent", "sessions");
}

export function memoryPathFor(sessionId: string): string {
  return process.env.DEV_AGENT_MEMORY_FILE ?? join(sessionsDir(), `${sessionId}.json`);
}

/** Merges session files on disk with sessions this process already created. */
export async function listSessions(
  knownSessionIds: readonly string[] = []
): Promise<DesktopSessionSummary[]> {
  const summaries = new Map<string, DesktopSessionSummary>();
  let files: string[] = [];
  try {
    files = await readdir(sessionsDir());
  } catch {
    files = [];
  }

  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const sessionId = file.slice(0, -".json".length);
    const memory = new FileMemory({ filePath: join(sessionsDir(), file) });
    const metadata = await memory.getMetadata();
    summaries.set(sessionId, {
      sessionId,
      entryCount: metadata?.entryCount ?? 0,
      createdAt: metadata?.createdAt,
      lastActiveAt: metadata?.lastActiveAt,
      usage: metadata?.usage,
      evidenceSummary: await memory.evidenceSummary().catch(() => undefined),
    });
  }

  for (const sessionId of knownSessionIds) {
    if (!summaries.has(sessionId)) {
      summaries.set(sessionId, {
        sessionId,
        entryCount: 0,
        evidenceSummary: emptyEvidenceSummary(),
      });
    }
  }

  return [...summaries.values()].sort((left, right) =>
    (right.lastActiveAt ?? "").localeCompare(left.lastActiveAt ?? "")
  );
}

async function readHistory(
  sessionId: string,
  filters: EvidenceFilters = {}
): Promise<{
  messages: DesktopHistoryMessage[];
  validations: ValidationRecord[];
  changeSets: AppliedChangeSetRecord[];
  evidenceSummary: EvidenceSummary;
}> {
  const memory = new FileMemory({ filePath: memoryPathFor(sessionId) });
  try {
    const entries = await memory.entries();
    const validations = await memory.validations();
    const changeSets = await memory.changeSets();
    const evidenceSummary = await memory.evidenceSummary();
    const evidence = filterEvidence(validations, changeSets, filters);
    return {
      messages: entries.map((entry) => ({
        role: entry.role,
        content: entry.content,
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
      })),
      validations: [...evidence.validations],
      changeSets: [...evidence.changeSets],
      evidenceSummary,
    };
  } catch {
    return {
      messages: [],
      validations: [],
      changeSets: [],
      evidenceSummary: emptyEvidenceSummary(),
    };
  }
}

function parseEvidenceCleanupOptions(
  value: Record<string, unknown>
): EvidenceCleanupOptionsResult {
  const maxValidations = parseOptionalEvidenceLimit(value.maxValidations, "maxValidations");
  if ("error" in maxValidations) {
    return maxValidations;
  }
  const maxChangeSets = parseOptionalEvidenceLimit(value.maxChangeSets, "maxChangeSets");
  if ("error" in maxChangeSets) {
    return maxChangeSets;
  }
  if (value.removeRolledBack !== undefined && typeof value.removeRolledBack !== "boolean") {
    return { error: "removeRolledBack must be a boolean" };
  }
  return {
    options: {
      ...(maxValidations.value === undefined ? {} : { maxValidations: maxValidations.value }),
      ...(maxChangeSets.value === undefined ? {} : { maxChangeSets: maxChangeSets.value }),
      ...(value.removeRolledBack === undefined ? {} : { removeRolledBack: value.removeRolledBack }),
    },
  };
}

function parseOptionalEvidenceLimit(
  value: unknown,
  name: string
): { readonly value?: number } | { readonly error: string } {
  if (value === undefined) {
    return {};
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 10_000
  ) {
    return { error: `${name} must be a positive integer no greater than 10000` };
  }
  return { value };
}

function parseEvidenceFilters(url: URL): EvidenceFilterResult {
  const changeSetId = nonEmptyQueryValue(url.searchParams.get("changeSetId"));
  const validationId = nonEmptyQueryValue(url.searchParams.get("validationId"));
  const rawStatus = nonEmptyQueryValue(url.searchParams.get("status"));
  if (
    rawStatus !== undefined &&
    !validationStatuses.includes(rawStatus as ValidationStatus)
  ) {
    return {
      error: `status must be one of: ${validationStatuses.join(", ")}`,
    };
  }
  return {
    filters: {
      ...(changeSetId === undefined ? {} : { changeSetId }),
      ...(validationId === undefined ? {} : { validationId }),
      ...(rawStatus === undefined ? {} : { status: rawStatus as ValidationStatus }),
    },
  };
}

function nonEmptyQueryValue(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function filterEvidence(
  validations: readonly ValidationRecord[],
  changeSets: readonly AppliedChangeSetRecord[],
  filters: EvidenceFilters
): { validations: ValidationRecord[]; changeSets: AppliedChangeSetRecord[] } {
  const matchingValidations = validations.filter((validation) => {
    if (
      filters.changeSetId !== undefined &&
      validation.changeSetId !== filters.changeSetId
    ) {
      return false;
    }
    if (
      filters.validationId !== undefined &&
      validation.validationId !== filters.validationId
    ) {
      return false;
    }
    return filters.status === undefined || validation.status === filters.status;
  });
  const hasValidationFilter =
    filters.validationId !== undefined || filters.status !== undefined;
  const matchingChangeSetIds = new Set(
    matchingValidations.map((validation) => validation.changeSetId)
  );
  const matchingChangeSets = changeSets.filter((changeSet) => {
    if (
      filters.changeSetId !== undefined &&
      changeSet.changeSetId !== filters.changeSetId
    ) {
      return false;
    }
    return !hasValidationFilter || matchingChangeSetIds.has(changeSet.changeSetId);
  });
  return {
    validations: matchingValidations,
    changeSets: matchingChangeSets,
  };
}

export function startServer(options: DesktopServerOptions = {}): Promise<Server> {
  const server = createDesktopServer(options);
  const host = options.host ?? process.env.DEV_AGENT_DESKTOP_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.DEV_AGENT_DESKTOP_PORT ?? 4317);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error" as never, reject as never);
      resolve(server);
    });
  });
}
