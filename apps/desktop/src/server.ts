import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { opendir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, sep } from "node:path";

import {
  createEvidenceAuditExport,
  createEvidenceAuditPreview,
  DEFAULT_EVIDENCE_RETENTION,
  EvidenceAuditLimitError,
  FileMemory,
  selectEvidenceForAudit,
  validateEvidenceAuditLimits,
  type AppliedChangeSetRecord,
  type EvidenceAuditFilters,
  type EvidenceAuditLimits,
  type EvidencePruneOptions,
  type EvidencePruneResult,
  type EvidenceSummary,
  type MemoryEntry,
  type SessionMetadata,
  type AgentTraceSnapshot,
  type ValidationRecord,
  type ValidationResult,
  type ValidationStatus,
  type ChangeSetReview,
} from "@dev-agent/agent-core";
import type { ChatUsage } from "@dev-agent/model";
import type { ExecutorMode } from "@dev-agent/executor";

import {
  ChatSession,
  normalizeSessionId,
  type ApprovalPrompt,
  type ApprovalRequester,
  type StreamEvent,
} from "./chat-session.js";
import {
  DesktopRunRegistry,
  type DesktopRunState,
  type DesktopRunSummary,
} from "./run-state.js";
import {
  createDesktopStatus,
  withDesktopManagedRuntime,
  withDesktopStatusSession,
  type DesktopStatusSnapshot,
} from "./status.js";
import { resolveDesktopManagedRuntimeStatus } from "./managed-runtime.js";
import type { DesktopManagedRuntimeStatus } from "./managed-runtime.js";
import {
  DesktopTaskWorkspaceManager,
  TaskWorkspaceError,
} from "./task-workspaces.js";
import { DesktopTaskTerminalManager, TaskTerminalError } from "./task-terminal.js";
import {
  loadWorkbenchMetadata,
  probeGitHubCapability,
  type GitHubCapabilitySnapshot,
  type WorkbenchMetadataSnapshot,
} from "./capabilities.js";

/** The slice of a chat session the server needs; tests inject fakes. */
export interface DesktopChatSession {
  readonly id?: string;
  /** Metadata-only description of the executor backend; absent on legacy fakes. */
  readonly executorMode?: ExecutorMode;
  /** Returns an allowlisted metadata-only status snapshot for the desktop panel. */
  readonly getStatus?: () => DesktopStatusSnapshot;
  /** Estimates the USD cost of a usage total with the session's current model. */
  estimateCost?(usage: ChatUsage): number | undefined;
  run(
    message: string,
    emit: (event: StreamEvent) => void,
    options?: {
      readonly signal?: AbortSignal;
      readonly requestApproval?: ApprovalRequester;
      readonly runId?: string;
      readonly mode?: "normal" | "plan";
    }
  ): Promise<void>;
  /** Applies the exact reviewed change set produced by a plan-mode run. */
  applyPlannedChangeSet?(
    review: ChangeSetReview,
    prompt: string,
    emit: (event: StreamEvent) => void,
    options?: {
      readonly signal?: AbortSignal;
      readonly runId?: string;
    }
  ): Promise<void>;
  /** Applies a guarded rollback for a change set prepared by this session. */
  rollbackChangeSet?(changeSetId: string): Promise<unknown>;
  /** Removes bounded, metadata-only evidence without touching the workspace. */
  pruneEvidence?(options?: EvidencePruneOptions): Promise<EvidencePruneResult>;
  /** Returns non-executable evidence counts and the effective retention limits. */
  evidenceSummary?(): Promise<EvidenceSummary>;
  /** Returns the bounded, metadata-only lifecycle trace for this session. */
  getTraceSnapshot?(): AgentTraceSnapshot;
  /** Reruns trusted validation for an applied change set without changing files. */
  rerunValidation?(
    changeSetId: string,
    options?: { readonly signal?: AbortSignal }
  ): Promise<ValidationResult>;
  /** Creates a bounded metadata-only conversation checkpoint. */
  createCheckpoint?(): Promise<unknown>;
  /** Lists bounded metadata-only conversation checkpoints. */
  listCheckpoints?(): Promise<readonly unknown[]>;
  /** Rewinds validated conversation history only. */
  rewindToCheckpoint?(checkpointId: string): Promise<unknown>;
  close?(): Promise<void>;
}

export interface DesktopServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly session?: DesktopChatSession;
  /** Repository/workspace root used for task-scoped Git worktrees. */
  readonly workspaceRoot?: string;
  /** Optional managed worktree directory, primarily for isolated tests. */
  readonly worktreeDirectory?: string;
  /** Optional metadata file for managed worktrees, primarily for isolated tests. */
  readonly workspaceStateFile?: string;
  /** Builds a session that is not in memory yet, optionally rooted in a task worktree. */
  readonly createSession?: (sessionId: string, workingDirectory?: string) => DesktopChatSession;
  /** Injects the managed runtime status for tests and custom hosts. */
  readonly managedRuntime?: () => Promise<DesktopManagedRuntimeStatus | undefined>;
  /** Optional metadata-only GitHub capability probe for tests/custom hosts. */
  readonly githubCapability?: () => Promise<GitHubCapabilitySnapshot>;
  /** Optional bounded workbench metadata projection for tests/custom hosts. */
  readonly workbenchMetadata?: (workingDirectory: string) => Promise<WorkbenchMetadataSnapshot>;
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
  readonly run?: DesktopRunSummary;
}

export interface DesktopHistoryMessage {
  readonly role: string;
  readonly content: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
}

type ApprovalDecision = "allow" | "deny" | "allow-always";
const maxApprovalKeysPerSession = 256;
const maxApprovalKeyBytes = 512;
type EvidenceFilterResult =
  | { readonly filters: EvidenceFilters; readonly limits?: EvidenceAuditLimits }
  | { readonly error: string };
type EvidenceCleanupOptionsResult =
  | { readonly options: EvidencePruneOptions }
  | { readonly error: string };

type JsonObjectParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

type EvidenceFilters = EvidenceAuditFilters;
type EvidenceFilterOptions = {
  readonly includeAuditLimits?: boolean;
  readonly rejectAuditLimits?: boolean;
};
type PendingPlanStatus = "ready" | "applying";
type PendingPlan = {
  readonly sessionId: string;
  readonly prompt: string;
  readonly review: ChangeSetReview;
  status: PendingPlanStatus;
};

const validationStatuses: readonly ValidationStatus[] = [
  "passed",
  "failed",
  "skipped",
  "blocked",
];

const activeSessionRequestMessage =
  "a chat, validation, cleanup, or rollback request is already running in this session";
const maxSessionIdLength = 96;
const maxChangeSetIdLength = 96;
const maxCheckpointIdLength = 128;
const maxApprovalIdLength = 96;
const maxSessionListEntries = 256;
const maxHistoryResponseBytes = 1024 * 1024;
const maxTraceResponseBytes = 256 * 1024;
const maxRunResponseBytes = 512 * 1024;
const maxCheckpointResponseBytes = 512 * 1024;
const maxExportResponseBytes = 1024 * 1024;
const maxPlanReviewBytes = 256 * 1024;
const maxPlanReviewFiles = 256;
const maxWorkspaceResponseBytes = 512 * 1024;

const maxJsonBodyBytes = 1024 * 1024;
const maxStaticFileBytes = 1024 * 1024;

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().split("%", 1)[0] ?? "";
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  const candidate = mappedIpv4 ?? normalized;
  if (isIP(candidate) === 4) return Number(candidate.split(".")[0]) === 127;
  return isIP(candidate) === 6 && candidate === "::1";
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return false;
    if (url.pathname !== "/" || url.search || url.hash) return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (hostname === "localhost") return true;
    if (isIP(hostname) === 4) return Number(hostname.split(".")[0]) === 127;
    return isIP(hostname) === 6 && hostname === "::1";
  } catch {
    return false;
  }
}

function isLoopbackTerminalRequest(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== "string" || !isLoopbackOrigin(origin)) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    return typeof req.headers.host === "string" && originHost === req.headers.host.toLowerCase();
  } catch {
    return false;
  }
}

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
    options.createSession ?? ((sessionId: string, workingDirectory?: string) =>
      new ChatSession({ sessionId, ...(workingDirectory ? { workingDirectory } : {}) }));
  const sessions = new Map<string, DesktopChatSession>([[defaultSessionId, defaultSession]]);
  const maxSessionRegistryEntries = 256;
  const inFlight = new Set<string>();
  const runs = new DesktopRunRegistry();
  // One controller per running session, so a cancel request can abort it the
  // same way a dropped connection does.
  const runControllers = new Map<string, AbortController>();
  const approvals = new Map<string, (decision: ApprovalDecision) => void>();
  const pendingPlans = new Map<string, PendingPlan>();
  const taskWorkspaces = new DesktopTaskWorkspaceManager({
    ...(options.workspaceRoot === undefined ? {} : { workspaceRoot: options.workspaceRoot }),
    ...(options.worktreeDirectory === undefined ? {} : { worktreeDirectory: options.worktreeDirectory }),
    ...(options.workspaceStateFile === undefined ? {} : { stateFile: options.workspaceStateFile }),
  });
  const terminalManager = new DesktopTaskTerminalManager();
  const sessionAllowlist = new Map<string, Set<string>>();
  const host = options.host ?? process.env.DEV_AGENT_DESKTOP_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.DEV_AGENT_DESKTOP_PORT ?? 4317);

  const normalizeSessionIdForRequest = (
    sessionId?: string
  ): string | undefined => {
    if (sessionId === undefined) {
      return defaultSessionId;
    }
    const id = normalizeSessionId(sessionId ?? defaultSessionId);
    return id.length > maxSessionIdLength ? undefined : id;
  };

  const sessionFor = (sessionId?: string): { id: string; session: DesktopChatSession } | undefined => {
    const id = normalizeSessionId(sessionId ?? defaultSessionId);
    const existing = sessions.get(id);
    if (existing) {
      return { id, session: existing };
    }
    if (sessions.size >= maxSessionRegistryEntries) {
      return undefined;
    }
    const created = createSession(id, taskWorkspaces.workingDirectoryForSession(id));
    sessions.set(id, created);
    return { id, session: created };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if ((url.pathname === "/api/terminal" || url.pathname.startsWith("/api/terminal/")) && !isLoopbackTerminalRequest(req)) {
      res.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "terminal endpoints are available only to trusted loopback requests" }));
      return;
    }

    if ((url.pathname === "/api/monitoring" || url.pathname.startsWith("/api/capabilities/")) && !isLoopbackTerminalRequest(req)) {
      res.writeHead(403, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "metadata endpoints are available only to trusted loopback requests" }));
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/") {
        const index = await resolvePublicFile("index.html");
        if (!index) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        await serveFile(res, index.filePath, index.ext);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", executorMode: defaultSession.executorMode ?? "unknown" }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/capabilities/github") {
        const probe = options.githubCapability ?? (() => probeGitHubCapability());
        try {
          const snapshot = await probe();
          const serialized = JSON.stringify(snapshot);
          if (Buffer.byteLength(serialized, "utf8") > 16 * 1024) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "capability response is too large" }));
            return;
          }
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(serialized);
        } catch {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "github capability probe failed" }));
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/capabilities/workbench") {
        const sessionId = normalizeSessionIdForRequest(url.searchParams.get("sessionId") ?? undefined);
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        const workingDirectory = taskWorkspaces.workingDirectoryForSession(sessionId) ?? process.cwd();
        const load = options.workbenchMetadata ?? loadWorkbenchMetadata;
        try {
          const snapshot = await load(workingDirectory);
          const serialized = JSON.stringify({ sessionId, ...snapshot });
          if (Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
            res.writeHead(413, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "workbench metadata is too large" }));
            return;
          }
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(serialized);
        } catch {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "workbench metadata unavailable" }));
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/monitoring") {
        const sessionIds = [...new Set([...sessions.keys(), ...inFlight])].slice(0, maxSessionListEntries);
        const snapshot = {
          readOnly: true as const,
          canApprove: false as const,
          canMutate: false as const,
          pendingApprovalCount: approvals.size,
          activeSessionCount: inFlight.size,
          sessions: sessionIds.map((sessionId) => ({
            sessionId,
            active: inFlight.has(sessionId),
            run: runs.summary(sessionId),
          })),
        };
        const serialized = JSON.stringify(snapshot);
        if (Buffer.byteLength(serialized, "utf8") > maxRunResponseBytes) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "monitoring response is too large" }));
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(serialized);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        const requestedSessionId = url.searchParams.get("sessionId");
        const sessionId = normalizeSessionIdForRequest(requestedSessionId ?? undefined);
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        let session = sessions.get(sessionId);
        const taskWorkingDirectory = taskWorkspaces.workingDirectoryForSession(sessionId);
        if (!session && (existsSync(memoryPathFor(sessionId)) || taskWorkingDirectory !== undefined)) {
          // The session picker also lists persisted sessions that have not been
          // materialized in this process yet. Task workspaces are also
          // persisted session roots even before their first chat is saved.
          session = sessionFor(sessionId)?.session;
        }
        if (!session) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }

        const baseStatus =
          session.getStatus?.() ??
          createDesktopStatus({
            sessionId,
            executorMode: session.executorMode,
          });
        const status = withDesktopStatusSession(baseStatus, sessionId, inFlight.has(sessionId));
        const managedRuntime =
          options.managedRuntime === undefined
            ? await resolveDesktopManagedRuntimeStatus()
            : await options.managedRuntime();
        const payload =
          managedRuntime === undefined ? status : withDesktopManagedRuntime(status, managedRuntime);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/sessions") {
        const summaries = await listSessions([...sessions.keys()]);
        const withCost = summaries.map((summary) => {
          const run = runs.summary(summary.sessionId);
          const withRun = { ...summary, run };
          if (!summary.usage) {
            return withRun;
          }
          const session = sessions.get(summary.sessionId) ?? defaultSession;
          const cost = session.estimateCost?.(summary.usage);
          return cost === undefined ? withRun : { ...withRun, cost };
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

      if (req.method === "GET" && url.pathname === "/api/terminal") {
        const sessionId = normalizeSessionIdForRequest(url.searchParams.get("sessionId") ?? undefined);
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        const session = sessionFor(sessionId);
        if (!session) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "session limit reached", code: "terminal-session-limit" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ sessionId, terminals: terminalManager.list(sessionId) }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/terminal") {
        const body = await readJsonBody(req, res);
        if (body === undefined) return;
        const parsed = parseJsonObjectBody<Record<string, unknown>>(body);
        if (!parsed.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsed.error }));
          return;
        }
        const sessionId = normalizeSessionIdForRequest(typeof parsed.value.sessionId === "string" ? parsed.value.sessionId : undefined);
        const command = typeof parsed.value.command === "string" ? parsed.value.command : "";
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid session id" }));
          return;
        }
        if (!sessionFor(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "session limit reached", code: "terminal-session-limit" }));
          return;
        }
        try {
          const workingDirectory = await taskWorkspaces.terminalWorkingDirectory(sessionId);
          const terminal = terminalManager.start(sessionId, workingDirectory, command);
          res.writeHead(201, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify(terminal));
        } catch (error) {
          sendTerminalError(res, error);
        }
        return;
      }

      if (url.pathname.startsWith("/api/terminal/")) {
        const segments = url.pathname.slice("/api/terminal/".length).split("/");
        if (segments.length < 2 || segments.length > 3) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        let sessionId: string;
        let terminalId: string;
        try {
          sessionId = normalizeSessionId(decodeURIComponent(segments[0] ?? ""));
          terminalId = decodeURIComponent(segments[1] ?? "");
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid terminal path" }));
          return;
        }
        if (sessionId.length > maxSessionIdLength || !/^[0-9a-f-]{36}$/i.test(terminalId)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid terminal path" }));
          return;
        }
        const action = segments[2];
        if (action !== undefined && action !== "input") {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        try {
          if (req.method === "GET" && action === undefined) {
            const cursor = url.searchParams.get("after");
            const after = cursor === null || cursor === "" ? 0 : Number(cursor);
            const terminal = terminalManager.get(sessionId, terminalId, after);
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify(terminal));
            return;
          }
          if (req.method === "POST" && action === "input") {
            const body = await readJsonBody(req, res);
            if (body === undefined) return;
            const parsed = parseJsonObjectBody<Record<string, unknown>>(body);
            if (!parsed.ok || typeof parsed.value.text !== "string") {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: parsed.ok ? "terminal input must be a string" : parsed.error }));
              return;
            }
            const terminal = terminalManager.writeInput(sessionId, terminalId, parsed.value.text);
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify(terminal));
            return;
          }
          if (req.method === "DELETE" && action === undefined) {
            const terminal = terminalManager.stop(sessionId, terminalId);
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify(terminal));
            return;
          }
          res.writeHead(405, { "content-type": "application/json", "allow": "GET, POST, DELETE" });
          res.end(JSON.stringify({ error: "method not allowed" }));
        } catch (error) {
          sendTerminalError(res, error);
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/workspaces") {
        const listing = await taskWorkspaces.list(inFlight);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(listing));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workspaces") {
        const body = await readJsonBody(req, res);
        if (body === undefined) return;
        const parsed = parseJsonObjectBody<Record<string, unknown>>(body);
        if (!parsed.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsed.error }));
          return;
        }
        if (sessions.size >= maxSessionRegistryEntries) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "session limit reached", code: "workspace-limit" }));
          return;
        }
        try {
          const workspace = await taskWorkspaces.create();
          const created = sessionFor(workspace.sessionId);
          if (!created) {
            await taskWorkspaces.cleanup(workspace.sessionId, false).catch(() => undefined);
            res.writeHead(409, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "session limit reached", code: "workspace-limit" }));
            return;
          }
          res.writeHead(201, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify(workspace));
        } catch (error) {
          sendTaskWorkspaceError(res, error);
        }
        return;
      }

      if (
        req.method === "GET" && url.pathname.startsWith("/api/workspaces/") && url.pathname.endsWith("/diff")
      ) {
        const rawId = url.pathname.slice("/api/workspaces/".length, -"/diff".length);
        let decodedId: string;
        try { decodedId = decodeURIComponent(rawId); } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid session id" }));
          return;
        }
        const sessionId = normalizeSessionIdForRequest(decodedId);
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        try {
          const diff = await taskWorkspaces.diff(sessionId, url.searchParams.has("path") ? url.searchParams.get("path") ?? "" : undefined);
          const serialized = JSON.stringify(diff);
          if (Buffer.byteLength(serialized, "utf8") > maxWorkspaceResponseBytes) {
            res.writeHead(413, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "workspace diff is too large" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(serialized);
        } catch (error) {
          sendTaskWorkspaceError(res, error);
        }
        return;
      }

      if (
        req.method === "POST" && url.pathname.startsWith("/api/workspaces/") && url.pathname.endsWith("/merge")
      ) {
        const rawId = url.pathname.slice("/api/workspaces/".length, -"/merge".length);
        let decodedId: string;
        try { decodedId = decodeURIComponent(rawId); } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid session id" }));
          return;
        }
        const sessionId = normalizeSessionIdForRequest(decodedId);
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        try {
          const result = await taskWorkspaces.merge(sessionId, inFlight.has(sessionId) || terminalManager.hasRunning(sessionId));
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (error) {
          sendTaskWorkspaceError(res, error);
        }
        return;
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/api/workspaces/")) {
        const rawId = url.pathname.slice("/api/workspaces/".length);
        if (rawId.includes("/")) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        let decodedId: string;
        try { decodedId = decodeURIComponent(rawId); } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid session id" }));
          return;
        }
        const sessionId = normalizeSessionIdForRequest(decodedId);
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        try {
          const result = await taskWorkspaces.cleanup(sessionId, inFlight.has(sessionId) || terminalManager.hasRunning(sessionId));
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify(result));
        } catch (error) {
          sendTaskWorkspaceError(res, error);
        }
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/run")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/run".length);
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (!sessions.has(sessionId) && !runs.get(sessionId) && !existsSync(memoryPathFor(sessionId))) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        const after = parseRunCursor(url.searchParams.get("after"));
        if ("error" in after) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: after.error }));
          return;
        }
        const snapshot = runs.snapshot(sessionId, after.value);
        const serialized = JSON.stringify(snapshot);
        if (Buffer.byteLength(serialized, "utf8") > maxRunResponseBytes) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "run response exceeds the 512 KiB limit" }));
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(serialized);
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/trace")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/trace".length);
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        const session = sessions.get(sessionId);
        if (!session) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        if (!session.getTraceSnapshot) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "trace unavailable" }));
          return;
        }
        const trace = session.getTraceSnapshot();
        const serialized = JSON.stringify(trace);
        if (Buffer.byteLength(serialized, "utf8") > maxTraceResponseBytes) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "trace response exceeds the 256 KiB limit" }));
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(serialized);
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/messages")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/messages".length);
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        const filterResult = parseEvidenceFilters(url);
        if ("error" in filterResult) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: filterResult.error }));
          return;
        }
        const history = await readHistory(sessionId, filterResult.filters);
        const serializedHistory = JSON.stringify({ sessionId, ...history });
        if (Buffer.byteLength(serializedHistory, "utf8") > maxHistoryResponseBytes) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "history response exceeds the 1 MiB limit" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(serializedHistory);
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/checkpoints")
      ) {
        const rawId = url.pathname.slice(
          "/api/sessions/".length,
          -"/checkpoints".length
        );
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        const existingSession = sessions.get(sessionId);
        const memoryFile = memoryPathFor(sessionId);
        if (!existingSession && !existsSync(memoryFile)) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
          return;
        }
        try {
          const checkpoints = existingSession?.listCheckpoints
            ? await existingSession.listCheckpoints()
            : await new FileMemory({ filePath: memoryFile }).checkpoints?.() ?? [];
          const payload = { sessionId, checkpoints };
          const serialized = JSON.stringify(payload);
          if (Buffer.byteLength(serialized, "utf8") > maxCheckpointResponseBytes) {
            res.writeHead(413, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "checkpoint response is too large" }));
            return;
          }
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(serialized);
        } catch {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "checkpoint list failed" }));
        }
        return;
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/checkpoint")
      ) {
        const rawId = url.pathname.slice(
          "/api/sessions/".length,
          -"/checkpoint".length
        );
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          req.resume();
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
          return;
        }
        if (!sessions.has(sessionId) && !existsSync(memoryPathFor(sessionId))) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        const resolved = sessionFor(sessionId);
        if (!resolved || !resolved.session.createCheckpoint) {
          res.writeHead(501, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "checkpoint creation is unavailable" }));
          return;
        }
        inFlight.add(sessionId);
        try {
          const checkpoint = await resolved.session.createCheckpoint();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sessionId, checkpoint }));
        } catch {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "checkpoint creation failed" }));
        } finally {
          inFlight.delete(sessionId);
        }
        return;
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/checkpoint/rewind")
      ) {
        const rawId = url.pathname.slice(
          "/api/sessions/".length,
          -"/checkpoint/rewind".length
        );
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          req.resume();
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
          return;
        }
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<{ checkpointId?: unknown }>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;
        const checkpointId =
          typeof parsed.checkpointId === "string" ? parsed.checkpointId.trim() : "";
        if (!checkpointId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "checkpointId is required" }));
          return;
        }
        if (checkpointId.length > maxCheckpointIdLength) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "checkpointId is too long" }));
          return;
        }
        if (!sessions.has(sessionId) && !existsSync(memoryPathFor(sessionId))) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        const resolved = sessionFor(sessionId);
        if (!resolved || !resolved.session.rewindToCheckpoint) {
          res.writeHead(501, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "conversation rewind is unavailable" }));
          return;
        }
        inFlight.add(sessionId);
        try {
          const result = await resolved.session.rewindToCheckpoint(checkpointId);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sessionId, result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(checkpointRewindErrorStatus(message), {
            "content-type": "application/json",
          });
          res.end(JSON.stringify({ error: "conversation rewind failed" }));
        } finally {
          inFlight.delete(sessionId);
        }
        return;
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/api/sessions/")) {
        const rawId = url.pathname.slice("/api/sessions/".length);
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          req.resume();
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
          return;
        }
        sessions.delete(sessionId);

        inFlight.add(sessionId);
        try {
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
        } finally {
          inFlight.delete(sessionId);
        }
        return;
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/rename")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/rename".length);
        const from = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!from) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }

        if (inFlight.has(from)) {
          req.resume();
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
          return;
        }
        if (taskWorkspaces.isTaskSession(from)) {
          req.resume();
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "task session IDs are tied to their Git branch and worktree" }));
          return;
        }

        inFlight.add(from);
        try {
          const body = await readJsonBody(req, res);
          if (body === undefined) {
            return;
          }
          const parsedResult = parseJsonObjectBody<{ sessionId?: unknown }>(body);
          if (!parsedResult.ok) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: parsedResult.error }));
            return;
          }
          const parsed = parsedResult.value;

          const normalizedTarget =
            typeof parsed.sessionId === "string"
              ? normalizeSessionIdForRequest(parsed.sessionId)
              : "";
          if (normalizedTarget === undefined) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "sessionId is too long" }));
            return;
          }
          const to = normalizedTarget;
          if (!to) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "sessionId is required" }));
            return;
          }

          if (from !== to && inFlight.has(to)) {
            req.resume();
            res.writeHead(409, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: activeSessionRequestMessage }));
            return;
          }

          inFlight.add(to);
          try {
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
          } finally {
            inFlight.delete(from);
            inFlight.delete(to);
          }
          return;
        } finally {
          inFlight.delete(from);
        }
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/evidence/preview")
      ) {
        const rawId = url.pathname.slice(
          "/api/sessions/".length,
          -"/evidence/preview".length
        );
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        const filePath = memoryPathFor(sessionId);
        if (!existsSync(filePath)) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }

        const filterResult = parseEvidenceFilters(url, { rejectAuditLimits: true });
        if ("error" in filterResult) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: filterResult.error }));
          return;
        }

        const memory = new FileMemory({ filePath });
        try {
          const validations = await memory.validations();
          const changeSets = await memory.changeSets();
          const evidenceSummary = await memory.evidenceSummary();
          const evidence = selectEvidenceForAudit(
            validations,
            changeSets,
            filterResult.filters
          );
          const preview = createEvidenceAuditPreview(
            sessionId,
            evidence.validations,
            evidence.changeSets,
            evidenceSummary
          );
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify(preview));
        } catch {
          // Keep persisted evidence errors and paths out of this metadata-only surface.
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "evidence preview failed" }));
        }
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/evidence")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/evidence".length);
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        const filePath = memoryPathFor(sessionId);
        if (!existsSync(filePath)) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }

        const filterResult = parseEvidenceFilters(url, { includeAuditLimits: true });
        if ("error" in filterResult) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: filterResult.error }));
          return;
        }

        const memory = new FileMemory({ filePath });
        try {
          const validations = await memory.validations();
          const changeSets = await memory.changeSets();
          const evidenceSummary = await memory.evidenceSummary();
          const evidence = selectEvidenceForAudit(
            validations,
            changeSets,
            filterResult.filters
          );
          const audit = createEvidenceAuditExport(
            sessionId,
            evidence.validations,
            evidence.changeSets,
            evidenceSummary,
            filterResult.limits === undefined
              ? {}
              : { limits: filterResult.limits }
          );
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify(audit));
        } catch (error) {
          if (!(error instanceof EvidenceAuditLimitError)) {
            throw error;
          }
          res.writeHead(413, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: "evidence audit limit exceeded",
              code: error.code,
              kind: error.kind,
              limit: error.limit,
              actual: error.actual,
            })
          );
        }
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname.startsWith("/api/sessions/") &&
        url.pathname.endsWith("/export")
      ) {
        const rawId = url.pathname.slice("/api/sessions/".length, -"/export".length);
        const sessionId = normalizeSessionIdForRequest(decodeURIComponent(rawId));
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
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
        const transcript = renderTranscript(
          sessionId,
          entries,
          metadata,
          evidence.validations,
          evidence.changeSets,
          evidenceSummary
        );
        if (Buffer.byteLength(transcript, "utf8") > maxExportResponseBytes) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "export response exceeds the 1 MiB limit" }));
          return;
        }
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${sessionId}.md"`,
        });
        res.end(transcript);
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/public/")) {
        const relative = url.pathname.slice("/public/".length);
        const filePath = join(publicDir, relative);
        if (!filePath.startsWith(publicDir)) {
          res.writeHead(400).end("invalid path");
          return;
        }
        const resolved = await resolvePublicFile(relative);
        if (!resolved) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }
        await serveFile(res, resolved.filePath, resolved.ext);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<{
          message?: unknown;
          sessionId?: unknown;
          mode?: unknown;
        }>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;

        const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
        if (!message) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "message is required" }));
          return;
        }
        if (
          parsed.mode !== undefined
          && parsed.mode !== "normal"
          && parsed.mode !== "plan"
        ) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "mode must be normal or plan" }));
          return;
        }
        const mode: "normal" | "plan" = parsed.mode === "plan" ? "plan" : "normal";

        const sessionId = normalizeSessionIdForRequest(
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
        );
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }

        if (taskWorkspaces.isCleanedSession(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "This task worktree was cleaned up; create a new isolated task to continue.", code: "workspace-cleaned" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          // Check before creating an unknown session so a rename target cannot
          // be registered while its memory file is still being moved.
          req.resume();
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: activeSessionRequestMessage })
          );
          return;
        }
        const resolved = sessionFor(sessionId);
        if (!resolved) {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "session registry limit reached" }));
          return;
        }
        const { id, session } = resolved;
        if (inFlight.has(id)) {
          // A second run would interleave two histories in the same session.
          req.resume();
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: activeSessionRequestMessage })
          );
          return;
        }

        inFlight.add(id);
        const controller = new AbortController();
        runControllers.set(id, controller);
        const runId = randomUUID();
        const run = runs.start(id, runId);
        try {
          await streamChat(
            res,
            session,
            message,
            mode,
            approvals,
            sessionAllowlist,
            pendingPlans,
            id,
            controller,
            run,
          );
        } finally {
          inFlight.delete(id);
          if (runControllers.get(id) === controller) {
            runControllers.delete(id);
          }
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/plans/apply") {
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<{
          sessionId?: unknown;
          changeSetId?: unknown;
        }>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;
        const changeSetId =
          typeof parsed.changeSetId === "string" ? parsed.changeSetId.trim() : "";
        if (!changeSetId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is required" }));
          return;
        }
        if (changeSetId.length > maxChangeSetIdLength) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is too long" }));
          return;
        }

        const sessionId = normalizeSessionIdForRequest(
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
        );
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
          return;
        }

        const key = pendingPlanKey(sessionId, changeSetId);
        const pending = pendingPlans.get(key);
        if (!pending) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "pending plan not found" }));
          return;
        }
        if (pending.status === "applying") {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "plan application is already running" }));
          return;
        }

        const session = sessions.get(sessionId);
        if (!session) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unknown session" }));
          return;
        }
        if (!session.applyPlannedChangeSet) {
          res.writeHead(501, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "plan application is unavailable" }));
          return;
        }

        pending.status = "applying";
        inFlight.add(sessionId);
        const controller = new AbortController();
        runControllers.set(sessionId, controller);
        const run = runs.start(sessionId, randomUUID());
        try {
          await streamPlanApply(
            res,
            session,
            pending,
            controller,
            run,
          );
        } finally {
          inFlight.delete(sessionId);
          if (runControllers.get(sessionId) === controller) {
            runControllers.delete(sessionId);
          }
          if (run.summary().status === "done") {
            pendingPlans.delete(key);
          } else if (pendingPlans.get(key) === pending) {
            pending.status = "ready";
          }
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/plans/reject") {
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<{
          sessionId?: unknown;
          changeSetId?: unknown;
        }>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;
        const changeSetId =
          typeof parsed.changeSetId === "string" ? parsed.changeSetId.trim() : "";
        if (!changeSetId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is required" }));
          return;
        }
        if (changeSetId.length > maxChangeSetIdLength) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is too long" }));
          return;
        }
        const sessionId = normalizeSessionIdForRequest(
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
        );
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
          return;
        }
        const key = pendingPlanKey(sessionId, changeSetId);
        const pending = pendingPlans.get(key);
        if (!pending) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "pending plan not found" }));
          return;
        }
        if (pending.status === "applying") {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "plan application is already running" }));
          return;
        }
        pendingPlans.delete(key);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, changeSetId, rejected: true }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat/cancel") {
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<{ sessionId?: unknown }>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;

        const sessionId = normalizeSessionIdForRequest(
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
        );
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
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
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<{
          sessionId?: unknown;
          changeSetId?: unknown;
        }>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;

        const changeSetId =
          typeof parsed.changeSetId === "string" ? parsed.changeSetId.trim() : "";
        if (!changeSetId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is required" }));
          return;
        }
        if (changeSetId.length > maxChangeSetIdLength) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is too long" }));
          return;
        }

        const sessionId = normalizeSessionIdForRequest(
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
        );
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: activeSessionRequestMessage })
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
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<Record<string, unknown>>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;
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

        const sessionId = normalizeSessionIdForRequest(
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
        );
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
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
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<{
          sessionId?: unknown;
          changeSetId?: unknown;
        }>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;

        const changeSetId =
          typeof parsed.changeSetId === "string" ? parsed.changeSetId.trim() : "";
        if (!changeSetId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is required" }));
          return;
        }
        if (changeSetId.length > maxChangeSetIdLength) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "changeSetId is too long" }));
          return;
        }

        const sessionId = normalizeSessionIdForRequest(
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
        );
        if (!sessionId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is too long" }));
          return;
        }
        if (inFlight.has(sessionId)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: activeSessionRequestMessage }));
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

        inFlight.add(sessionId);
        try {
          const result = await session.rollbackChangeSet(changeSetId);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const status = rollbackErrorStatus(message);
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        } finally {
          inFlight.delete(sessionId);
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/approval") {
        const body = await readJsonBody(req, res);
        if (body === undefined) {
          return;
        }
        const parsedResult = parseJsonObjectBody<{
          id?: unknown;
          decision?: unknown;
        }>(body);
        if (!parsedResult.ok) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: parsedResult.error }));
          return;
        }
        const parsed = parsedResult.value;

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
        if (id.length > maxApprovalIdLength) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "approval id is too long" }));
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
      console.error("[desktop] server error: request failed");
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "request failed" }));
    }
  });

  server.on("error", (error) => {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return;
    console.error("[desktop] server error: request failed");
  });

  server.once("close", () => {
    terminalManager.closeAll();
    void Promise.all(
      [...sessions.values()].map((session) => session.close?.())
    ).catch(() => undefined);
  });

  return server;
}

async function serveFile(res: ServerResponse, filePath: string, ext: string): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (!fileStat.isFile()) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (fileStat.size > maxStaticFileBytes) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "static response exceeds the 1 MiB limit" }));
    return;
  }
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch {
    // Missing files, directories, and unreadable paths are client errors.
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (content.byteLength > maxStaticFileBytes) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "static response exceeds the 1 MiB limit" }));
    return;
  }
  res.writeHead(200, { "content-type": mimeTypes[ext] ?? "application/octet-stream" });
  res.end(content);
}

async function streamChat(
  res: ServerResponse,
  session: DesktopChatSession,
  message: string,
  mode: "normal" | "plan",
  approvals: Map<string, (decision: ApprovalDecision) => void>,
  sessionAllowlist: Map<string, Set<string>>,
  pendingPlans: Map<string, PendingPlan>,
  sessionId: string,
  controller: AbortController,
  run: DesktopRunState,
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
    const prepared = prepareStreamEvent(event, {
      mode,
      message,
      pendingPlans,
      sessionId,
    });
    if (!prepared) {
      return;
    }
    run.append(prepared);
    if (capped || res.writableEnded || res.destroyed) {
      return;
    }
    const frame = `event: ${prepared.type}\ndata: ${JSON.stringify(prepared.data)}\n\n`;
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
      runId: run.runId,
      mode,
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
            if (
              set.size < maxApprovalKeysPerSession &&
              Buffer.byteLength(prompt.key, "utf8") <= maxApprovalKeyBytes
            ) {
              set.add(prompt.key);
              sessionAllowlist.set(sessionId, set);
            }
          }
          return "allow";
        });
      },
    });
    if (run.active) {
      run.finish(controller.signal.aborted ? "aborted" : "done");
    }
  } catch (error) {
    emit({
      type: "error",
      data: { message: error instanceof Error ? error.message : String(error) },
    });
    if (run.active) {
      run.finish(controller.signal.aborted ? "aborted" : "failed");
    }
  } finally {
    res.off("close", onClose);
  }

  if (!res.writableEnded) {
    res.end();
  }
}

async function streamPlanApply(
  res: ServerResponse,
  session: DesktopChatSession,
  pending: PendingPlan,
  controller: AbortController,
  run: DesktopRunState,
): Promise<void> {
  const onClose = (): void => {
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

  const maxStreamBytes = sseMaxBytes();
  let streamBytes = 0;
  let capped = false;
  const emit = (event: StreamEvent) => {
    if (capped || res.writableEnded || res.destroyed) {
      return;
    }
    run.append(event);
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    streamBytes += Buffer.byteLength(frame, "utf8");
    if (streamBytes > maxStreamBytes) {
      capped = true;
      res.write(`event: error\ndata: ${JSON.stringify({
        message: `stream exceeded ${maxStreamBytes} bytes and was closed`,
      })}\n\n`);
      res.end();
      controller.abort();
      return;
    }
    res.write(frame);
  };

  try {
    await session.applyPlannedChangeSet?.(
      pending.review,
      pending.prompt,
      emit,
      { signal: controller.signal, runId: run.runId },
    );
    if (run.active) {
      run.finish(controller.signal.aborted ? "aborted" : "done");
    }
  } catch (error) {
    emit({
      type: "error",
      data: { message: error instanceof Error ? error.message : String(error) },
    });
    if (run.active) {
      run.finish(controller.signal.aborted ? "aborted" : "failed");
    }
  } finally {
    res.off("close", onClose);
  }

  if (!res.writableEnded) {
    res.end();
  }
}

function prepareStreamEvent(
  event: StreamEvent,
  options: {
    readonly mode: "normal" | "plan";
    readonly message: string;
    readonly pendingPlans: Map<string, PendingPlan>;
    readonly sessionId: string;
  },
): StreamEvent | undefined {
  if (event.type !== "plan-review") {
    return event;
  }
  if (options.mode !== "plan") {
    return undefined;
  }
  const review = normalizePlanReview(event.data.review);
  if (!review) {
    return undefined;
  }
  options.pendingPlans.set(pendingPlanKey(options.sessionId, review.changeSetId), {
    sessionId: options.sessionId,
    prompt: options.message,
    review,
    status: "ready",
  });
  return { type: "plan-review", data: { review } };
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

function pendingPlanKey(sessionId: string, changeSetId: string): string {
  return `${sessionId}\u0000${changeSetId}`;
}

function normalizePlanReview(value: unknown): ChangeSetReview | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const changeSetId =
    typeof candidate.changeSetId === "string" ? candidate.changeSetId.trim() : "";
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
  const additions = candidate.additions;
  const deletions = candidate.deletions;
  const rawFiles = candidate.files;
  if (
    !changeSetId
    || changeSetId.length > maxChangeSetIdLength
    || !createdAt
    || createdAt.length > 96
    || !Number.isSafeInteger(additions)
    || !Number.isSafeInteger(deletions)
    || (additions as number) < 0
    || (deletions as number) < 0
    || !Array.isArray(rawFiles)
    || rawFiles.length > maxPlanReviewFiles
  ) {
    return undefined;
  }

  const files: ChangeSetReview["files"][number][] = [];
  for (const rawFile of rawFiles) {
    if (!rawFile || typeof rawFile !== "object") return undefined;
    const file = rawFile as Record<string, unknown>;
    const path = typeof file.path === "string" ? file.path : "";
    const kind = file.kind === "directory" ? "directory" : file.kind === "file" ? "file" : undefined;
    const afterHash = typeof file.afterHash === "string" ? file.afterHash : "";
    const diff = typeof file.diff === "string" ? file.diff : "";
    const fileAdditions = file.additions;
    const fileDeletions = file.deletions;
    if (
      !path
      || path.length > 4096
      || !kind
      || !afterHash
      || afterHash.length > 256
      || diff.length > maxPlanReviewBytes
      || !Number.isSafeInteger(fileAdditions)
      || !Number.isSafeInteger(fileDeletions)
      || (fileAdditions as number) < 0
      || (fileDeletions as number) < 0
      || typeof file.beforeExists !== "boolean"
      || typeof file.afterExists !== "boolean"
    ) {
      return undefined;
    }
    files.push({
      path,
      kind,
      ...(typeof file.beforeHash === "string" ? { beforeHash: file.beforeHash.slice(0, 256) } : {}),
      afterHash,
      diff,
      additions: fileAdditions as number,
      deletions: fileDeletions as number,
      beforeExists: file.beforeExists,
      afterExists: file.afterExists,
    });
  }

  const review: ChangeSetReview = {
    changeSetId,
    files,
    additions: additions as number,
    deletions: deletions as number,
    createdAt,
  };
  return Buffer.byteLength(JSON.stringify(review), "utf8") <= maxPlanReviewBytes
    ? review
    : undefined;
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

function checkpointRewindErrorStatus(message: string): 404 | 409 | 500 {
  if (/unknown checkpoint/i.test(message)) {
    return 404;
  }
  if (
    /belongs to another session|anchor does not match|ahead of current memory/i
      .test(message)
  ) {
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

function sendTaskWorkspaceError(res: ServerResponse, error: unknown): void {
  const statusCode = error instanceof TaskWorkspaceError ? error.statusCode : 500;
  const message = error instanceof TaskWorkspaceError ? error.message : "Task workspace request failed.";
  const code = error instanceof TaskWorkspaceError ? error.code : "workspace-request-failed";
  res.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: message, code }));
}

function sendTerminalError(res: ServerResponse, error: unknown): void {
  if (error instanceof TaskWorkspaceError) {
    sendTaskWorkspaceError(res, error);
    return;
  }
  const statusCode = error instanceof TaskTerminalError ? error.statusCode : 500;
  const message = error instanceof TaskTerminalError ? error.message : "Terminal request failed.";
  const code = error instanceof TaskTerminalError ? error.code : "terminal-request-failed";
  res.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: message, code }));
}

function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflowed = false;
    req.on("data", (chunk: Buffer) => {
      if (overflowed) {
        return;
      }
      bytes += chunk.length;
      if (bytes > maxJsonBodyBytes) {
        overflowed = true;
        res.writeHead(413, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ error: "request body exceeds the 1 MiB limit" })
        );
        req.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", (error) => {
      if (!overflowed) {
        reject(error);
      }
    });
    req.on("end", () => {
      if (!overflowed) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
  });
}

function parseJsonObjectBody<T>(body: string): JsonObjectParseResult<T> {
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, error: "request body must be a JSON object" };
    }
    return { ok: true, value: value as T };
  } catch {
    return { ok: false, error: "request body must be valid JSON" };
  }
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

type ResolvedPublicFile = {
  readonly filePath: string;
  readonly ext: string;
};

async function resolvePublicFile(
  relative: string
): Promise<ResolvedPublicFile | undefined> {
  const filePath = join(publicDir, relative);
  try {
    const [realFilePath, realPublicDir] = await Promise.all([
      realpath(filePath),
      realpath(publicDir),
    ]);
    if (
      realFilePath !== realPublicDir &&
      !realFilePath.startsWith(realPublicDir + sep)
    ) {
      return undefined;
    }
    return { filePath, ext: extname(filePath) };
  } catch {
    return undefined;
  }
}

export function memoryPathFor(sessionId: string): string {
  return process.env.DEV_AGENT_MEMORY_FILE ?? join(sessionsDir(), `${sessionId}.json`);
}

/** Merges session files on disk with sessions this process already created. */
export async function listSessions(
  knownSessionIds: readonly string[] = []
): Promise<DesktopSessionSummary[]> {
  const summaries = new Map<string, DesktopSessionSummary>();
  for (const sessionId of knownSessionIds.slice(0, maxSessionListEntries)) {
    summaries.set(sessionId, {
      sessionId,
      entryCount: 0,
      evidenceSummary: emptyEvidenceSummary(),
    });
  }

  const candidateLimit = Math.max(0, maxSessionListEntries - summaries.size);
  const files: string[] = [];
  if (candidateLimit > 0) {
    try {
      const directory = await opendir(sessionsDir());
      for await (const entry of directory) {
        if (!entry.name.endsWith(".json")) {
          continue;
        }
        const insertionIndex = files.findIndex((candidate) => candidate > entry.name);
        if (insertionIndex < 0) {
          if (files.length < candidateLimit) {
            files.push(entry.name);
          }
          continue;
        }
        files.splice(insertionIndex, 0, entry.name);
        if (files.length > candidateLimit) {
          files.pop();
        }
      }
    } catch {
      // Missing or changing session directories are treated as empty.
    }
  }

  for (const file of files) {
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

function parseEvidenceFilters(
  url: URL,
  options: EvidenceFilterOptions = {}
): EvidenceFilterResult {
  const changeSetId = nonEmptyQueryValue(url.searchParams.get("changeSetId"));
  if (changeSetId !== undefined && changeSetId.length > maxChangeSetIdLength) {
    return { error: "changeSetId is too long" };
  }
  const validationId = nonEmptyQueryValue(url.searchParams.get("validationId"));
  if (validationId !== undefined && validationId.length > maxChangeSetIdLength) {
    return { error: "validationId is too long" };
  }
  const rawStatus = nonEmptyQueryValue(url.searchParams.get("status"));
  if (
    rawStatus !== undefined &&
    !validationStatuses.includes(rawStatus as ValidationStatus)
  ) {
    return {
      error: `status must be one of: ${validationStatuses.join(", ")}`,
    };
  }
  if (options.rejectAuditLimits && hasEvidenceAuditLimitQuery(url)) {
    return { error: "audit limit options require /evidence" };
  }
  const limitsResult = options.includeAuditLimits
    ? parseEvidenceAuditLimits(url)
    : {};
  if ("error" in limitsResult) {
    return limitsResult;
  }
  return {
    filters: {
      ...(changeSetId === undefined ? {} : { changeSetId }),
      ...(validationId === undefined ? {} : { validationId }),
      ...(rawStatus === undefined ? {} : { status: rawStatus as ValidationStatus }),
    },
    ...(limitsResult.limits === undefined ? {} : { limits: limitsResult.limits }),
  };
}

function hasEvidenceAuditLimitQuery(url: URL): boolean {
  return ["maxValidations", "maxChangeSets", "maxFiles", "maxBytes"].some((query) =>
    url.searchParams.has(query)
  );
}

function parseEvidenceAuditLimits(
  url: URL
): { readonly limits?: EvidenceAuditLimits } | { readonly error: string } {
  const specs: readonly { readonly query: string; readonly key: keyof EvidenceAuditLimits }[] = [
    { query: "maxValidations", key: "maxValidations" },
    { query: "maxChangeSets", key: "maxChangeSets" },
    { query: "maxFiles", key: "maxFiles" },
    { query: "maxBytes", key: "maxBytes" },
  ];
  const values: Partial<Record<keyof EvidenceAuditLimits, number>> = {};
  for (const { query, key } of specs) {
    const raw = url.searchParams.get(query);
    if (raw === null) {
      continue;
    }
    const normalized = raw.trim();
    const value = Number(normalized);
    if (!normalized || !Number.isSafeInteger(value) || value <= 0) {
      return { error: `${query} must be a positive integer` };
    }
    values[key] = value;
  }

  const limits: EvidenceAuditLimits = {
    ...(values.maxValidations === undefined ? {} : { maxValidations: values.maxValidations }),
    ...(values.maxChangeSets === undefined ? {} : { maxChangeSets: values.maxChangeSets }),
    ...(values.maxFiles === undefined ? {} : { maxFiles: values.maxFiles }),
    ...(values.maxBytes === undefined ? {} : { maxBytes: values.maxBytes }),
  };
  try {
    validateEvidenceAuditLimits(limits);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return Object.keys(limits).length === 0 ? {} : { limits };
}

function nonEmptyQueryValue(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseRunCursor(
  value: string | null,
): { readonly value: number } | { readonly error: string } {
  if (value === null || value.trim() === "") {
    return { value: 0 };
  }
  const normalized = value.trim();
  const cursor = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(cursor) || cursor < 0) {
    return { error: "after must be a non-negative integer" };
  }
  return { value: cursor };
}

function filterEvidence(
  validations: readonly ValidationRecord[],
  changeSets: readonly AppliedChangeSetRecord[],
  filters: EvidenceFilters
): { validations: ValidationRecord[]; changeSets: AppliedChangeSetRecord[] } {
  return selectEvidenceForAudit(validations, changeSets, filters);
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
