import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

export type * from "@agentclientprotocol/sdk";
export type {
  NewSessionRequest,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  StopReason,
  ToolCallContent,
  ToolKind,
} from "@agentclientprotocol/sdk";

export interface AcpSessionRuntime {
  readonly sessionId: string;
  prompt(
    prompt: string,
    options: { readonly signal: AbortSignal },
  ): Promise<Pick<acp.PromptResponse, "stopReason" | "usage">>;
  cancel(): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface AcpRuntimeFactory {
  createSession(input: {
    readonly request: acp.NewSessionRequest;
    readonly sessionId: string;
    readonly emit: (update: acp.SessionUpdate) => Promise<void>;
    readonly requestPermission: (
      request: acp.RequestPermissionRequest,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<acp.RequestPermissionResponse>;
  }): Promise<AcpSessionRuntime> | AcpSessionRuntime;
}

export interface CreateAcpAgentOptions {
  readonly name: string;
  readonly version: string;
  readonly runtime: AcpRuntimeFactory;
}

export interface AcpStdioStreams {
  readonly input: Readable;
  readonly output: Writable;
}

interface ActivePrompt {
  readonly controller: AbortController;
}

interface ConnectionState {
  readonly sessions: Map<string, AcpSessionRuntime>;
  readonly activePrompts: Map<string, ActivePrompt>;
}

function extractPromptText(prompt: readonly acp.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of prompt) {
    if (block.type !== "text") {
      throw new Error(`Unsupported ACP prompt content: ${block.type}`);
    }
    parts.push(block.text);
  }
  const text = parts.join("");
  if (text.trim().length === 0) {
    throw new Error("ACP prompt must contain text");
  }
  return text;
}

function combineSignals(
  first: AbortSignal,
  second: AbortSignal,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) {
    controller.abort();
  } else {
    first.addEventListener("abort", abort, { once: true });
    second.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener("abort", abort);
      second.removeEventListener("abort", abort);
    },
  };
}

function createConnectionState(): ConnectionState {
  return {
    sessions: new Map(),
    activePrompts: new Map(),
  };
}

function connectionKey(client: acp.AgentContext): object {
  // The SDK creates a fresh AgentContext wrapper for each inbound request,
  // while its private connection context is stable for the lifetime of the
  // ACP transport. Keep this compatibility shim isolated to this adapter.
  return (client as unknown as { readonly connectionContext: object }).connectionContext;
}

function closeConnectionState(state: ConnectionState): Promise<void> {
  const closing = [...state.sessions.entries()].map(async ([sessionId, session]) => {
    if (state.activePrompts.has(sessionId)) {
      try {
        await session.cancel();
      } catch {
        // A disconnect must still close the session if cancellation is best-effort.
      }
    }
    try {
      await session.close();
    } catch {
      // Connection teardown must not turn a clean client disconnect into an
      // unhandled rejection.
    }
  });
  state.sessions.clear();
  state.activePrompts.clear();
  return Promise.all(closing).then(() => undefined);
}

export function createAcpAgent(options: CreateAcpAgentOptions): acp.AgentApp {
  const connectionStates = new WeakMap<object, ConnectionState>();

  const stateFor = (client: acp.AgentContext): ConnectionState => {
    const key = connectionKey(client);
    const existing = connectionStates.get(key);
    if (existing) {
      return existing;
    }
    const state = createConnectionState();
    connectionStates.set(key, state);
    return state;
  };

  const app = acp
    .agent({ name: options.name })
    .onConnect((connection) => {
      const state = stateFor(connection.client);
      void connection.closed.then(() => closeConnectionState(state));
    })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      if (params.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw new Error(`Unsupported ACP protocol version: ${String(params.protocolVersion)}`);
      }
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: {},
        },
        agentInfo: {
          name: options.name,
          version: options.version,
        },
      };
    })
    .onRequest(acp.methods.agent.session.new, async ({ params, client }) => {
      if (!isAbsolute(params.cwd)) {
        throw new Error("ACP session cwd must be an absolute path");
      }
      const state = stateFor(client);
      const sessionId = randomUUID();
      const emit = (update: acp.SessionUpdate): Promise<void> =>
        client.notify(acp.methods.client.session.update, {
          sessionId,
          update,
        });
      const requestPermission = (
        request: acp.RequestPermissionRequest,
        requestOptions: { readonly signal?: AbortSignal } = {},
      ): Promise<acp.RequestPermissionResponse> =>
        client.request(
          acp.methods.client.session.requestPermission,
          request,
          requestOptions.signal === undefined
            ? undefined
            : { cancellationSignal: requestOptions.signal },
        );
      const session = await options.runtime.createSession({
        request: params,
        sessionId,
        emit,
        requestPermission,
      });
      if (session.sessionId !== sessionId) {
        await session.close();
        throw new Error("ACP runtime returned a mismatched session id");
      }
      state.sessions.set(sessionId, session);
      return {
        sessionId,
        _meta: {
          workingDirectory: params.cwd,
        },
      };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client, signal }) => {
      const state = stateFor(client);
      const session = state.sessions.get(params.sessionId);
      if (!session) {
        throw new Error(`ACP session not found: ${params.sessionId}`);
      }
      if (state.activePrompts.has(params.sessionId)) {
        throw new Error("ACP session already has an active prompt");
      }

      const prompt = extractPromptText(params.prompt);
      const controller = new AbortController();
      const combined = combineSignals(signal, controller.signal);
      state.activePrompts.set(params.sessionId, { controller });
      try {
        return await session.prompt(prompt, { signal: combined.signal });
      } catch (error) {
        if (combined.signal.aborted) {
          return { stopReason: "cancelled" };
        }
        throw error;
      } finally {
        combined.dispose();
        state.activePrompts.delete(params.sessionId);
      }
    })
    .onNotification(acp.methods.agent.session.cancel, async ({ params, client }) => {
      const state = stateFor(client);
      state.activePrompts.get(params.sessionId)?.controller.abort();
      await state.sessions.get(params.sessionId)?.cancel();
    });

  return app;
}

/**
 * Connects an ACP agent to a Node process without adding a second framing
 * layer. Diagnostics must stay on stderr while the supplied output remains
 * reserved for newline-delimited JSON-RPC messages.
 */
export function connectAcpStdio(
  agent: acp.AgentApp,
  streams: AcpStdioStreams = {
    input: process.stdin,
    output: process.stdout,
  },
): acp.AgentConnection {
  return agent.connect(
    acp.ndJsonStream(
      Writable.toWeb(streams.output),
      Readable.toWeb(streams.input),
    ),
  );
}
