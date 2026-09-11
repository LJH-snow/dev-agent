import type { AgentState } from "./agent-state.js";
import type { ApprovalOutcome, ApprovalPolicy, ApprovalRequest } from "./approval.js";
import type { AgentContext } from "./context.js";
import { createMemoryEntry, type AgentMemory, type MemoryEntry } from "./memory.js";
import type { ChatMessage, ModelProvider, ToolSchema } from "@dev-agent/model";
import type { ChatUsage } from "@dev-agent/model";
import { addUsage } from "./usage.js";
import {
  runTool,
  type ToolCollection,
  type ToolDefaults,
  type ToolExecutionContext,
} from "./tools.js";

const DEFAULT_SUMMARY_MAX_CHARS = 2000;

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
  /** Decides whether each tool call may run; unset means every call runs. */
  readonly approval?: ApprovalPolicy;
  readonly onApproval?: (
    request: ApprovalRequest,
    outcome: ApprovalOutcome,
    context: AgentContext
  ) => void;
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
 *
 * With `summarize` enabled the dropped entries are not simply announced: the
 * loop asks the model for a short digest and sends that instead, adding only
 * the newly dropped entries on later turns. Summarization failures fall back to
 * the plain omission notice.
 */
export interface ContextBudget {
  readonly maxChars?: number;
  readonly summarize?: boolean;
  /** Upper bound for the digest; the oldest part is dropped when it overflows. */
  readonly summaryMaxChars?: number;
}

export interface RunOptions {
  /**
   * Stops the loop at the next checkpoint: before each turn, before each tool
   * call, and by forwarding the signal to the model request. A running tool
   * call is not killed; the loop stops before the following one.
   */
  readonly signal?: AbortSignal;
}

/** Mutable state shared by one `run()` call, including its usage total. */
interface RunState {
  readonly context: AgentContext;
  readonly signal?: AbortSignal;
  totalUsage: ChatUsage | undefined;
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
  private readonly approval?: ApprovalPolicy;
  private readonly onApproval?: (
    request: ApprovalRequest,
    outcome: ApprovalOutcome,
    context: AgentContext
  ) => void;
  private readonly toolDefaults?: ToolDefaults;
  private readonly contextBudget?: ContextBudget;
  /** Digest of the entries trimmed off so far, grown incrementally. */
  private summaryState?: { count: number; text: string; lastEntryId?: string };

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
    this.approval = options.approval;
    this.onApproval = options.onApproval;
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
    await this.loadSummary(memory);
    let state: AgentState = {
      ...context.state,
      status: "running",
      currentTask: input,
      lastError: undefined,
    };
    let updatedAt = new Date().toISOString();
    let completed = false;
    const runState: RunState = {
      context,
      signal: options.signal,
      totalUsage: context.usage,
    };

    try {
      for (let turn = 0; turn < this.maxTurns && !completed; turn += 1) {
        throwIfAborted(options.signal);
        const messages = await this.buildMessages(memory, context, runState);
        const chatOptions = {
          tools: this.buildToolSchemas(),
          signal: options.signal,
        };
        const completion = this.model.streamChat && this.onToken
          ? await this.model.streamChat(messages, { ...chatOptions, onToken: (token) => this.onToken?.(token, context) })
          : await this.model.chat(messages, chatOptions);
        if (completion.usage) {
          await this.recordUsage(runState, completion.usage);
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

          const approvalRequest: ApprovalRequest = {
            toolName: call.name,
            input: call.input,
            sessionId: context.sessionId,
            workingDirectory: context.workingDirectory,
          };
          const outcome = await this.checkApproval(approvalRequest);
          if (outcome) {
            this.onApproval?.(approvalRequest, outcome, context);
            if (outcome.decision === "deny") {
              const denial = `[denied by policy] ${
                outcome.reason ?? "the approval policy denied this call"
              }`;
              this.onToolResult?.({ name: call.name, output: denial }, context);
              await memory.append(
                createMemoryEntry("tool", denial, { toolCallId: call.id, toolName: call.name })
              );
              continue;
            }
          }

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
      return { ...context, state, updatedAt, usage: runState.totalUsage };
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
        usage: runState.totalUsage,
      };
    }
  }

  private async buildMessages(
    memory: AgentMemory,
    context: AgentContext,
    runState: RunState
  ): Promise<ChatMessage[]> {
    const entries = await memory.entries();
    const messages: ChatMessage[] = [];
    const systemPrompt = this.buildSystemPrompt(context);
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    const selection = selectEntriesWithinBudget(entries, normalizeMaxChars(this.contextBudget?.maxChars));
    if (selection.omitted > 0) {
      const dropped = entries.slice(0, selection.omitted);
      const summary = this.contextBudget?.summarize
        ? await this.summarizeDropped(dropped, runState, memory)
        : undefined;
      messages.push({
        role: "system",
        content: summary
          ? `[summary] ${summary}`
          : `[context] ${selection.omitted} earlier entries omitted`,
      });
    }
    for (const entry of selection.entries) {
      messages.push(toChatMessage(entry));
    }
    return messages;
  }

  /**
   * Returns the digest to send in place of the dropped entries, summarizing
   * only what has not been summarized yet. Undefined means "fall back to the
   * omission notice".
   */
  private async summarizeDropped(
    dropped: readonly MemoryEntry[],
    runState: RunState,
    memory: AgentMemory
  ): Promise<string | undefined> {
    const previous = this.summaryState;
    const covered = previous && previous.count <= dropped.length ? previous.count : 0;
    const pending = dropped.slice(covered);

    if (pending.length === 0) {
      return previous?.text;
    }

    try {
      const limit = normalizeSummaryLimit(this.contextBudget?.summaryMaxChars);
      const addition = await this.summarizeExcerpt(pending, runState, limit);
      const merged = previous?.text ? `${previous.text}\n${addition}` : addition;
      const text = clampSummary(merged, limit);
      this.summaryState = {
        count: dropped.length,
        text,
        lastEntryId: dropped[dropped.length - 1]?.id,
      };
      await this.persistSummary(memory);
      return text;
    } catch {
      // A failed summary must not break the conversation.
      return previous?.text;
    }
  }

  private async summarizeExcerpt(
    entries: readonly MemoryEntry[],
    runState: RunState,
    limit: number
  ): Promise<string> {
    const transcript = entries
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join("\n");
    const completion = await this.model.chat(
      [
        {
          role: "system",
          content:
            "Summarize the conversation excerpt for later reference. Keep decisions, file paths, commands, results, and open questions. Do not invent details. " +
            `Keep the summary under ${limit} characters.`,
        },
        { role: "user", content: transcript },
      ],
      { signal: runState.signal }
    );
    if (completion.usage) {
      await this.recordUsage(runState, completion.usage);
    }
    return completion.content.trim();
  }

  private async recordUsage(runState: RunState, usage: ChatUsage): Promise<void> {
    runState.totalUsage = addUsage(runState.totalUsage, usage);
    this.onUsage?.(usage, runState.context);
    await runState.context.memory.recordUsage?.(usage);
  }

  /**
   * Runs the policy, treating a broken policy as a denial. Returns undefined
   * when no policy is configured, so callers can skip the callback entirely.
   */
  private async checkApproval(request: ApprovalRequest): Promise<ApprovalOutcome | undefined> {
    if (!this.approval) {
      return undefined;
    }
    try {
      const outcome = await this.approval.decide(request);
      return typeof outcome === "string" ? { decision: outcome } : outcome;
    } catch (error) {
      return {
        decision: "deny",
        reason: `approval check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Restores a digest saved by an earlier run. The anchor id tells us where the
   * digest stops: entries after it have not been summarized yet.
   */
  private async loadSummary(memory: AgentMemory): Promise<void> {
    const cached = await memory.getSummary?.();
    if (!cached) {
      this.summaryState = undefined;
      return;
    }

    const entries = await memory.entries();
    const anchor = entries.findIndex((entry) => entry.id === cached.lastEntryId);
    this.summaryState = {
      // When the anchored entry is gone the history it covered was compacted
      // away: keep the digest and treat every remaining entry as unsummarized.
      count: anchor >= 0 ? anchor + 1 : 0,
      text: cached.text,
      lastEntryId: anchor >= 0 ? cached.lastEntryId : undefined,
    };
  }

  private async persistSummary(memory: AgentMemory): Promise<void> {
    const state = this.summaryState;
    if (!state?.lastEntryId || !memory.setSummary) {
      return;
    }
    try {
      await memory.setSummary({
        lastEntryId: state.lastEntryId,
        entriesCovered: state.count,
        text: state.text,
      });
    } catch {
      // Persisting the digest is best-effort; the run must not fail over it.
    }
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

function normalizeSummaryLimit(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_SUMMARY_MAX_CHARS;
  }
  return value;
}

/** Keeps the newest part of an over-long digest. */
function clampSummary(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `…${text.slice(text.length - limit + 1)}`;
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
