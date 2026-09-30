import { createHash } from "node:crypto";
import {
  createSdkMcpServer,
  query as defaultQuery,
  tool as defineSdkTool,
  type AnyZodRawShape,
  type CanUseTool,
  type McpSdkServerConfigWithInstance,
  type Options as SdkOptions,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  normalizeToolMetadata,
  type AgentTool,
  type AgentToolMetadata,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ToolCollection,
  type ToolExecutionContext,
  type ToolProgress,
  type ToolSandboxProfile,
} from "@dev-agent/agent-core";
import { z } from "zod";

export const CLAUDE_AGENT_MCP_SERVER_NAME = "dev_agent";
export const CLAUDE_AGENT_SDK_VERSION = "0.3.280";
const DEFAULT_MCP_TOOL_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000;
const SAFE_TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_PENDING_AUTHORIZATIONS = 256;
const PENDING_AUTHORIZATION_TTL_MS = 5 * 60_000;
const MAX_AUTHORIZATION_INPUT_CHARS = 1_000_000;

type JsonRecord = Record<string, unknown>;
type ZodSchema = z.ZodType<unknown>;

interface PendingAuthorization {
  readonly sdkToolName: string;
  readonly inputFingerprint: string;
  readonly reviewedInput?: JsonRecord;
  readonly reviewedInputFingerprint?: string;
  readonly result: PermissionResult;
  readonly createdAt: number;
}

interface AuthorizationReservation {
  readonly active: boolean;
}

/**
 * Binds a permission result to the next matching MCP handler invocation.
 *
 * The Claude Agent SDK normally calls `canUseTool` before an MCP handler, but
 * the MCP server itself has no access to that callback. Keeping a bounded,
 * one-use binding lets the handler enforce the same decision when the SDK
 * does call the handler directly, while also carrying `updatedInput` into the
 * actual project tool. A missing or expired binding is never treated as an
 * approval; the handler performs a fresh policy check instead.
 */
class PendingAuthorizationStore {
  private readonly entries: PendingAuthorization[] = [];
  private inFlight = 0;

  reserve(): AuthorizationReservation | undefined {
    this.prune();
    if (this.entries.length + this.inFlight >= MAX_PENDING_AUTHORIZATIONS) {
      return undefined;
    }
    this.inFlight += 1;
    return { active: true };
  }

  commit(
    reservation: AuthorizationReservation,
    sdkToolName: string,
    input: JsonRecord,
    result: PermissionResult,
  ): boolean {
    if (reservation.active) {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }

    const inputFingerprint = fingerprintJson(input);
    const reviewedInput = result.behavior === "allow" && result.updatedInput !== undefined
      ? result.updatedInput
      : undefined;
    const reviewedInputFingerprint = reviewedInput === undefined
      ? undefined
      : fingerprintJson(reviewedInput);
    if (inputFingerprint === undefined || (reviewedInput !== undefined && reviewedInputFingerprint === undefined)) {
      return false;
    }

    this.prune();
    if (this.entries.length >= MAX_PENDING_AUTHORIZATIONS) {
      return false;
    }
    this.entries.push({
      sdkToolName,
      inputFingerprint,
      ...(reviewedInput === undefined ? {} : { reviewedInput }),
      ...(reviewedInputFingerprint === undefined ? {} : { reviewedInputFingerprint }),
      result,
      createdAt: Date.now(),
    });
    return true;
  }

  clear(): void {
    this.entries.length = 0;
    this.inFlight = 0;
  }

  consume(sdkToolName: string, input: JsonRecord): PendingAuthorization | undefined {
    this.prune();
    const inputFingerprint = fingerprintJson(input);
    if (inputFingerprint === undefined) {
      return undefined;
    }
    const index = this.entries.findIndex(
      (entry) =>
        entry.sdkToolName === sdkToolName &&
        (entry.inputFingerprint === inputFingerprint || entry.reviewedInputFingerprint === inputFingerprint),
    );
    if (index < 0) {
      return undefined;
    }
    return this.entries.splice(index, 1)[0];
  }

  private prune(): void {
    const cutoff = Date.now() - PENDING_AUTHORIZATION_TTL_MS;
    let firstLive = 0;
    while (firstLive < this.entries.length && this.entries[firstLive]!.createdAt < cutoff) {
      firstLive += 1;
    }
    if (firstLive > 0) {
      this.entries.splice(0, firstLive);
    }
  }
}

export interface ClaudeAgentSdkToolUse {
  readonly id?: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ClaudeAgentSdkApprovalRequest {
  readonly toolName: string;
  readonly sdkToolName: string;
  readonly input: JsonRecord;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly metadata: AgentToolMetadata;
  readonly signal: AbortSignal;
}

export interface ClaudeAgentSdkRunOptions {
  /** The project's allowlisted tool registry. Nothing outside this registry is exposed. */
  readonly tools: ToolCollection;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly signal?: AbortSignal;
  readonly sandbox?: ToolSandboxProfile;
  /** Optional subset of registry names. An omitted allowlist exposes all registry tools. */
  readonly toolAllowlist?: readonly string[];
  /** Existing dev-agent policy. Omitting it is fail-closed: all tool calls are denied. */
  readonly approval?: ApprovalPolicy;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly mcpToolTimeoutMs?: number;
  readonly maxToolResultChars?: number;
  /** Forward SDK partial events to onMessage and incremental text/reasoning callbacks. */
  readonly includePartialMessages?: boolean;
  readonly onMessage?: (message: SDKMessage) => void;
  readonly onText?: (text: string) => void;
  readonly onReasoning?: (text: string) => void;
  readonly onToolCall?: (tool: ClaudeAgentSdkToolUse) => void;
  readonly onToolProgress?: (toolName: string, progress: ToolProgress) => void;
  readonly onApproval?: (
    request: ClaudeAgentSdkApprovalRequest,
    result: PermissionResult,
  ) => void;
  /** Test seam and an embedding seam for hosts that wrap query(). */
  readonly query?: ClaudeAgentSdkQueryFactory;
}

export interface ClaudeAgentSdkRunResult {
  readonly text: string;
  readonly result: SDKResultMessage;
}

export type ClaudeAgentSdkQueryFactory = (input: {
  readonly prompt: string;
  readonly options?: SdkOptions;
}) => Query;

export interface ClaudeAgentSdkToolBridge {
  readonly serverName: string;
  readonly sdkToolNames: readonly string[];
  readonly mcpServer: McpSdkServerConfigWithInstance;
  /** Drops unused preflight decisions when the host ends the query lifecycle. */
  clearPendingAuthorizations(): void;
  execute(
    sdkToolName: string,
    input: JsonRecord,
    extra?: unknown,
  ): Promise<CallToolResult>;
  checkPermission(
    sdkToolName: string,
    input: JsonRecord,
    signal: AbortSignal,
    toolUseID?: string,
  ): Promise<PermissionResult>;
}

export interface ClaudeAgentSdkContext {
  readonly bridge: ClaudeAgentSdkToolBridge;
  readonly queryOptions: SdkOptions;
}

/**
 * Converts an existing dev-agent tool name to the only MCP namespace this
 * adapter exposes. The prefix is deliberately stable so approval and audit
 * logs can distinguish project-owned tools from any external MCP server.
 */
export function toClaudeAgentSdkToolName(toolName: string): string {
  if (!SAFE_TOOL_NAME.test(toolName)) {
    throw new Error(
      `Tool name "${toolName}" contains unsupported characters; use letters, numbers, ., _, or -`,
    );
  }
  return `mcp__${CLAUDE_AGENT_MCP_SERVER_NAME}__${toolName}`;
}

export function fromClaudeAgentSdkToolName(sdkToolName: string): string | undefined {
  const prefix = `mcp__${CLAUDE_AGENT_MCP_SERVER_NAME}__`;
  if (!sdkToolName.startsWith(prefix)) {
    return undefined;
  }
  const toolName = sdkToolName.slice(prefix.length);
  return SAFE_TOOL_NAME.test(toolName) ? toolName : undefined;
}

/**
 * Builds an in-process MCP bridge and an isolated Agent SDK option object.
 *
 * Security invariants:
 * - Agent SDK native tools are disabled with `tools: []`.
 * - Only the selected project registry tools are exposed through one in-process
 *   MCP server.
 * - Filesystem/user/project settings and external MCP configuration are not
 *   loaded (`settingSources: []`, `strictMcpConfig: true`).
 * - Permission checks are routed to the project's ApprovalPolicy and deny by
 *   default when no policy is supplied.
 */
export function createClaudeAgentSdkContext(options: ClaudeAgentSdkRunOptions): ClaudeAgentSdkContext {
  validateRunOptions(options);

  const selectedTools = selectTools(options.tools, options.toolAllowlist);
  const toolsBySdkName = new Map<string, AgentTool>();
  const sdkNamesByAgentName = new Map<string, string>();
  for (const agentTool of selectedTools) {
    const sdkToolName = toClaudeAgentSdkToolName(agentTool.name);
    if (toolsBySdkName.has(sdkToolName)) {
      throw new Error(`Duplicate Claude Agent SDK tool name: ${sdkToolName}`);
    }
    toolsBySdkName.set(sdkToolName, agentTool);
    sdkNamesByAgentName.set(agentTool.name, sdkToolName);
  }

  const maxToolResultChars = options.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
  const abortController = createLinkedAbortController(options.signal);
  const authorizationStore = new PendingAuthorizationStore();
  let checkPermission: (
    sdkToolName: string,
    input: JsonRecord,
    signal: AbortSignal,
    toolUseID?: string,
  ) => Promise<PermissionResult>;

  const execute = async (
    sdkToolName: string,
    input: JsonRecord,
    extra?: unknown,
  ): Promise<CallToolResult> => {
    const agentTool = toolsBySdkName.get(sdkToolName);
    if (!agentTool) {
      return errorResult(`Tool "${sdkToolName}" is not exposed by this dev-agent session.`);
    }

    const extraSignal = getExtraSignal(extra);
    const signal = combineSignals(abortController.signal, extraSignal) ?? abortController.signal;
    try {
      throwIfAborted(signal);

      // Prefer a one-use decision made by canUseTool. This preserves the SDK's
      // reviewed input when the MCP handler receives the original arguments,
      // and preserves a denial if a future SDK version invokes the handler even
      // after canUseTool rejected the call.
      let authorization = authorizationStore.consume(sdkToolName, input);
      if (authorization === undefined) {
        const permission = await checkPermission(sdkToolName, input, signal);
        authorization = authorizationStore.consume(sdkToolName, input);
        if (authorization === undefined) {
          // A successful permission result must always be bound to an input.
          // Do not execute if that invariant is ever broken.
          return errorResult(
            permission.behavior === "deny"
              ? permission.message
              : "tool approval could not be safely bound to this MCP call",
          );
        }
      }

      if (authorization.result.behavior === "deny") {
        return errorResult(authorization.result.message);
      }

      const context: ToolExecutionContext = {
        sessionId: options.sessionId,
        workingDirectory: options.workingDirectory,
        signal,
        ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
        ...(options.onToolProgress === undefined
          ? {}
          : { onProgress: (progress: ToolProgress) => options.onToolProgress?.(agentTool.name, progress) }),
      };
      const output = await agentTool.execute(authorization.reviewedInput ?? input, context);
      throwIfAborted(signal);
      return successResult(output, maxToolResultChars);
    } catch (error) {
      return errorResult(formatError(error, maxToolResultChars));
    }
  };

  checkPermission = async (
    sdkToolName: string,
    input: JsonRecord,
    signal: AbortSignal,
    toolUseID?: string,
  ): Promise<PermissionResult> => {
    const agentTool = toolsBySdkName.get(sdkToolName);
    if (!agentTool) {
      return denyPermission(
        `Tool "${sdkToolName}" is not allowlisted for this dev-agent session.`,
        toolUseID,
      );
    }

    const metadata = options.tools.metadata?.(agentTool.name) ?? normalizeToolMetadata(agentTool);
    const approvalRequest = toApprovalRequest(
      agentTool,
      sdkToolName,
      input,
      metadata,
      options.sessionId,
      options.workingDirectory,
      signal,
    );
    const notify = (result: PermissionResult): PermissionResult => {
      options.onApproval?.(approvalRequest, result);
      return result;
    };

    // The binding store intentionally rejects inputs that cannot be represented
    // as bounded JSON. Calling the policy for such an input and then executing
    // it would make the second enforcement layer unverifiable.
    if (fingerprintJson(input) === undefined) {
      return notify(
        denyPermission(
          "tool input cannot be safely bound to the approval decision",
          toolUseID,
        ),
      );
    }

    const reservation = authorizationStore.reserve();
    if (reservation === undefined) {
      return notify(
        denyPermission(
          "approval boundary capacity is exhausted; retry after the current tool calls finish",
          toolUseID,
        ),
      );
    }

    let result: PermissionResult;
    if (signal.aborted) {
      result = denyPermission("tool approval was aborted", toolUseID);
    } else {
      let prepared;
      let preparationError: string | undefined;
      try {
        prepared = await options.approval?.prepare?.({
          toolName: agentTool.name,
          input,
          sessionId: options.sessionId,
          workingDirectory: options.workingDirectory,
          metadata: {
            risk: metadata.risk,
            confirmation: metadata.confirmation,
          },
        });
      } catch (error) {
        preparationError = `Approval preparation failed: ${formatError(error, 2_000)}`;
      }

      if (preparationError !== undefined) {
        result = denyPermission(preparationError, toolUseID);
      } else {
        const request: ApprovalRequest = {
          toolName: agentTool.name,
          input,
          sessionId: options.sessionId,
          workingDirectory: options.workingDirectory,
          metadata: {
            risk: metadata.risk,
            confirmation: metadata.confirmation,
          },
        };
        const requestForApproval = prepared?.review === undefined
          ? request
          : { ...request, review: prepared.review };

        let outcome: "allow" | "deny" | { decision: "allow" | "deny"; reason?: string };
        if (options.approval === undefined) {
          outcome = { decision: "deny", reason: "no dev-agent approval policy is configured" };
        } else {
          try {
            const decision = await options.approval.decide(requestForApproval);
            outcome = typeof decision === "string" ? decision : decision;
          } catch (error) {
            outcome = {
              decision: "deny",
              reason: `approval check failed: ${formatError(error, 2_000)}`,
            };
          }
        }

        const denied = typeof outcome === "string"
          ? outcome === "deny"
          : outcome.decision === "deny";
        if (denied) {
          const denialReason = outcome === "deny"
            ? "the dev-agent approval policy denied this call"
            : typeof outcome === "string"
              ? "the dev-agent approval policy denied this call"
              : outcome.reason ?? "the dev-agent approval policy denied this call";
          result = denyPermission(denialReason, toolUseID);
        } else if (prepared?.executeInput !== undefined && !isRecord(prepared.executeInput)) {
          result = denyPermission(
            "approval preparation returned a non-object tool input",
            toolUseID,
          );
        } else {
          result = {
            behavior: "allow",
            ...(prepared?.executeInput === undefined ? {} : { updatedInput: prepared.executeInput }),
            ...(toolUseID === undefined ? {} : { toolUseID }),
            decisionClassification: "user_temporary",
          };
        }
      }
    }

    if (!authorizationStore.commit(reservation, sdkToolName, input, result)) {
      result = denyPermission(
        "tool approval could not be safely bound to the MCP call",
        toolUseID,
      );
    }
    return notify(result);
  };

  const toolDefinitions = selectedTools.map((agentTool) => {
    const sdkToolName = sdkNamesByAgentName.get(agentTool.name);
    if (sdkToolName === undefined) {
      throw new Error(`Missing SDK name for tool "${agentTool.name}"`);
    }
    return defineSdkTool(
      sdkToolName,
      agentTool.description,
      jsonSchemaToZodShape(agentTool.parameters),
      async (input, extra) => execute(sdkToolName, asRecord(input), extra),
      { alwaysLoad: true },
    );
  });

  const mcpServer = createSdkMcpServer({
    name: CLAUDE_AGENT_MCP_SERVER_NAME,
    version: "0.1.0",
    instructions:
      "These are dev-agent project tools. Their execution is subject to the host project's approval and sandbox policy.",
    tools: toolDefinitions,
    alwaysLoad: true,
    timeout: options.mcpToolTimeoutMs ?? DEFAULT_MCP_TOOL_TIMEOUT_MS,
  });

  const canUseTool: CanUseTool = async (toolName, input, requestOptions) => {
    const result = await checkPermission(toolName, input, requestOptions.signal, requestOptions.toolUseID);
    return result;
  };

  const queryOptions: SdkOptions = {
    cwd: options.workingDirectory,
    tools: [],
    mcpServers: { [CLAUDE_AGENT_MCP_SERVER_NAME]: mcpServer },
    strictMcpConfig: true,
    settingSources: [],
    permissionMode: "default",
    permissionPrompts: "host",
    canUseTool,
    abortController,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
    ...(options.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: options.maxBudgetUsd }),
    ...(options.includePartialMessages === undefined
      ? {}
      : { includePartialMessages: options.includePartialMessages }),
  };

  return {
    bridge: {
      serverName: CLAUDE_AGENT_MCP_SERVER_NAME,
      sdkToolNames: [...toolsBySdkName.keys()],
      mcpServer,
      clearPendingAuthorizations: () => authorizationStore.clear(),
      execute,
      checkPermission,
    },
    queryOptions,
  };
}

/** Runs one Claude Agent SDK query through the project-owned tool boundary. */
export async function runClaudeAgentSdk(
  prompt: string,
  options: ClaudeAgentSdkRunOptions,
): Promise<ClaudeAgentSdkRunResult> {
  if (prompt.trim().length === 0) {
    throw new Error("Claude Agent SDK prompt must not be empty");
  }

  const context = createClaudeAgentSdkContext(options);
  const controller = context.queryOptions.abortController;
  const queryFactory = options.query ?? defaultQuery;
  const query = queryFactory({ prompt, options: context.queryOptions });
  let result: SDKResultMessage | undefined;
  const includePartialMessages = options.includePartialMessages === true;

  const abortQuery = () => {
    controller?.abort(options.signal?.reason);
    query.close();
  };
  options.signal?.addEventListener("abort", abortQuery, { once: true });

  try {
    for await (const message of query) {
      options.onMessage?.(message);
      forwardMessage(message, options, includePartialMessages);
      if (message.type === "result") {
        result = message;
      }
    }
    throwIfAborted(options.signal);
    if (result === undefined) {
      throw new Error("Claude Agent SDK query ended without a result message");
    }
    return {
      result,
      text: result.subtype === "success" ? result.result : "",
    };
  } finally {
    options.signal?.removeEventListener("abort", abortQuery);
    context.bridge.clearPendingAuthorizations();
    query.close();
  }
}

function validateRunOptions(options: ClaudeAgentSdkRunOptions): void {
  if (!options.sessionId.trim()) {
    throw new Error("Claude Agent SDK sessionId must not be empty");
  }
  if (!options.workingDirectory.trim()) {
    throw new Error("Claude Agent SDK workingDirectory must not be empty");
  }
  if (options.maxTurns !== undefined && (!Number.isInteger(options.maxTurns) || options.maxTurns < 1)) {
    throw new Error("Claude Agent SDK maxTurns must be a positive integer");
  }
  if (options.maxBudgetUsd !== undefined && (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd < 0)) {
    throw new Error("Claude Agent SDK maxBudgetUsd must be a non-negative number");
  }
  if (options.maxToolResultChars !== undefined && (!Number.isInteger(options.maxToolResultChars) || options.maxToolResultChars < 1)) {
    throw new Error("Claude Agent SDK maxToolResultChars must be a positive integer");
  }
  if (options.mcpToolTimeoutMs !== undefined && (!Number.isInteger(options.mcpToolTimeoutMs) || options.mcpToolTimeoutMs < 1_000)) {
    throw new Error("Claude Agent SDK mcpToolTimeoutMs must be at least 1000ms");
  }
}

function selectTools(tools: ToolCollection, allowlist: readonly string[] | undefined): AgentTool[] {
  const allTools = tools.list();
  const byName = new Map<string, AgentTool>();
  for (const tool of allTools) {
    if (byName.has(tool.name)) {
      throw new Error(`Duplicate dev-agent tool name: ${tool.name}`);
    }
    byName.set(tool.name, tool);
  }
  if (allowlist === undefined) {
    return allTools;
  }
  const selected: AgentTool[] = [];
  for (const name of allowlist) {
    const tool = byName.get(name);
    if (tool === undefined) {
      throw new Error(`Claude Agent SDK tool allowlist contains unknown tool: ${name}`);
    }
    selected.push(tool);
  }
  return selected;
}

function toApprovalRequest(
  tool: AgentTool,
  sdkToolName: string,
  input: JsonRecord,
  metadata: AgentToolMetadata,
  sessionId: string,
  workingDirectory: string,
  signal: AbortSignal,
): ClaudeAgentSdkApprovalRequest {
  return {
    toolName: tool.name,
    sdkToolName,
    input,
    sessionId,
    workingDirectory,
    metadata,
    signal,
  };
}

function jsonSchemaToZodShape(parameters: Record<string, unknown> | undefined): AnyZodRawShape {
  const schema = isRecord(parameters) ? parameters : {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );
  const shape: Record<string, ZodSchema> = {};
  for (const [name, propertySchema] of Object.entries(properties)) {
    let property = jsonSchemaToZod(propertySchema);
    if (!required.has(name)) {
      property = property.optional();
    }
    shape[name] = property;
  }
  return shape as AnyZodRawShape;
}

function jsonSchemaToZod(schema: unknown): ZodSchema {
  const value = isRecord(schema) ? schema : {};
  let result: ZodSchema;
  if (Array.isArray(value.enum) && value.enum.length > 0) {
    result = enumToZod(value.enum);
  } else {
    switch (value.type) {
      case "string":
        result = z.string();
        break;
      case "number":
        result = z.number();
        break;
      case "integer":
        result = z.number().int();
        break;
      case "boolean":
        result = z.boolean();
        break;
      case "array":
        result = z.array(jsonSchemaToZod(value.items));
        break;
      case "object":
        result = z.object(jsonSchemaToZodShape(value.properties as Record<string, unknown> | undefined));
        break;
      default:
        result = z.unknown();
        break;
    }
  }
  if (typeof value.description === "string" && value.description.length > 0) {
    result = result.describe(value.description);
  }
  if (value.nullable === true) {
    result = result.nullable();
  }
  return result;
}

function enumToZod(values: unknown[]): ZodSchema {
  if (values.every((value): value is string => typeof value === "string")) {
    const strings = values as [string, ...string[]];
    return z.enum(strings);
  }
  const literals = values.map((value) => z.literal(value as never));
  if (literals.length === 0) {
    return z.never();
  }
  if (literals.length === 1) {
    return literals[0]!;
  }
  return z.union(
    literals as unknown as [ZodSchema, ZodSchema, ...ZodSchema[]],
  );
}

function successResult(value: unknown, maxChars: number): CallToolResult {
  return {
    content: [{ type: "text", text: truncate(formatValue(value), maxChars) }],
    isError: false,
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function denyPermission(message: string, toolUseID: string | undefined): PermissionResult {
  return {
    behavior: "deny",
    message,
    ...(toolUseID === undefined ? {} : { toolUseID }),
    decisionClassification: "user_reject",
  };
}

function forwardMessage(
  message: SDKMessage,
  options: ClaudeAgentSdkRunOptions,
  includePartialMessages: boolean,
): void {
  if (message.type === "assistant" && !includePartialMessages) {
    const content = (message.message as unknown as JsonRecord).content;
    if (!Array.isArray(content)) {
      return;
    }
    for (const block of content) {
      forwardContentBlock(block, options);
    }
    return;
  }
  if (message.type !== "stream_event" || !includePartialMessages) {
    return;
  }
  const event = (message as unknown as JsonRecord).event;
  if (!isRecord(event) || event.type !== "content_block_delta") {
    return;
  }
  const delta = isRecord(event.delta) ? event.delta : {};
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    options.onText?.(delta.text);
  } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    options.onReasoning?.(delta.thinking);
  } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
    // Signatures are transport metadata, not user-visible reasoning.
  }
}

function forwardContentBlock(block: unknown, options: ClaudeAgentSdkRunOptions): void {
  if (!isRecord(block)) {
    return;
  }
  if (block.type === "text" && typeof block.text === "string") {
    options.onText?.(block.text);
  } else if (block.type === "thinking" && typeof block.thinking === "string") {
    options.onReasoning?.(block.thinking);
  } else if (
    block.type === "tool_use" &&
    typeof block.name === "string" &&
    isRecord(block.input)
  ) {
    options.onToolCall?.({
      ...(typeof block.id === "string" ? { id: block.id } : {}),
      name: block.name,
      input: block.input,
    });
  }
}

function getExtraSignal(extra: unknown): AbortSignal | undefined {
  if (!isRecord(extra)) {
    return undefined;
  }
  return isAbortSignal(extra.signal) ? extra.signal : undefined;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  if (present.length === 1) {
    return present[0];
  }
  return AbortSignal.any(present);
}

function createLinkedAbortController(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (signal === undefined) {
    return controller;
  }
  if (signal.aborted) {
    controller.abort(signal.reason);
    return controller;
  }
  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error("Claude Agent SDK query aborted");
  error.name = "AbortError";
  throw error;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function formatError(error: unknown, maxChars: number): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncate(message, maxChars);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const suffix = "\n...[truncated]";
  if (maxChars <= suffix.length) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - suffix.length)}${suffix}`;
}

function fingerprintJson(value: unknown): string | undefined {
  try {
    const serialized = stableSerialize(value);
    if (serialized.length > MAX_AUTHORIZATION_INPUT_CHARS) {
      return undefined;
    }
    return createHash("sha256").update(serialized, "utf8").digest("hex");
  } catch {
    return undefined;
  }
}

function stableSerialize(value: unknown, seen = new Set<object>()): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "undefined":
      return "null";
    case "bigint":
    case "function":
    case "symbol":
      throw new TypeError("value is not JSON serializable");
  }
  if (seen.has(value)) {
    throw new TypeError("value is cyclic");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableSerialize(item, seen)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key], seen)}`);
    return `{${fields.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}
