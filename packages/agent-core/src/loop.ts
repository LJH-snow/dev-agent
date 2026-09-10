import type { AgentState } from "./agent-state.js";
import type { AgentContext } from "./context.js";
import { createMemoryEntry, type AgentMemory, type MemoryEntry } from "./memory.js";
import type { ChatMessage, ModelProvider, ToolSchema } from "@dev-agent/model";
import type { ChatUsage } from "@dev-agent/model";
import {
  runTool,
  type ToolCollection,
  type ToolDefaults,
  type ToolExecutionContext,
} from "./tools.js";

export interface AgentLoopOptions {
  readonly model: ModelProvider;
  readonly tools?: ToolCollection;
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly onTurn?: (turn: number, context: AgentContext) => void;
  readonly onToken?: (token: string, context: AgentContext) => void;
  readonly onToolCall?: (call: { name: string; input: unknown }, context: AgentContext) => void;
  readonly onToolResult?: (result: { name: string; output: string }, context: AgentContext) => void;
  /** Fired for every model response that reported token usage. */
  readonly onUsage?: (usage: ChatUsage, context: AgentContext) => void;
  readonly toolDefaults?: ToolDefaults;
  readonly contextBudget?: ContextBudget;
}

/**
 * Approximate budget for the conversation history handed to the model.
 *
 * `maxChars` counts message content plus serialized tool calls. The system
 * prompt is neither counted nor dropped: it is always sent. Oldest entries are
 * dropped first, and an assistant message that requested tools is always kept
 * together with the tool results answering it. The newest entry is kept even
 * when it alone exceeds the budget, so the current request is never dropped.
 */
export interface ContextBudget {
  readonly maxChars?: number;
}

export interface RunOptions {
  /**
   * Stops the loop at the next checkpoint: before each turn, before each tool
   * call, and by forwarding the signal to the model request. A running tool
   * call is not killed; the loop stops before the following one.
   */
  readonly signal?: AbortSignal;
}

export class AgentLoop {
  private readonly model: ModelProvider;
  private readonly tools?: ToolCollection;
  private readonly systemPrompt?: string;
  private readonly maxTurns: number;
  private readonly onTurn?: (turn: number, context: AgentContext) => void;
  private readonly onToken?: (token: string, context: AgentContext) => void;
  private readonly onToolCall?: (call: { name: string; input: unknown }, context: AgentContext) => void;
  private readonly onToolResult?: (result: { name: string; output: string }, context: AgentContext) => void;
  private readonly onUsage?: (usage: ChatUsage, context: AgentContext) => void;
  private readonly toolDefaults?: ToolDefaults;
  private readonly contextBudget?: ContextBudget;

  constructor(options: AgentLoopOptions) {
    if (options.maxTurns !== undefined && options.maxTurns < 1) {
      throw new Error("maxTurns must be at least 1");
    }
    this.model = options.model;
    this.tools = options.tools;
    this.systemPrompt = options.systemPrompt;
    this.maxTurns = options.maxTurns ?? 10;
    this.onTurn = options.onTurn;
    this.onToken = options.onToken;
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
    this.onUsage = options.onUsage;
    this.toolDefaults = options.toolDefaults;
    this.contextBudget = options.contextBudget;
  }

  async run(
    context: AgentContext,
    input: string,
    options: RunOptions = {}
  ): Promise<AgentContext> {
    const memory = context.memory;
    await memory.append(createMemoryEntry("user", input));
    let state: AgentState = {
      ...context.state,
      status: "running",
      currentTask: input,
      lastError: undefined,
    };
    let updatedAt = new Date().toISOString();
    let completed = false;
    let totalUsage = context.usage;

    try {
      for (let turn = 0; turn < this.maxTurns && !completed; turn += 1) {
        throwIfAborted(options.signal);
        const messages = await this.buildMessages(memory, context);
        const chatOptions = {
          tools: this.buildToolSchemas(),
          signal: options.signal,
        };
        const completion = this.model.streamChat && this.onToken
          ? await this.model.streamChat(messages, { ...chatOptions, onToken: (token) => this.onToken?.(token, context) })
          : await this.model.chat(messages, chatOptions);
        if (completion.usage) {
          totalUsage = addUsage(totalUsage, completion.usage);
          this.onUsage?.(completion.usage, context);
        }
        const toolCalls = completion.toolCalls ?? [];

        await memory.append(createMemoryEntry("assistant", completion.content, { toolCalls }));
        state = { ...state, turns: state.turns + 1 };
        this.onTurn?.(state.turns, context);

        for (const call of toolCalls) {
          throwIfAborted(options.signal);
          if (!this.tools) {
            throw new Error(`Agent requested tool "${call.name}" but no tools are configured.`);
          }
          this.onToolCall?.({ name: call.name, input: call.input }, context);
          const toolContext: ToolExecutionContext = {
            sessionId: context.sessionId,
            workingDirectory: context.workingDirectory,
            signal: options.signal,
          };
          const result = await runTool(this.tools, call, toolContext, this.toolDefaults);
          this.onToolResult?.({ name: call.name, output: result }, context);
          await memory.append(
            createMemoryEntry("tool", result, { toolCallId: call.id, toolName: call.name })
          );
        }

        completed = toolCalls.length === 0;
      }

      state = {
        ...state,
        status: completed ? "done" : "error",
        lastError: completed
          ? undefined
          : state.lastError ?? "Max turns reached without a final answer",
      };
      updatedAt = new Date().toISOString();
      return { ...context, state, updatedAt, usage: totalUsage };
    } catch (error) {
      if (options.signal?.aborted) {
        // Interruptions are not failures: the caller decides how to report
        // them, and recording a half-finished turn as an error would be wrong.
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      await memory.append(createMemoryEntry("assistant", `[error] ${message}`));
      updatedAt = new Date().toISOString();
      return {
        ...context,
        state: { ...state, status: "error", lastError: message },
        updatedAt,
        usage: totalUsage,
      };
    }
  }

  private async buildMessages(memory: AgentMemory, context: AgentContext): Promise<ChatMessage[]> {
    const entries = await memory.entries();
    const messages: ChatMessage[] = [];
    const systemPrompt = this.buildSystemPrompt(context);
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    const selection = selectEntriesWithinBudget(entries, normalizeMaxChars(this.contextBudget?.maxChars));
    if (selection.omitted > 0) {
      messages.push({
        role: "system",
        content: `[context] ${selection.omitted} earlier entries omitted`,
      });
    }
    for (const entry of selection.entries) {
      messages.push(toChatMessage(entry));
    }
    return messages;
  }

  private buildSystemPrompt(context: AgentContext): string {
    const runtime = `Runtime: ${process.platform} / Node ${process.version}`;
    const toolCount = this.tools ? `Available tools: ${this.tools.list().length}` : "Available tools: 0";
    return [this.systemPrompt, `Session: ${context.sessionId}`, `Working directory: ${context.workingDirectory}`, runtime, toolCount]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
  }

  private buildToolSchemas(): ToolSchema[] | undefined {
    return this.tools?.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("The operation was aborted");
  }
}

/** Adds the tokens of one model response to a running total. */
function addUsage(
  total: ChatUsage | undefined,
  usage: ChatUsage
): ChatUsage {
  return {
    promptTokens: (total?.promptTokens ?? 0) + usage.promptTokens,
    completionTokens: (total?.completionTokens ?? 0) + usage.completionTokens,
    totalTokens: (total?.totalTokens ?? 0) + usage.totalTokens,
  };
}

interface HistorySelection {
  readonly entries: readonly MemoryEntry[];
  readonly omitted: number;
}

function normalizeMaxChars(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

/**
 * Keeps the newest entries that fit into `maxChars`, never splitting a tool
 * call from its tool results. Returns the original entries untouched when no
 * budget is configured.
 */
function selectEntriesWithinBudget(
  entries: readonly MemoryEntry[],
  maxChars: number | undefined
): HistorySelection {
  if (maxChars === undefined) {
    return { entries, omitted: 0 };
  }

  const groups = groupEntries(entries);
  const selected: MemoryEntry[][] = [];
  let used = 0;

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    const size = group.reduce((total, entry) => total + entryChars(entry), 0);
    const isNewest = index === groups.length - 1;
    if (!isNewest && used + size > maxChars) {
      break;
    }
    selected.unshift(group);
    used += size;
  }

  const kept = selected.flat();
  return { entries: kept, omitted: entries.length - kept.length };
}

/**
 * Groups an assistant message with the tool results that answer its calls so
 * the history never ends up with a tool message whose call was dropped.
 */
function groupEntries(entries: readonly MemoryEntry[]): MemoryEntry[][] {
  const groups: MemoryEntry[][] = [];
  const pendingByCallId = new Map<string, MemoryEntry[]>();

  for (const entry of entries) {
    if (entry.role === "assistant" && entry.toolCalls && entry.toolCalls.length > 0) {
      const group = [entry];
      groups.push(group);
      for (const call of entry.toolCalls) {
        pendingByCallId.set(call.id, group);
      }
      continue;
    }

    const pending = entry.role === "tool" && entry.toolCallId
      ? pendingByCallId.get(entry.toolCallId)
      : undefined;
    if (pending) {
      pending.push(entry);
      pendingByCallId.delete(entry.toolCallId!);
      continue;
    }

    groups.push([entry]);
  }

  return groups;
}

function entryChars(entry: MemoryEntry): number {
  const toolCallChars = entry.toolCalls ? JSON.stringify(entry.toolCalls).length : 0;
  return entry.content.length + toolCallChars;
}

function toChatMessage(entry: MemoryEntry): ChatMessage {
  return {
    role: entry.role,
    content: entry.content,
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    toolCalls: entry.toolCalls,
  };
}
