import type { AgentState } from "./agent-state.js";
import {
  BudgetExceededError,
  BudgetTracker,
  formatBudgetError,
  type AgentLoopBudget,
} from "./budget.js";
import { isAbsolute, relative, resolve } from "node:path";
import type { ApprovalOutcome, ApprovalPolicy, ApprovalPreparation, ApprovalRequest } from "./approval.js";
import type { AgentContext } from "./context.js";
import {
  createMemoryEntry,
  type AgentMemory,
  type AppliedChangeSetRecord,
  type ChangeSetEvidenceFile,
  type MemoryEntry,
} from "./memory.js";
import type { ChatMessage, ModelProvider, ToolCall, ToolSchema } from "@dev-agent/model";
import type { ChatUsage } from "@dev-agent/model";
import {
  runValidationAttempt,
  type ValidationAdapter,
  type ValidationResult,
} from "./validation.js";
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
  /** Resolves the system prompt immediately before each model turn. */
  readonly systemPromptProvider?: () => string | undefined;
  readonly maxTurns?: number;
  /** Per-run execution limits. Omit to preserve the historical loop behavior. */
  readonly budget?: AgentLoopBudget;
  readonly onTurn?: (turn: number, context: AgentContext) => void;
  readonly onToken?: (token: string, context: AgentContext) => void;
  readonly onReasoning?: (token: string, context: AgentContext) => void;
  readonly onToolCall?: (call: { name: string; input: unknown }, context: AgentContext) => void;
  readonly onToolProgress?: (
    progress: { name: string; progress: number; total?: number },
    context: AgentContext
  ) => void;
  readonly onToolResult?: (result: { name: string; output: string }, context: AgentContext) => void;
  /** Fired for every model response that reported token usage. */
  readonly onUsage?: (usage: ChatUsage, context: AgentContext) => void;
  /** Observes a budget stop without changing the loop result. */
  readonly onBudgetExceeded?: (error: BudgetExceededError, context: AgentContext) => void;
  /** Decides whether each tool call may run; unset means every call runs. */
  readonly approval?: ApprovalPolicy;
  readonly onApproval?: (
    request: ApprovalRequest,
    outcome: ApprovalOutcome,
    context: AgentContext
  ) => void;
  /** Plans and runs checks after a reviewed filesystem apply succeeds. */
  readonly validation?: ValidationAdapter;
  readonly onValidation?: (result: ValidationResult, context: AgentContext) => void;
  readonly toolDefaults?: ToolDefaults;
  readonly contextBudget?: ContextBudget;
  /**
   * Stops a run after the same tool failure (tool, input, and error) repeats
   * this many times. Omit to preserve the historical loop behavior.
   */
  readonly maxRepeatedToolFailures?: number;
  /**
   * Makes one no-tools model call to turn gathered evidence into a final
   * answer when the model-turn limit is reached. Omit to preserve the
   * historical budget error behavior.
   */
  readonly finalizeOnMaxTurns?: boolean;
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
   * call, and by forwarding the signal to the model request and tool context.
   * Running tools that honor the signal (including executors and MCP clients)
   * can stop their work before the interruption propagates to the caller.
   */
  readonly signal?: AbortSignal;
}

/** Mutable state shared by one `run()` call, including its usage total. */
interface RunState {
  readonly context: AgentContext;
  readonly signal?: AbortSignal;
  readonly budget?: BudgetTracker;
  totalUsage: ChatUsage | undefined;
}

interface ToolExecutionResult {
  readonly output: string;
  readonly failed: boolean;
  readonly errorMessage?: string;
}

export class AgentLoop {
  private readonly model: ModelProvider;
  private readonly tools?: ToolCollection;
  private readonly systemPrompt?: string;
  private readonly systemPromptProvider?: () => string | undefined;
  private readonly maxTurns: number;
  private readonly budget?: AgentLoopBudget;
  private readonly onTurn?: (turn: number, context: AgentContext) => void;
  private readonly onToken?: (token: string, context: AgentContext) => void;
  private readonly onReasoning?: (token: string, context: AgentContext) => void;
  private readonly onToolCall?: (call: { name: string; input: unknown }, context: AgentContext) => void;
  private readonly onToolProgress?: (
    progress: { name: string; progress: number; total?: number },
    context: AgentContext
  ) => void;
  private readonly onToolResult?: (result: { name: string; output: string }, context: AgentContext) => void;
  private readonly onUsage?: (usage: ChatUsage, context: AgentContext) => void;
  private readonly onBudgetExceeded?: (error: BudgetExceededError, context: AgentContext) => void;
  private readonly approval?: ApprovalPolicy;
  private readonly onApproval?: (
    request: ApprovalRequest,
    outcome: ApprovalOutcome,
    context: AgentContext
  ) => void;
  private readonly validation?: ValidationAdapter;
  private readonly onValidation?: (result: ValidationResult, context: AgentContext) => void;
  private readonly toolDefaults?: ToolDefaults;
  private readonly contextBudget?: ContextBudget;
  private readonly maxRepeatedToolFailures?: number;
  private readonly finalizeOnMaxTurns: boolean;
  /** Digest of the entries trimmed off so far, grown incrementally. */
  private summaryState?: { count: number; text: string; lastEntryId?: string };

  constructor(options: AgentLoopOptions) {
    if (options.maxTurns !== undefined && options.maxTurns < 1) {
      throw new Error("maxTurns must be at least 1");
    }
    if (
      options.maxRepeatedToolFailures !== undefined &&
      (!Number.isInteger(options.maxRepeatedToolFailures) || options.maxRepeatedToolFailures < 1)
    ) {
      throw new Error("maxRepeatedToolFailures must be a positive integer");
    }
    this.model = options.model;
    this.tools = options.tools;
    this.systemPrompt = options.systemPrompt;
    this.systemPromptProvider = options.systemPromptProvider;
    this.budget = options.budget;
    const configuredMaxTurns = options.maxTurns ?? 10;
    this.maxTurns = this.budget?.maxTurns === undefined
      ? configuredMaxTurns
      : Math.max(configuredMaxTurns, Math.ceil(this.budget.maxTurns) + 1);
    this.onTurn = options.onTurn;
    this.onToken = options.onToken;
    this.onReasoning = options.onReasoning;
    this.onToolCall = options.onToolCall;
    this.onToolProgress = options.onToolProgress;
    this.onToolResult = options.onToolResult;
    this.onUsage = options.onUsage;
    this.onBudgetExceeded = options.onBudgetExceeded;
    this.approval = options.approval;
    this.onApproval = options.onApproval;
    this.validation = options.validation;
    this.onValidation = options.onValidation;
    this.toolDefaults = options.toolDefaults;
    this.contextBudget = options.contextBudget;
    this.maxRepeatedToolFailures = options.maxRepeatedToolFailures;
    this.finalizeOnMaxTurns = options.finalizeOnMaxTurns === true;
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
    let loopError: string | undefined;
    const repeatedToolFailures = new Map<string, number>();
    const runState: RunState = {
      context,
      signal: options.signal,
      budget: this.budget ? new BudgetTracker(this.budget) : undefined,
      totalUsage: context.usage,
    };

    try {
      for (let turn = 0; turn < this.maxTurns && !completed; turn += 1) {
        throwIfAborted(options.signal);
        runState.budget?.beforeModelCall();
        const messages = await this.buildMessages(memory, context, runState);
        const chatOptions = {
          tools: this.buildToolSchemas(),
          signal: options.signal,
        };
        const completion = this.model.streamChat && this.onToken
          ? await this.model.streamChat(messages, {
              ...chatOptions,
              onToken: (token) => this.onToken?.(token, context),
              onReasoning: (token) => this.onReasoning?.(token, context),
            })
          : await this.model.chat(messages, chatOptions);
        if (completion.usage) {
          await this.recordUsage(runState, completion.usage);
        }
        runState.budget?.recordModelOutput(completion.content, completion.usage);
        const toolCalls = completion.toolCalls ?? [];

        await memory.append(createMemoryEntry("assistant", completion.content, { toolCalls }));
        state = { ...state, turns: state.turns + 1 };
        this.onTurn?.(state.turns, context);

        for (const call of toolCalls) {
          throwIfAborted(options.signal);
          if (!this.tools) {
            throw new Error(`Agent requested tool "${call.name}" but no tools are configured.`);
          }
          runState.budget?.beforeToolCall();
          this.onToolCall?.({ name: call.name, input: call.input }, context);

          const approvalRequest: ApprovalRequest = {
            toolName: call.name,
            input: call.input,
            sessionId: context.sessionId,
            workingDirectory: context.workingDirectory,
          };
          const preparation = await this.prepareApproval(approvalRequest);
          const requestForApproval = preparation?.request ?? approvalRequest;
          const outcome = preparation?.outcome ?? (await this.checkApproval(requestForApproval));
          if (outcome) {
            this.onApproval?.(requestForApproval, outcome, context);
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

          const executionCall = preparation?.executeInput === undefined
            ? call
            : { ...call, input: preparation.executeInput };
          const toolContext: ToolExecutionContext = {
            sessionId: context.sessionId,
            workingDirectory: context.workingDirectory,
            signal: options.signal,
            onProgress: this.onToolProgress
              ? (progress) =>
                  this.onToolProgress?.(
                    { name: call.name, ...progress },
                    context
                  )
              : undefined,
          };
          const executionResult = await this.runToolSafely(
            executionCall,
            toolContext,
            options.signal
          );
          let result = executionResult.output;
          if (
            executionResult.failed &&
            this.maxRepeatedToolFailures !== undefined &&
            executionResult.errorMessage !== undefined
          ) {
            const failureKey = createToolFailureKey(
              executionCall.name,
              executionCall.input,
              executionResult.errorMessage
            );
            const failureCount = (repeatedToolFailures.get(failureKey) ?? 0) + 1;
            repeatedToolFailures.set(failureKey, failureCount);
            if (failureCount >= this.maxRepeatedToolFailures) {
              loopError = JSON.stringify({
                code: "tool_loop_detected",
                tool: executionCall.name,
                repeated: failureCount,
              });
              result = `${result}\n${loopError}`;
            }
          }
          runState.budget?.recordToolOutput(result);
          this.onToolResult?.({ name: call.name, output: result }, context);
          await this.recordAppliedChangeSet(preparation, result, context);
          const validation = await this.validateAppliedChange(
            preparation,
            result,
            context,
            options.signal
          );
          if (validation) {
            this.onValidation?.(validation, context);
            try {
              await memory.recordValidation?.(validation);
            } catch {
              // Evidence persistence must not turn a successful apply into a
              // failed run or trigger an implicit rollback.
            }
          }
          const memoryResult = validation
            ? `${result}\n[validation] ${JSON.stringify(validation)}`
            : result;
          await memory.append(
            createMemoryEntry("tool", memoryResult, { toolCallId: call.id, toolName: call.name })
          );
          if (loopError) {
            break;
          }
        }

        if (loopError) {
          break;
        }
        completed = toolCalls.length === 0;
      }

      if (loopError) {
        await memory.append(createMemoryEntry("assistant", `[error] ${loopError}`));
      }
      if (!completed && !loopError && this.finalizeOnMaxTurns) {
        const finalized = await this.finalizeAfterMaxTurns(memory, context, runState, state);
        if (finalized) {
          return finalized;
        }
      }
      state = {
        ...state,
        status: loopError ? "error" : completed ? "done" : "error",
        lastError: loopError ?? (completed ? undefined : state.lastError ?? "Max turns reached without a final answer"),
      };
      updatedAt = new Date().toISOString();
      return { ...context, state, updatedAt, usage: runState.totalUsage };
    } catch (error) {
      if (options.signal?.aborted) {
        // Interruptions are not failures: the caller decides how to report
        // them, and recording a half-finished turn as an error would be wrong.
        throw error;
      }
      if (error instanceof BudgetExceededError) {
        try {
          this.onBudgetExceeded?.(error, context);
        } catch {
          // Budget observability must not change the deterministic stop result.
        }
        if (error.budget === "maxTurns" && this.finalizeOnMaxTurns) {
          const finalized = await this.finalizeAfterMaxTurns(memory, context, runState, state);
          if (finalized) {
            return finalized;
          }
        }
      }
      const message = error instanceof BudgetExceededError
        ? formatBudgetError(error)
        : error instanceof Error
          ? error.message
          : String(error);
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
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        throw error;
      }
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
    runState.budget?.beforeModelCall({ countTurn: false });
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
    runState.budget?.recordModelOutput(completion.content, completion.usage);
    return completion.content.trim();
  }

  private async recordUsage(runState: RunState, usage: ChatUsage): Promise<void> {
    runState.totalUsage = addUsage(runState.totalUsage, usage);
    this.onUsage?.(usage, runState.context);
    await runState.context.memory.recordUsage?.(usage);
  }

  /**
   * Runs a tool and turns a thrown error (including an unknown tool name) into
   * that tool's result, so the model can correct the call instead of losing the
   * whole run. An abort still propagates.
   */
  private async recordAppliedChangeSet(
    preparation:
      | { request: ApprovalRequest; executeInput?: unknown; outcome?: ApprovalOutcome }
      | undefined,
    toolResult: string,
    context: AgentContext
  ): Promise<void> {
    const review = preparation?.request.review;
    if (
      !review ||
      !isPreparedApply(preparation.executeInput, review) ||
      !isSuccessfulApply(toolResult, review) ||
      !context.memory.recordChangeSet
    ) {
      return;
    }

    const record = createAppliedChangeSetRecord(review, context);
    if (!record) {
      return;
    }
    try {
      await context.memory.recordChangeSet(record);
    } catch {
      // Evidence persistence is best-effort; a durable record must never turn
      // a successful apply into an error or trigger an implicit rollback.
    }
  }

  private async validateAppliedChange(
    preparation: { request: ApprovalRequest; executeInput?: unknown; outcome?: ApprovalOutcome } | undefined,
    toolResult: string,
    context: AgentContext,
    signal: AbortSignal | undefined
  ): Promise<ValidationResult | undefined> {
    const review = preparation?.request.review;
    if (!this.validation || !review || !isPreparedApply(preparation.executeInput, review) || !isSuccessfulApply(toolResult, review)) {
      return undefined;
    }
    return runValidationAttempt(this.validation, review, context, { signal });
  }

  private async runToolSafely(
    call: ToolCall,
    context: ToolExecutionContext,
    signal: AbortSignal | undefined
  ): Promise<ToolExecutionResult> {
    try {
      return {
        output: await runTool(this.tools!, call, context, this.toolDefaults),
        failed: false,
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: JSON.stringify({ error: message }),
        failed: true,
        errorMessage: message,
      };
    }
  }

  private async finalizeAfterMaxTurns(
    memory: AgentMemory,
    context: AgentContext,
    runState: RunState,
    state: AgentState
  ): Promise<AgentContext | undefined> {
    try {
      runState.budget?.beforeModelCall({ countTurn: false });
      const messages = await this.buildMessages(memory, context, runState);
      messages.push({
        role: "user",
        content:
          "The tool-call budget is exhausted. Do not call any tools. " +
          "Answer the current request using only verified evidence already present in this conversation. " +
          "Do not invent a defect from normal type aliases, shared imports, repeated props, or generic maintainability concerns. " +
          "If the evidence does not prove incorrect behavior, a violated contract, a failing test, or a concrete security impact, " +
          "use 问题：未验证到可复现缺陷 and 严重性：不适用 as the first two fields, and say 无需修复 instead of guessing.",
      });
      const completion = await this.model.chat(messages, {
        tools: [],
        signal: runState.signal,
      });
      if (completion.usage) {
        await this.recordUsage(runState, completion.usage);
      }
      runState.budget?.recordModelOutput(completion.content, completion.usage);
      if (!completion.content.trim() || (completion.toolCalls?.length ?? 0) > 0) {
        return undefined;
      }
      await memory.append(createMemoryEntry("assistant", completion.content, { toolCalls: [] }));
      return {
        ...context,
        state: { ...state, status: "done", lastError: undefined },
        updatedAt: new Date().toISOString(),
        usage: runState.totalUsage,
      };
    } catch (error) {
      if (runState.signal?.aborted) {
        throw error;
      }
      return undefined;
    }
  }

  /**
   * Gives a policy a chance to create a review before the decision is made.
   * Preparation failures are denials: the original input must never bypass a
   * policy that requires a reviewed execution input.
   */
  private async prepareApproval(
    request: ApprovalRequest
  ): Promise<{ request: ApprovalRequest; executeInput?: unknown; outcome?: ApprovalOutcome } | undefined> {
    if (!this.approval?.prepare) {
      return undefined;
    }
    try {
      const preparation: ApprovalPreparation | undefined = await this.approval.prepare(request);
      if (!preparation) {
        return { request };
      }
      return {
        request: preparation.review ? { ...request, review: preparation.review } : request,
        ...(preparation.executeInput !== undefined
          ? { executeInput: preparation.executeInput }
          : {}),
      };
    } catch (error) {
      return {
        request,
        outcome: {
          decision: "deny",
          reason: `approval preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
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
    const configuredPrompt = this.systemPromptProvider?.() ?? this.systemPrompt;
    return [configuredPrompt, `Session: ${context.sessionId}`, `Working directory: ${context.workingDirectory}`, runtime, toolCount]
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

function createAppliedChangeSetRecord(
  review: ApprovalRequest["review"],
  context: AgentContext
): AppliedChangeSetRecord | undefined {
  if (
    !review ||
    review.files.length === 0 ||
    !isNonNegativeInteger(review.additions) ||
    !isNonNegativeInteger(review.deletions)
  ) {
    return undefined;
  }

  const workingDirectory = resolve(context.workingDirectory);
  const files: ChangeSetEvidenceFile[] = [];
  const paths = new Set<string>();
  for (const file of review.files) {
    const target = resolve(workingDirectory, file.path);
    const path = relative(workingDirectory, target).split("\\").join("/");
    if (
      path.length === 0 ||
      path === "." ||
      path === ".." ||
      path.startsWith("../") ||
      isAbsolute(path) ||
      path.split("/").includes("..") ||
      path.includes("\0") ||
      paths.has(path) ||
      (file.kind !== "file" && file.kind !== "directory") ||
      !isSha256(file.afterHash) ||
      (file.beforeHash !== undefined && !isSha256(file.beforeHash)) ||
      !isNonNegativeInteger(file.additions) ||
      !isNonNegativeInteger(file.deletions) ||
      typeof file.beforeExists !== "boolean" ||
      typeof file.afterExists !== "boolean"
    ) {
      return undefined;
    }
    paths.add(path);
    files.push({
      path,
      kind: file.kind,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash,
      additions: file.additions,
      deletions: file.deletions,
      beforeExists: file.beforeExists,
      afterExists: file.afterExists,
    });
  }

  return {
    changeSetId: review.changeSetId,
    sessionId: context.sessionId,
    workingDirectory,
    files,
    additions: review.additions,
    deletions: review.deletions,
    createdAt: review.createdAt,
    recordedAt: new Date().toISOString(),
    state: "applied",
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPreparedApply(
  input: unknown,
  review: { readonly changeSetId: string }
): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const record = input as Record<string, unknown>;
  return record.action === "apply" && record.changeSetId === review.changeSetId;
}

function isSuccessfulApply(
  output: string,
  review: { readonly changeSetId: string }
): boolean {
  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== "object" || parsed === null) {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    return record.ok === true && record.changeSetId === review.changeSetId;
  } catch {
    return false;
  }
}

function createToolFailureKey(name: string, input: unknown, error: string): string {
  return `${name}\u0000${stableSerialize(input)}\u0000${error}`;
}

function stableSerialize(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (current: unknown): unknown => {
    if (current === null || typeof current !== "object") {
      return current;
    }
    if (seen.has(current)) {
      return "[Circular]";
    }
    seen.add(current);
    if (Array.isArray(current)) {
      const normalized = current.map((item) => normalize(item));
      seen.delete(current);
      return normalized;
    }
    const record = current as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalize(record[key]);
    }
    seen.delete(current);
    return normalized;
  };

  const serialized = JSON.stringify(normalize(value));
  return serialized === undefined ? String(value) : serialized;
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
