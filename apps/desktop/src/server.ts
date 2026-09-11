import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import { FileMemory, type MemoryEntry, type SessionMetadata } from "@dev-agent/agent-core";
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
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId, messages: await readHistory(sessionId) }));
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

        if (from !== to) {
          const source = memoryPathFor(from);
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

        const entries = await memory.entries();
        const metadata = await memory.getMetadata();
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${sessionId}.md"`,
        });
        res.end(renderTranscript(sessionId, entries, metadata));
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
        try {
          await streamChat(res, session, message, approvals, sessionAllowlist, id);
        } finally {
          inFlight.delete(id);
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
  sessionId: string
): Promise<void> {
  const controller = new AbortController();
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

  const emit = (event: StreamEvent) => {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
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
    data: { id, tool: prompt.tool, reason: prompt.reason, input: prompt.input },
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

/** Renders a session as a Markdown transcript for download. */
function renderTranscript(
  sessionId: string,
  entries: readonly MemoryEntry[],
  metadata: SessionMetadata | undefined
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
    });
  }

  for (const sessionId of knownSessionIds) {
    if (!summaries.has(sessionId)) {
      summaries.set(sessionId, { sessionId, entryCount: 0 });
    }
  }

  return [...summaries.values()].sort((left, right) =>
    (right.lastActiveAt ?? "").localeCompare(left.lastActiveAt ?? "")
  );
}

async function readHistory(sessionId: string): Promise<DesktopHistoryMessage[]> {
  const memory = new FileMemory({ filePath: memoryPathFor(sessionId) });
  try {
    const entries = await memory.entries();
    return entries.map((entry) => ({
      role: entry.role,
      content: entry.content,
      toolName: entry.toolName,
      toolCallId: entry.toolCallId,
    }));
  } catch {
    return [];
  }
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
