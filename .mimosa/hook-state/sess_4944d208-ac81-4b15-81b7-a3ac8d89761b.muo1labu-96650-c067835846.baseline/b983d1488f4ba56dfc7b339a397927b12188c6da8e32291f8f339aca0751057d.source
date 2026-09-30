import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";

import {
  AgentEvent,
  DefaultExecutionEventBusManager,
  DefaultRequestHandler,
  JsonRpcTransportHandler,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
  type ServerCallContext,
  type TaskStore,
  defaultServerCallContextBuilder,
} from "@a2a-js/sdk/server";
import {
  Role,
  TaskState,
  formatSSEErrorEvent,
  formatSSEEvent,
  type AgentCard,
  type AgentSkill,
  type Artifact,
  type ListTasksRequest,
  type ListTasksResponse,
  type Message,
  type Part,
  type Task,
  type TaskArtifactUpdateEvent,
  type TaskStatus,
  type TaskStatusUpdateEvent,
} from "@a2a-js/sdk";

export const A2A_REQUEST_SIGNAL = "dev-agent.a2a.request-signal";

const DEFAULT_MAX_TASKS = 256;
const DEFAULT_MAX_CONTEXTS = 128;
const DEFAULT_MAX_TEXT_CHARS = 64 * 1024;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_SSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_RPC_PATH = "/";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4320;

type A2aJsonRpcResponse = {
  readonly jsonrpc: string;
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: unknown;
};

export type A2aRuntimeUpdate =
  | {
      readonly type: "text" | "reasoning";
      readonly text: string;
    }
  | {
      readonly type: "status";
      readonly status: "working" | "waiting-approval";
      readonly text?: string;
    }
  | {
      readonly type: "tool";
      readonly tool: string;
      readonly progress?: number;
      readonly total?: number;
    };

export interface A2aRuntimeSession {
  run(input: {
    readonly taskId: string;
    readonly prompt: string;
    readonly signal: AbortSignal;
    readonly emit: (update: A2aRuntimeUpdate) => void;
  }): Promise<void>;
  close?(): void | Promise<void>;
}

export interface A2aRuntimeFactory {
  createSession(input: {
    readonly contextId: string;
    readonly taskId: string;
  }): A2aRuntimeSession | Promise<A2aRuntimeSession>;
}

export interface A2aServerOptions {
  readonly agentCard: AgentCard;
  readonly runtime: A2aRuntimeFactory;
  readonly authToken?: string;
  readonly exposeReasoning?: boolean;
  readonly maxTasks?: number;
  readonly maxContexts?: number;
  readonly maxTextChars?: number;
  readonly maxBodyBytes?: number;
  readonly maxSseBytes?: number;
  readonly rpcPath?: string;
}

export interface A2aHttpServerOptions extends A2aServerOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface A2aStartedServer {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  readonly close: () => Promise<void>;
}

type NormalizedA2aServerOptions = {
  readonly agentCard: AgentCard;
  readonly runtime: A2aRuntimeFactory;
  readonly authToken: string | undefined;
  readonly exposeReasoning: boolean;
  readonly maxTextChars: number;
  readonly maxContexts: number;
  readonly maxTasks: number;
  readonly maxBodyBytes: number;
  readonly maxSseBytes: number;
  readonly rpcPath: string;
};

function boundedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizedAuthToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token === undefined || token.length === 0 ? undefined : token;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    (isIP(normalized) === 4 && normalized.startsWith("127."))
  );
}

function hasValidBearerToken(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length).trim());
  const required = Buffer.from(expected);
  return provided.byteLength === required.byteLength && timingSafeEqual(provided, required);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function textPart(text: string, maxTextChars: number): Part {
  return {
    content: { $case: "text", value: boundedText(text, maxTextChars) },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}

function agentMessage(
  contextId: string,
  taskId: string,
  text: string,
  maxTextChars: number,
  messageId = randomUUID()
): Message {
  return {
    messageId,
    contextId,
    taskId,
    role: Role.ROLE_AGENT,
    parts: text.length === 0 ? [] : [textPart(text, maxTextChars)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

function userMessageFromRequest(
  requestContext: RequestContext,
  maxTextChars: number
): Message {
  const source = requestContext.userMessage;
  return {
    ...clone(source),
    parts: source.parts.map((part) => {
      if (part.content?.$case !== "text") {
        return {
          ...part,
          content: undefined,
          filename: "",
          mediaType: "text/plain",
        };
      }
      return {
        ...part,
        content: { $case: "text", value: boundedText(part.content.value, maxTextChars) },
        metadata: undefined,
        filename: "",
        mediaType: "text/plain",
      };
    }),
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

function taskStatus(
  state: TaskState,
  message: Message | undefined = undefined
): TaskStatus {
  return {
    state,
    message,
    timestamp: new Date().toISOString(),
  };
}

function statusUpdate(
  taskId: string,
  contextId: string,
  state: TaskState,
  message: Message | undefined,
  maxTextChars: number
): TaskStatusUpdateEvent {
  return {
    taskId,
    contextId,
    status: taskStatus(state, message),
    metadata: undefined,
  };
}

function artifact(
  artifactId: string,
  name: string,
  text: string,
  maxTextChars: number
): Artifact {
  return {
    artifactId,
    name,
    description: "",
    parts: text.length === 0 ? [] : [textPart(text, maxTextChars)],
    metadata: undefined,
    extensions: [],
  };
}

class BoundedTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly maxTasks: number;
  private readonly isActive: (taskId: string) => boolean;

  constructor(maxTasks: number, isActive: (taskId: string) => boolean) {
    this.maxTasks = maxTasks;
    this.isActive = isActive;
  }

  async save(task: Task, _context: ServerCallContext): Promise<void> {
    const exists = this.tasks.has(task.id);
    if (!exists && this.tasks.size >= this.maxTasks) {
      const evictable = [...this.tasks.keys()].find((taskId) => !this.isActive(taskId));
      if (evictable === undefined) {
        throw new Error("task store capacity is occupied by active tasks");
      }
      this.tasks.delete(evictable);
    }
    this.tasks.delete(task.id);
    this.tasks.set(task.id, clone(task));
    while (this.tasks.size > this.maxTasks) {
      const oldest = [...this.tasks.keys()].find((taskId) => !this.isActive(taskId));
      if (oldest === undefined) break;
      this.tasks.delete(oldest);
    }
  }

  async load(taskId: string, _context: ServerCallContext): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task === undefined ? undefined : clone(task);
  }

  async list(
    params: ListTasksRequest,
    _context: ServerCallContext
  ): Promise<ListTasksResponse> {
    const matching = [...this.tasks.values()].filter((task) => {
      if (params.contextId && task.contextId !== params.contextId) return false;
      if (
        params.status !== undefined &&
        params.status !== TaskState.TASK_STATE_UNSPECIFIED &&
        task.status?.state !== params.status
      ) {
        return false;
      }
      if (params.statusTimestampAfter !== undefined && params.statusTimestampAfter !== "") {
        const timestamp = task.status?.timestamp;
        if (timestamp === undefined || timestamp < params.statusTimestampAfter) return false;
      }
      return true;
    });
    const pageSize = Math.min(
      100,
      Math.max(1, params.pageSize ?? Math.min(50, this.maxTasks))
    );
    const offset = Number.parseInt(params.pageToken || "0", 10);
    const start = Number.isInteger(offset) && offset > 0 ? offset : 0;
    const page = matching.slice(start, start + pageSize).map((task) => {
      const copy = clone(task);
      if (params.historyLength !== undefined && params.historyLength >= 0) {
        copy.history = copy.history.slice(-params.historyLength);
      }
      if (params.includeArtifacts !== true) {
        copy.artifacts = [];
      }
      return copy;
    });
    const next = start + page.length < matching.length ? String(start + page.length) : "";
    return {
      tasks: page,
      nextPageToken: next,
      pageSize,
      totalSize: matching.length,
    };
  }
}

interface ActiveTask {
  readonly taskId: string;
  readonly contextId: string;
  readonly controller: AbortController;
  readonly session: A2aRuntimeSession;
  readonly maxTextChars: number;
  readonly eventBus: ExecutionEventBus;
  answer: string;
  reasoning: string;
  answerPublished: boolean;
  reasoningPublished: boolean;
  cancelPublished: boolean;
  terminalPublished: boolean;
}

interface PendingTask {
  readonly taskId: string;
  readonly contextId: string;
  readonly controller: AbortController;
  cancelRequested: boolean;
}

class A2aAgentExecutor implements AgentExecutor {
  private readonly runtime: A2aRuntimeFactory;
  private readonly maxTextChars: number;
  private readonly maxContexts: number;
  private readonly exposeReasoning: boolean;
  private readonly sessions = new Map<string, A2aRuntimeSession>();
  private readonly active = new Map<string, ActiveTask>();
  private readonly activeByContext = new Map<string, ActiveTask>();
  private readonly pending = new Map<string, PendingTask>();
  private readonly reservedTaskIds = new Set<string>();
  private readonly reservedContexts = new Set<string>();
  private sessionOperation: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly runtime: A2aRuntimeFactory;
    readonly maxTextChars: number;
    readonly maxContexts: number;
    readonly exposeReasoning: boolean;
  }) {
    this.runtime = options.runtime;
    this.maxTextChars = options.maxTextChars;
    this.maxContexts = options.maxContexts;
    this.exposeReasoning = options.exposeReasoning;
  }

  isTaskActive(taskId: string): boolean {
    return this.active.has(taskId) || this.pending.has(taskId) || this.reservedTaskIds.has(taskId);
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = requestContext;
    if (
      this.active.has(taskId) ||
      this.pending.has(taskId) ||
      this.reservedTaskIds.has(taskId)
    ) {
      this.publishRejected(requestContext, eventBus, "task is already active");
      return;
    }
    if (this.activeByContext.has(contextId) || this.reservedContexts.has(contextId)) {
      this.publishRejected(requestContext, eventBus, "context is already active");
      return;
    }
    const controller = new AbortController();
    const requestSignal = requestContext.context.state.get(A2A_REQUEST_SIGNAL);
    const disposeSignal = this.linkSignal(requestSignal, controller);
    const pending: PendingTask = {
      taskId,
      contextId,
      controller,
      cancelRequested: false,
    };
    this.pending.set(taskId, pending);
    this.reservedTaskIds.add(taskId);
    this.reservedContexts.add(contextId);
    let active: ActiveTask | undefined;
    try {
      const session = await this.sessionFor(contextId, taskId);
      active = {
        taskId,
        contextId,
        controller,
        session,
        maxTextChars: this.maxTextChars,
        eventBus,
        answer: "",
        reasoning: "",
        answerPublished: false,
        reasoningPublished: false,
        cancelPublished: false,
        terminalPublished: false,
      };
      this.pending.delete(taskId);
      this.active.set(taskId, active);
      this.activeByContext.set(contextId, active);
      const running = active;
      const task: Task = {
        id: taskId,
        contextId,
        status: taskStatus(TaskState.TASK_STATE_SUBMITTED),
        artifacts: [],
        history: [
          ...(requestContext.task?.history ?? []),
          userMessageFromRequest(requestContext, this.maxTextChars),
        ],
        metadata: { agent: "dev-agent" },
      };
      eventBus.publish(AgentEvent.task(task));
      eventBus.publish(
        AgentEvent.statusUpdate(
          statusUpdate(
            taskId,
            contextId,
            TaskState.TASK_STATE_WORKING,
            undefined,
            this.maxTextChars
          )
        )
      );
      try {
        if (!controller.signal.aborted && !pending.cancelRequested) {
          await session.run({
            taskId,
            prompt: this.promptFromMessage(requestContext.userMessage),
            signal: controller.signal,
            emit: (update) => this.publishUpdate(running, update),
          });
        }
        if (controller.signal.aborted || running.cancelPublished) {
          this.publishCanceled(running);
        } else {
          this.publishArtifacts(running, true);
          running.terminalPublished = true;
          eventBus.publish(
            AgentEvent.statusUpdate(
              statusUpdate(
                taskId,
                contextId,
                TaskState.TASK_STATE_COMPLETED,
                running.answer.length > 0
                  ? agentMessage(contextId, taskId, running.answer, this.maxTextChars)
                  : undefined,
                this.maxTextChars
              )
            )
          );
        }
      } catch (error) {
        if (controller.signal.aborted || running.cancelPublished || isAbortError(error)) {
          this.publishCanceled(running);
        } else {
          running.terminalPublished = true;
          eventBus.publish(
            AgentEvent.statusUpdate(
              statusUpdate(
                taskId,
                contextId,
                TaskState.TASK_STATE_FAILED,
                agentMessage(contextId, taskId, "agent execution failed", this.maxTextChars),
                this.maxTextChars
              )
            )
          );
        }
      }
    } catch {
      if (active === undefined) {
        this.publishRejected(requestContext, eventBus, "agent execution unavailable");
      }
    } finally {
      disposeSignal();
      this.pending.delete(taskId);
      this.reservedTaskIds.delete(taskId);
      this.reservedContexts.delete(contextId);
      if (active !== undefined && this.active.get(taskId) === active) {
        this.active.delete(taskId);
      }
      if (active !== undefined && this.activeByContext.get(contextId) === active) {
        this.activeByContext.delete(contextId);
      }
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const active = this.active.get(taskId);
    if (active !== undefined) {
      active.cancelPublished = true;
      active.controller.abort();
      this.publishCanceled(active, eventBus);
      return;
    }
    const pending = this.pending.get(taskId);
    if (pending !== undefined) {
      pending.cancelRequested = true;
      pending.controller.abort();
      return;
    }
    throw new Error("task is not active");
  }

  async close(): Promise<void> {
    for (const active of this.active.values()) {
      active.cancelPublished = true;
      active.controller.abort();
    }
    for (const pending of this.pending.values()) {
      pending.cancelRequested = true;
      pending.controller.abort();
    }
    const sessions = [...this.sessions.values()];
    this.active.clear();
    this.activeByContext.clear();
    this.pending.clear();
    this.reservedTaskIds.clear();
    this.reservedContexts.clear();
    this.sessions.clear();
    await Promise.all(
      sessions.map(async (session) => {
        try {
          await session.close?.();
        } catch {
          // Closing a local adapter is best effort.
        }
      })
    );
  }

  private async sessionFor(contextId: string, taskId: string): Promise<A2aRuntimeSession> {
    const previous = this.sessionOperation;
    let release!: () => void;
    this.sessionOperation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const existing = this.sessions.get(contextId);
      if (existing !== undefined) return existing;
      if (this.sessions.size >= this.maxContexts) {
        const oldest = [...this.sessions.keys()].find(
          (candidate) =>
            !this.activeByContext.has(candidate) &&
            !this.reservedContexts.has(candidate)
        );
        if (oldest === undefined) {
          throw new Error("context capacity is occupied by active tasks");
        }
        const evicted = this.sessions.get(oldest);
        this.sessions.delete(oldest);
        await evicted?.close?.();
      }
      const session = await this.runtime.createSession({ contextId, taskId });
      this.sessions.set(contextId, session);
      return session;
    } finally {
      release();
    }
  }

  private promptFromMessage(message: Message): string {
    return message.parts
      .flatMap((part) =>
        part.content?.$case === "text" ? [boundedText(part.content.value, this.maxTextChars)] : []
      )
      .join("\n")
      .trim();
  }

  private publishRejected(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
    reason: string
  ): void {
    const { taskId, contextId } = requestContext;
    const message = agentMessage(contextId, taskId, reason, this.maxTextChars);
    const task: Task = {
      id: taskId,
      contextId,
      status: taskStatus(TaskState.TASK_STATE_FAILED, message),
      artifacts: [],
      history: [
        ...(requestContext.task?.history ?? []),
        userMessageFromRequest(requestContext, this.maxTextChars),
      ],
      metadata: { agent: "dev-agent" },
    };
    eventBus.publish(AgentEvent.task(task));
    eventBus.publish(
      AgentEvent.statusUpdate(
        statusUpdate(
          taskId,
          contextId,
          TaskState.TASK_STATE_FAILED,
          message,
          this.maxTextChars
        )
      )
    );
  }

  private publishUpdate(active: ActiveTask, update: A2aRuntimeUpdate): void {
    if (active.controller.signal.aborted || active.terminalPublished) return;
    if (update.type === "text") {
      active.answer = boundedText(`${active.answer}${update.text}`, this.maxTextChars);
      active.answerPublished = true;
      this.publishArtifactChunk(active, "answer", update.text, false);
      return;
    }
    if (update.type === "reasoning") {
      if (!this.exposeReasoning) return;
      active.reasoning = boundedText(`${active.reasoning}${update.text}`, this.maxTextChars);
      active.reasoningPublished = true;
      this.publishArtifactChunk(active, "reasoning", update.text, false);
      return;
    }
    if (update.type === "status") {
      const message =
        update.text === undefined
          ? undefined
          : agentMessage(
              active.contextId,
              active.taskId,
              update.text,
              this.maxTextChars
            );
      active.eventBus.publish(
        AgentEvent.statusUpdate(
          statusUpdate(
            active.taskId,
            active.contextId,
            update.status === "waiting-approval"
              ? TaskState.TASK_STATE_INPUT_REQUIRED
              : TaskState.TASK_STATE_WORKING,
            message,
            this.maxTextChars
          )
        )
      );
      return;
    }
    if (update.type !== "tool") return;
    const safeTool = boundedText(update.tool.replace(/[\r\n]/g, " "), 128);
    const progress =
      update.progress === undefined
        ? safeTool
        : `${safeTool} ${update.progress}${update.total === undefined ? "" : `/${update.total}`}`;
    active.eventBus.publish(
      AgentEvent.statusUpdate(
        statusUpdate(
          active.taskId,
          active.contextId,
          TaskState.TASK_STATE_WORKING,
          agentMessage(active.contextId, active.taskId, progress, this.maxTextChars),
          this.maxTextChars
        )
      )
    );
  }

  private publishArtifacts(active: ActiveTask, lastChunk: boolean): void {
    if (active.answerPublished) {
      this.publishArtifactChunk(active, "answer", "", lastChunk);
    }
    if (active.reasoningPublished) {
      this.publishArtifactChunk(active, "reasoning", "", lastChunk);
    }
  }

  private publishArtifactChunk(
    active: ActiveTask,
    kind: "answer" | "reasoning",
    text: string,
    lastChunk: boolean
  ): void {
    const event: TaskArtifactUpdateEvent = {
      taskId: active.taskId,
      contextId: active.contextId,
      artifact: artifact(kind, kind, text, this.maxTextChars),
      append: true,
      lastChunk,
      metadata: undefined,
    };
    active.eventBus.publish(AgentEvent.artifactUpdate(event));
  }

  private publishCanceled(
    active: ActiveTask,
    eventBus: ExecutionEventBus = active.eventBus
  ): void {
    if (active.terminalPublished) return;
    if (!active.cancelPublished) active.cancelPublished = true;
    active.terminalPublished = true;
    eventBus.publish(
      AgentEvent.statusUpdate(
        statusUpdate(
          active.taskId,
          active.contextId,
          TaskState.TASK_STATE_CANCELED,
          undefined,
          this.maxTextChars
        )
      )
    );
  }

  private linkSignal(
    source: unknown,
    target: AbortController
  ): () => void {
    if (!(source instanceof AbortSignal)) return () => undefined;
    const abort = () => target.abort();
    if (source.aborted) {
      target.abort();
      return () => undefined;
    }
    source.addEventListener("abort", abort, { once: true });
    return () => source.removeEventListener("abort", abort);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

function normalizeRpcMethod(body: Record<string, unknown>): Record<string, unknown> {
  const method = body.method;
  if (typeof method !== "string") return body;
  const aliases: Record<string, string> = {
    "message/send": "SendMessage",
    "message/stream": "SendStreamingMessage",
    "tasks/get": "GetTask",
    "tasks/cancel": "CancelTask",
    "tasks/resubscribe": "SubscribeToTask",
    "tasks/list": "ListTasks",
  };
  const normalized = aliases[method];
  return normalized === undefined ? body : { ...body, method: normalized };
}

function requestHeaders(request: IncomingMessage): Record<string, string | string[] | undefined> {
  return request.headers;
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string
): A2aJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function readBody(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<{ readonly body?: string; readonly error?: A2aJsonRpcResponse }> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      return { error: jsonRpcError(null, -32600, "request body exceeds the configured limit") };
    }
    chunks.push(buffer);
  }
  return { body: Buffer.concat(chunks).toString("utf8") };
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  headers: Record<string, string> = {}
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function isStreamingRequest(body: Record<string, unknown>): boolean {
  return body.method === "SendStreamingMessage" || body.method === "SubscribeToTask";
}

function createContext(request: IncomingMessage, controller: AbortController): ServerCallContext {
  const context = defaultServerCallContextBuilder({
    extensions: undefined,
    user: undefined,
    headers: requestHeaders(request),
    requestedVersion: "1.0",
  });
  context.state.set(A2A_REQUEST_SIGNAL, controller.signal);
  return context;
}

function handleRequest(
  options: NormalizedA2aServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
  transport: JsonRpcTransportHandler,
): void {
  if (request.method === "GET" && request.url === "/.well-known/agent-card.json") {
    writeJson(response, 200, options.agentCard);
    return;
  }
  if (request.method !== "POST" || request.url?.split("?")[0] !== options.rpcPath) {
    writeJson(response, 404, { error: "not found" });
    return;
  }
  if (
    options.authToken !== undefined &&
    !hasValidBearerToken(request, options.authToken)
  ) {
    writeJson(
      response,
      401,
      jsonRpcError(null, -32001, "authentication required"),
      { "www-authenticate": "Bearer" }
    );
    return;
  }

  const requestController = new AbortController();
  let settled = false;
  const onClose = () => {
    if (!settled && !request.complete) requestController.abort();
  };
  request.once("close", onClose);
  const onResponseClose = () => {
    if (!settled) requestController.abort();
  };
  response.once("close", onResponseClose);
  void (async () => {
    const read = await readBody(request, options.maxBodyBytes);
    if (read.error !== undefined) {
      settled = true;
      writeJson(response, 413, read.error);
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(read.body ?? "");
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("invalid request");
      }
      parsed = normalizeRpcMethod(value as Record<string, unknown>);
    } catch {
      settled = true;
      writeJson(response, 400, jsonRpcError(null, -32700, "invalid JSON request"));
      return;
    }

    if (request.headers["a2a-version"] !== "1.0") {
      settled = true;
      writeJson(
        response,
        400,
        jsonRpcError(
          getRequestId(parsed),
          -32600,
          "A2A-Version header must be 1.0"
        )
      );
      return;
    }

    const context = createContext(request, requestController);
    try {
      const result = await transport.handle(parsed, context);
      if (isStreamingRequest(parsed) || isAsyncGenerator(result)) {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        let bytes = 0;
        let streamLimitReached = false;
        try {
          for await (const event of result as AsyncGenerator<A2aJsonRpcResponse>) {
            const frame = formatSSEEvent(event);
            const frameBytes = Buffer.byteLength(frame);
            if (bytes + frameBytes > options.maxSseBytes) {
              streamLimitReached = true;
              requestController.abort();
              break;
            }
            if (!response.write(frame)) {
              const drained = await onceDrain(response, requestController.signal);
              if (!drained) {
                requestController.abort();
                break;
              }
            }
            bytes += frameBytes;
          }
          if (streamLimitReached && !response.destroyed) {
            response.write(
              formatSSEErrorEvent({
                code: -32002,
                message: "stream exceeded the configured limit",
              })
            );
          }
        } catch {
          requestController.abort();
          const frame = formatSSEErrorEvent({
            code: -32603,
            message: "internal server error",
          });
          if (!response.destroyed) {
            response.write(frame);
          }
        }
        settled = true;
        if (!response.destroyed && !response.writableEnded) response.end();
        return;
      }
      settled = true;
      writeJson(response, 200, result);
    } catch {
      settled = true;
      writeJson(response, 500, jsonRpcError(getRequestId(parsed), -32603, "internal server error"));
    }
  })().catch(() => {
    if (!settled) {
      settled = true;
      writeJson(response, 500, jsonRpcError(null, -32603, "internal server error"));
    }
  });

  const cleanup = () => request.removeListener("close", onClose);
  response.once("finish", cleanup);
  response.once("close", () => {
    response.removeListener("close", onResponseClose);
    cleanup();
  });
}

function getRequestId(body: Record<string, unknown>): string | number | null {
  const id = body.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

function onceDrain(response: ServerResponse, signal: AbortSignal): Promise<boolean> {
  if (response.destroyed || response.writableEnded || signal.aborted) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    const onDrain = (): void => finish(true);
    const onClose = (): void => finish(false);
    const onError = (): void => finish(false);
    const onAbort = (): void => finish(false);
    const finish = (drained: boolean): void => {
      if (settled) return;
      settled = true;
      response.removeListener("drain", onDrain);
      response.removeListener("close", onClose);
      response.removeListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      resolve(drained);
    };
    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeOptions(options: A2aServerOptions): NormalizedA2aServerOptions {
  return {
    agentCard: options.agentCard,
    runtime: options.runtime,
    authToken: normalizedAuthToken(options.authToken),
    exposeReasoning: options.exposeReasoning === true,
    maxTextChars: positiveLimit(options.maxTextChars, DEFAULT_MAX_TEXT_CHARS),
    maxContexts: positiveLimit(options.maxContexts, DEFAULT_MAX_CONTEXTS),
    maxTasks: positiveLimit(options.maxTasks, DEFAULT_MAX_TASKS),
    maxBodyBytes: positiveLimit(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES),
    maxSseBytes: positiveLimit(options.maxSseBytes, DEFAULT_MAX_SSE_BYTES),
    rpcPath:
      options.rpcPath === undefined || options.rpcPath.length === 0
        ? DEFAULT_RPC_PATH
        : options.rpcPath.startsWith("/")
          ? options.rpcPath
          : `/${options.rpcPath}`,
  };
}

export function createAgentCard(input: {
  readonly name: string;
  readonly version: string;
  readonly url: string;
  readonly description?: string;
  readonly skillId?: string;
  readonly skillName?: string;
  readonly authRequired?: boolean;
}): AgentCard {
  const skill: AgentSkill = {
    id: input.skillId ?? "dev-agent",
    name: input.skillName ?? "Local coding agent",
    description: input.description ?? "A local coding agent with bounded task streaming.",
    tags: ["coding", "development"],
    examples: [],
    inputModes: ["text/plain"],
    outputModes: ["text/plain"],
    securityRequirements: [],
  };
  return {
    name: input.name,
    description: input.description ?? "A local coding agent.",
    supportedInterfaces: [
      {
        url: input.url,
        protocolBinding: "JSONRPC",
        tenant: "",
        protocolVersion: "1.0",
      },
    ],
    provider: undefined,
    version: input.version,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: input.authRequired
      ? {
          bearer: {
            scheme: {
              $case: "httpAuthSecurityScheme" as const,
              value: {
                description: "Bearer token required for task operations.",
                scheme: "Bearer",
                bearerFormat: "opaque token",
              },
            },
          },
        }
      : {},
    securityRequirements: input.authRequired
      ? [{ schemes: { bearer: { list: [] } } }]
      : [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [skill],
    signatures: [],
  };
}

export function createA2aServer(options: A2aServerOptions): Server {
  const normalized = normalizeOptions(options);
  const executor = new A2aAgentExecutor({
    runtime: normalized.runtime,
    maxTextChars: normalized.maxTextChars,
    maxContexts: normalized.maxContexts,
    exposeReasoning: normalized.exposeReasoning,
  });
  const taskStore = new BoundedTaskStore(
    normalized.maxTasks,
    (taskId) => executor.isTaskActive(taskId)
  );
  const requestHandler = new DefaultRequestHandler(
    normalized.agentCard,
    taskStore,
    executor,
    new DefaultExecutionEventBusManager()
  );
  const transport = new JsonRpcTransportHandler(requestHandler);
  const server = createServer((request, response) =>
    handleRequest(normalized, request, response, transport)
  );
  server.once("close", () => {
    void executor.close();
  });
  return server;
}

export async function startA2aServer(options: A2aHttpServerOptions = {} as A2aHttpServerOptions): Promise<A2aStartedServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const authToken = normalizedAuthToken(options.authToken);
  if (!isLoopbackHost(host) && authToken === undefined) {
    throw new Error("non-loopback A2A hosts require an authToken");
  }
  const server = createA2aServer({ ...options, authToken });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const address = server.address();
  const actualPort =
    typeof address === "object" && address !== null ? address.port : port;
  return {
    server,
    host,
    port: actualPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
