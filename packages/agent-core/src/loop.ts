import type { AgentState } from "./agent-state.js";
import { randomUUID } from "node:crypto";
import {
  BudgetExceededError,
  BudgetTracker,
  formatBudgetError,
  type AgentLoopBudget,
} from "./budget.js";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  ApprovalOutcome,
  ApprovalPolicy,
  ApprovalPreparation,
  ApprovalRequest,
} from "./approval.js";
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
  createValidationId,
  runValidationAttempt,
  type ValidationAdapter,
  type ValidationResult,
} from "./validation.js";
import { addUsage } from "./usage.js";
import { AgentHookRegistry, type AgentHookContext, type AgentHookName } from "./hooks.js";
import {
  runTool,
  normalizeToolMetadata,
  isSandboxDeniedError,
  type AgentToolMetadata,
  type SandboxExpansionDecision,
  type SandboxExpansionRequest,
  type ToolCollection,
  type ToolDefaults,
  type ToolExecutionContext,
  type ToolSandboxProfile,
} from "./tools.js";
import {
  RuntimeEventSequence,
  type RuntimeEventPayloads,
  type RuntimeEventSink,
  type RuntimeEvent,
} from "@dev-agent/runtime-events";

const DEFAULT_SUMMARY_MAX_CHARS = 2000;

export interface AgentLoopOptions {
  readonly model: ModelProvider;
  readonly tools?: ToolCollection;
  readonly systemPrompt?: string;
  /** Resolves the system prompt immediately before each model turn. */
  readonly systemPromptProvider?: () => string | undefined;
  /** Receives ordered, UI-neutral runtime events in addition to callbacks. */
  readonly eventSink?: RuntimeEventSink;
  /** Explicitly controls provider streamChat usage; unset preserves callback-driven behavior. */
  readonly streamModelResponses?: boolean;
  /** Reuses a caller-owned sequence when multiple loops share one session. */
  readonly eventSequence?: RuntimeEventSequence;
  /** Runs bounded local observers around model and tool lifecycle points. */
  readonly hooks?: AgentHookRegistry;
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
  /** Receives a review created by a read-only filesystem preview in plan mode. */
  readonly onPlanReview?: (
    review: PlanReview,
    context: AgentContext,
    runId: string
  ) => void;
  /** Decides whether each tool call may run; unset means every call runs. */
  readonly approval?: ApprovalPolicy;
  readonly onApproval?: (
    request: ApprovalRequest,
    outcome: ApprovalOutcome,
    context: AgentContext
  ) => void;
  /** Observes approval and sandbox-expansion waits without changing their decisions. */
  readonly onApprovalStatus?: (status: "waiting" | "resolved") => void;
  /** Plans and runs checks after a reviewed filesystem apply succeeds. */
  readonly validation?: ValidationAdapter;
  readonly onValidation?: (result: ValidationResult, context: AgentContext) => void;
  readonly toolDefaults?: ToolDefaults;
  /**
   * Resolves an optional executor profile at the application boundary. When
   * omitted, tools keep their historical execution behavior.
   */
  readonly toolSandboxProfile?: (
    toolName: string,
    context: AgentContext
  ) => ToolSandboxProfile | undefined;
  /**
   * Requests a bounded sandbox expansion after the first execution attempt is
   * rejected by the runtime. A decision may retry the same call once.
   */
  readonly onSandboxExpansion?: (
    request: SandboxExpansionRequest,
    context: AgentContext
  ) => Promise<SandboxExpansionDecision> | SandboxExpansionDecision;
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
  /** Stable identifier used to correlate events for one submitted prompt. */
  readonly runId?: string;
  /**
   * Selects the execution posture for this run. Plan mode can inspect the
   * workspace through read-only tools but fails closed before mutating calls.
   */
  readonly mode?: "normal" | "plan";
  /**
   * Ephemeral context resolved by the caller (for example `@src/index.ts`).
   * It is sent as a separate system block and is not substituted into the
   * visible user prompt.
   */
  readonly attachedContext?: string;
  /**
   * Omits tool schemas and refuses any tool call for this run. This is useful
   * for narrowly identified conversational turns where tool context would
   * only add prompt-evaluation latency. Defaults to `all` for compatibility.
   */
  readonly toolAccess?: "all" | "none";
  /**
   * Stops the loop at the next checkpoint: before each turn, before each tool
   * call, and by forwarding the signal to the model request and tool context.
   * Running tools that honor the signal (including executors and MCP clients)
   * can stop their work before the interruption propagates to the caller.
   */
  readonly signal?: AbortSignal;
}

export type PlanReview = NonNullable<ApprovalRequest["review"]>;

export interface ApplyPlannedChangeSetOptions {
  /** User-visible request that is recorded in the lifecycle trace. */
  readonly prompt: string;
  /** Review produced by a filesystem preview during plan mode. */
  readonly review: PlanReview;
  readonly runId?: string;
  readonly signal?: AbortSignal;
}

/** Mutable state shared by one `run()` call, including its usage total. */
interface RunState {
  readonly context: AgentContext;
  readonly signal?: AbortSignal;
  readonly runId: string;
  readonly mode: "normal" | "plan";
  readonly toolAccess: "all" | "none";
  readonly attachedContext?: string;
  readonly budget?: BudgetTracker;
  totalUsage: ChatUsage | undefined;
  streamingAnnounced: boolean;
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
  private readonly eventSink?: RuntimeEventSink;
  private readonly streamModelResponses?: boolean;
  private readonly eventSequence?: RuntimeEventSequence;
  private readonly hooks?: AgentHookRegistry;
  private readonly eventSequences = new Map<string, RuntimeEventSequence>();
  private readonly startedEventSessions = new Set<string>();
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
  private readonly onPlanReview?: AgentLoopOptions["onPlanReview"];
  private readonly approval?: ApprovalPolicy;
  private readonly onApproval?: (
    request: ApprovalRequest,
    outcome: ApprovalOutcome,
    context: AgentContext
  ) => void;
  private readonly onApprovalStatus?: AgentLoopOptions["onApprovalStatus"];
  private readonly validation?: ValidationAdapter;
  private readonly onValidation?: (result: ValidationResult, context: AgentContext) => void;
  private readonly toolDefaults?: ToolDefaults;
  private readonly toolSandboxProfile?: AgentLoopOptions["toolSandboxProfile"];
  private readonly onSandboxExpansion?: AgentLoopOptions["onSandboxExpansion"];
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
    this.eventSink = options.eventSink;
    this.streamModelResponses = options.streamModelResponses;
    this.eventSequence = options.eventSequence;
    this.hooks = options.hooks;
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
    this.onPlanReview = options.onPlanReview;
    this.approval = options.approval;
    this.onApproval = options.onApproval;
    this.onApprovalStatus = options.onApprovalStatus;
    this.validation = options.validation;
    this.onValidation = options.onValidation;
    this.toolDefaults = options.toolDefaults;
    this.toolSandboxProfile = options.toolSandboxProfile;
    this.onSandboxExpansion = options.onSandboxExpansion;
    this.contextBudget = options.contextBudget;
    this.maxRepeatedToolFailures = options.maxRepeatedToolFailures;
    this.finalizeOnMaxTurns = options.finalizeOnMaxTurns === true;
  }

  async run(
    context: AgentContext,
    input: string,
    options: RunOptions = {}
  ): Promise<AgentContext> {
    const runId = options.runId ?? `run-${randomUUID()}`;
    const memory = context.memory;
    await memory.append(createMemoryEntry("user", input));
    await this.loadSummary(memory);
    if (!this.startedEventSessions.has(context.sessionId)) {
      this.startedEventSessions.add(context.sessionId);
      this.emitRuntimeEvent(context, "session.started", {
        workingDirectory: context.workingDirectory,
        ...(context.metadata.client === undefined ? {} : { client: context.metadata.client }),
      });
    }
    this.emitRuntimeEvent(context, "run.started", {
      prompt: input,
      model: this.model.model,
    }, runId);
    this.emitRuntimeEvent(context, "run.status", { status: "thinking" }, runId);
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
      runId,
      mode: options.mode ?? "normal",
      toolAccess: options.toolAccess ?? "all",
      ...(options.attachedContext?.trim()
        ? { attachedContext: options.attachedContext }
        : {}),
      budget: this.budget ? new BudgetTracker(this.budget) : undefined,
      totalUsage: context.usage,
      streamingAnnounced: false,
    };

    try {
      await this.runHook(
        "session.start",
        {
          sessionId: context.sessionId,
          runId,
          inputSummary: summarizeHookText(input),
          status: "thinking",
        },
        options.signal,
      );
      for (let turn = 0; turn < this.maxTurns && !completed; turn += 1) {
        throwIfAborted(options.signal);
        runState.budget?.beforeModelCall();
        const modelOperationId = `model-${randomUUID()}`;
        await this.runHook(
          "before.model",
          {
            sessionId: context.sessionId,
            runId,
            operationId: modelOperationId,
            turn: turn + 1,
            inputSummary: summarizeHookText(input),
            status: "thinking",
          },
          options.signal,
        );
        const messages = await this.buildMessages(memory, context, runState);
        const toolSchemas = runState.toolAccess === "none"
          ? undefined
          : this.buildToolSchemas();
        const chatOptions = {
          ...(toolSchemas === undefined ? {} : { tools: toolSchemas }),
          signal: options.signal,
        };
        let streamedReasoning = false;
        const completion =
          this.streamModelResponses !== false &&
          this.model.streamChat &&
          (this.onToken || this.onReasoning || this.eventSink)
          ? await this.model.streamChat(messages, {
              ...chatOptions,
              onToken: (token) => {
                if (!runState.streamingAnnounced) {
                  runState.streamingAnnounced = true;
                  this.emitRuntimeEvent(context, "run.status", { status: "streaming" }, runId);
                }
                this.emitRuntimeEvent(context, "assistant.delta", {
                  text: token,
                  channel: "answer",
                }, runId);
                this.onToken?.(token, context);
              },
              onReasoning: (token) => {
                streamedReasoning = true;
                this.emitRuntimeEvent(context, "assistant.delta", {
                  text: token,
                  channel: "reasoning",
                }, runId);
                this.onReasoning?.(token, context);
              },
            })
          : await this.model.chat(messages, chatOptions);
        if (!streamedReasoning && completion.reasoning) {
          this.emitRuntimeEvent(context, "run.status", { status: "streaming" }, runId);
          this.emitRuntimeEvent(context, "assistant.delta", {
            text: completion.reasoning,
            channel: "reasoning",
          }, runId);
          this.onReasoning?.(completion.reasoning, context);
        }
        await this.runHook(
          "after.model",
          {
            sessionId: context.sessionId,
            runId,
            operationId: modelOperationId,
            turn: turn + 1,
            status: completion.toolCalls?.length ? "tool-running" : "streaming",
            outputPreview: summarizeHookText(completion.content),
            ...(completion.usage === undefined ? {} : { usage: completion.usage }),
            ...(completion.providerTiming === undefined
              ? {}
              : { providerTiming: completion.providerTiming }),
          },
          options.signal,
        );
        if (completion.usage) {
          await this.recordUsage(runState, completion.usage);
        }
        runState.budget?.recordModelOutput(completion.content, completion.usage);
        const toolCalls = completion.toolCalls ?? [];

        if (runState.toolAccess === "none" && toolCalls.length > 0) {
          // A provider must never be able to turn an explicitly tool-free run
          // into tool execution, even if it returns an unadvertised call.
          loopError = "Model requested a tool during a tool-free run.";
          break;
        }

        await memory.append(createMemoryEntry("assistant", completion.content, { toolCalls }));
        state = { ...state, turns: state.turns + 1 };
        this.onTurn?.(state.turns, context);

        for (const call of toolCalls) {
          throwIfAborted(options.signal);
          if (!this.tools) {
            throw new Error(`Agent requested tool "${call.name}" but no tools are configured.`);
          }
          runState.budget?.beforeToolCall();
          await this.runHook(
            "before.tool",
            {
              sessionId: context.sessionId,
              runId,
              operationId: call.id,
              turn: state.turns,
              toolName: call.name,
              toolInputSummary: summarizeHookValue(call.input),
              status: "tool-running",
            },
            options.signal,
          );
          this.emitRuntimeEvent(context, "tool.started", {
            tool: call.name,
            input: call.input,
            metadata: toRuntimeToolMetadata(this.getToolMetadata(call.name)),
          }, runId);
          this.emitRuntimeEvent(context, "run.status", { status: "tool-running" }, runId);
          this.onToolCall?.({ name: call.name, input: call.input }, context);

          const toolMetadata = this.getToolMetadata(call.name);
          if (runState.mode === "plan" && !isReadOnlyToolCall(call, toolMetadata)) {
            const denial =
              `[plan mode] blocked ${call.name}: this tool call could change the workspace. ` +
              "Use read-only inspection now; the user must run /apply before changes are allowed.";
            runState.budget?.recordToolOutput(denial);
            this.emitRuntimeEvent(context, "tool.failed", {
              tool: call.name,
              error: denial,
            }, runId);
            this.onToolResult?.({ name: call.name, output: denial }, context);
            await memory.append(
              createMemoryEntry("tool", denial, { toolCallId: call.id, toolName: call.name })
            );
            this.emitRuntimeEvent(context, "run.status", { status: "thinking" }, runId);
            continue;
          }

          const approvalRequest: ApprovalRequest = {
            toolName: call.name,
            input: call.input,
            sessionId: context.sessionId,
            workingDirectory: context.workingDirectory,
            ...(toolMetadata === undefined
              ? {}
              : {
                  metadata: {
                    risk: toolMetadata.risk,
                    confirmation: toolMetadata.confirmation,
                  },
                }),
          };
          const preparation = await this.prepareApproval(approvalRequest);
          if (this.approval) {
            this.emitRuntimeEvent(context, "tool.approval-requested", {
              tool: call.name,
              input: call.input,
              ...(preparation?.request.review === undefined
                ? {}
                : { review: preparation.request.review }),
              metadata: toRuntimeToolMetadata(this.getToolMetadata(call.name)),
            }, runId);
            this.emitRuntimeEvent(context, "run.status", {
              status: "waiting-approval",
            }, runId);
          }
          const requestForApproval = preparation?.request ?? approvalRequest;
          // Mirrors the `run.status: waiting-approval` boundary above so callers
          // can show a pending confirmation without inspecting runtime events.
          const approvalGateActive = this.approval !== undefined;
          if (approvalGateActive) {
            this.onApprovalStatus?.("waiting");
          }
          const outcome = preparation?.outcome ?? (await this.checkApproval(requestForApproval));
          if (approvalGateActive) {
            this.onApprovalStatus?.("resolved");
          }
          if (outcome) {
            this.onApproval?.(requestForApproval, outcome, context);
            this.emitRuntimeEvent(context, "tool.approval-resolved", {
              tool: call.name,
              decision: outcome.decision,
              ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
            }, runId);
            if (outcome.decision === "deny") {
              const denial = `[denied by policy] ${
                outcome.reason ?? "the approval policy denied this call"
              }`;
              this.onToolResult?.({ name: call.name, output: denial }, context);
              await memory.append(
                createMemoryEntry("tool", denial, { toolCallId: call.id, toolName: call.name })
              );
              this.emitRuntimeEvent(context, "run.status", { status: "thinking" }, runId);
              continue;
            }
          }

          this.emitRuntimeEvent(context, "run.status", { status: "tool-running" }, runId);
          const executionCall = preparation?.executeInput === undefined
            ? call
            : { ...call, input: preparation.executeInput };
          const toolContext: ToolExecutionContext = {
            sessionId: context.sessionId,
            workingDirectory: context.workingDirectory,
            signal: options.signal,
            ...(this.toolSandboxProfile === undefined
              ? {}
              : (() => {
                  const sandbox = this.toolSandboxProfile(call.name, context);
                  return sandbox === undefined ? {} : { sandbox };
                })()),
            onProgress: this.onToolProgress || this.eventSink
              ? (progress) =>
                  {
                    this.emitRuntimeEvent(context, "tool.progress", {
                      tool: call.name,
                      progress: progress.progress,
                      ...(progress.total === undefined ? {} : { total: progress.total }),
                    }, runId);
                    this.onToolProgress?.(
                      { name: call.name, ...progress },
                      context
                    );
                  }
              : undefined,
          };
          const executionResult = await this.runToolSafely(
            executionCall,
            toolContext,
            options.signal,
            context,
            runId,
          );
          let result = executionResult.output;
          if (runState.mode === "plan" && call.name === "filesystem" && !executionResult.failed) {
            const review = parsePlanReviewResult(result);
            if (review) {
              try {
                this.onPlanReview?.(review, context, runId);
              } catch {
                // Plan observers are presentation-only and must never change
                // the model/tool result.
              }
            }
          }
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
          if (executionResult.failed) {
            this.emitRuntimeEvent(context, "tool.failed", {
              tool: call.name,
              error: executionResult.errorMessage ?? result,
            }, runId);
          } else {
            this.emitRuntimeEvent(context, "tool.completed", {
              tool: call.name,
              output: result,
            }, runId);
          }
          await this.runHook(
            "after.tool",
            {
              sessionId: context.sessionId,
              runId,
              operationId: call.id,
              turn: state.turns,
              toolName: call.name,
              outputPreview: summarizeHookText(result),
              status: executionResult.failed ? "error" : "done",
            },
            options.signal,
          );
          this.onToolResult?.({ name: call.name, output: result }, context);
          await this.recordAppliedChangeSet(preparation, result, context);
          const validation = await this.validateAppliedChange(
            preparation,
            result,
            context,
            options.signal,
            runId
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
          this.emitRuntimeEvent(context, "run.status", { status: "thinking" }, runId);
          if (loopError) {
            break;
          }
        }

        if (loopError) {
          break;
        }
        if (toolCalls.length === 0) {
          this.emitRuntimeEvent(context, "assistant.completed", {
            text: completion.content,
          }, runId);
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
      if (completed) {
        this.emitRuntimeEvent(context, "run.status", { status: "ready" }, runId);
        this.emitRuntimeEvent(context, "run.completed", { turns: state.turns }, runId);
      } else {
        this.emitRuntimeEvent(context, "run.status", { status: "error" }, runId);
        this.emitRuntimeEvent(context, "run.failed", {
          error: state.lastError ?? "The run ended without a final answer.",
          ...(loopError ? { code: "tool_loop_detected" } : { code: "max_turns" }),
        }, runId);
      }
      updatedAt = new Date().toISOString();
      return { ...context, state, updatedAt, usage: runState.totalUsage };
    } catch (error) {
      if (options.signal?.aborted) {
        // Interruptions are not failures: the caller decides how to report
        // them, and recording a half-finished turn as an error would be wrong.
        this.emitRuntimeEvent(context, "run.status", { status: "interrupted" }, runId);
        this.emitRuntimeEvent(context, "run.interrupted", {
          reason: error instanceof Error ? error.message : String(error),
        }, runId);
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
      this.emitRuntimeEvent(context, "run.status", { status: "error" }, runId);
      this.emitRuntimeEvent(context, "run.failed", {
        error: message,
        ...(error instanceof BudgetExceededError ? { code: error.budget } : {}),
      }, runId);
      updatedAt = new Date().toISOString();
      return {
        ...context,
        state: { ...state, status: "error", lastError: message },
        updatedAt,
        usage: runState.totalUsage,
      };
    } finally {
      await this.runHook(
        "session.end",
        {
          sessionId: context.sessionId,
          runId,
          turn: state.turns,
          status: options.signal?.aborted ? "interrupted" : state.status,
          ...(state.lastError === undefined ? {} : { error: summarizeHookText(state.lastError) }),
        },
        undefined,
      );
    }
  }

  /**
   * Applies the exact change set approved from a previous plan-mode preview.
   *
   * This path intentionally does not call the model again. The preview's
   * change-set identity and preimage guards remain authoritative, so a user
   * edit between planning and approval fails closed in the filesystem tool.
   */
  async applyPlannedChangeSet(
    context: AgentContext,
    options: ApplyPlannedChangeSetOptions,
  ): Promise<AgentContext> {
    const runId = options.runId ?? `run-${randomUUID()}`;
    const input = {
      action: "apply",
      changeSetId: options.review.changeSetId,
    };
    const tool = this.tools?.get("filesystem");
    if (!tool) {
      throw new Error("The filesystem tool is unavailable for applying the plan.");
    }

    await context.memory.append(createMemoryEntry("user", options.prompt));

    const state: AgentState = {
      ...context.state,
      status: "running",
      currentTask: options.prompt,
      lastError: undefined,
    };
    this.emitRuntimeEvent(context, "run.started", {
      prompt: options.prompt,
      model: this.model.model,
    }, runId);
    this.emitRuntimeEvent(context, "run.status", { status: "thinking" }, runId);
    this.emitRuntimeEvent(context, "tool.started", {
      tool: "filesystem",
      input,
      metadata: toRuntimeToolMetadata(this.getToolMetadata("filesystem")),
    }, runId);
    this.emitRuntimeEvent(context, "run.status", { status: "tool-running" }, runId);
    this.onToolCall?.({ name: "filesystem", input }, context);

    const preparation = {
      request: {
        toolName: "filesystem",
        input,
        sessionId: context.sessionId,
        workingDirectory: context.workingDirectory,
        review: options.review,
      },
      executeInput: input,
      outcome: { decision: "allow" as const },
    };

    try {
      throwIfAborted(options.signal);
      const toolContext: ToolExecutionContext = {
        sessionId: context.sessionId,
        workingDirectory: context.workingDirectory,
        signal: options.signal,
        ...(this.toolSandboxProfile === undefined
          ? {}
          : (() => {
              const sandbox = this.toolSandboxProfile("filesystem", context);
              return sandbox === undefined ? {} : { sandbox };
            })()),
      };
      const executionResult = await this.runToolSafely(
        { id: `apply-${randomUUID()}`, name: "filesystem", input },
        toolContext,
        options.signal,
        context,
        runId,
      );
      if (executionResult.failed || !isSuccessfulApply(executionResult.output, options.review)) {
        const message = executionResult.errorMessage ?? executionResult.output;
        throw new Error(message || "The approved plan could not be applied.");
      }

      await this.recordAppliedChangeSet(preparation, executionResult.output, context);
      const validation = await this.validateAppliedChange(
        preparation,
        executionResult.output,
        context,
        options.signal,
        runId,
      );
      if (validation) {
        this.onValidation?.(validation, context);
        try {
          await context.memory.recordValidation?.(validation);
        } catch {
          // Evidence persistence must never turn a successful apply into an
          // error or cause the applied files to be reverted.
        }
      }
      const memoryResult = validation
        ? `${executionResult.output}\n[validation] ${JSON.stringify(validation)}`
        : executionResult.output;
      await context.memory.append(
        createMemoryEntry("tool", memoryResult, {
          toolName: "filesystem",
          toolCallId: preparation.request.input.changeSetId as string,
        }),
      );
      this.onToolResult?.({ name: "filesystem", output: executionResult.output }, context);
      this.emitRuntimeEvent(context, "tool.completed", {
        tool: "filesystem",
        output: executionResult.output,
      }, runId);
      this.emitRuntimeEvent(context, "run.status", { status: "ready" }, runId);
      this.emitRuntimeEvent(context, "run.completed", { turns: state.turns }, runId);
      return {
        ...context,
        state: { ...state, status: "done" },
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (options.signal?.aborted) {
        this.emitRuntimeEvent(context, "run.status", { status: "interrupted" }, runId);
        this.emitRuntimeEvent(context, "run.interrupted", {
          reason: error instanceof Error ? error.message : String(error),
        }, runId);
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failureOutput = `[error] ${message}`;
      try {
        await context.memory.append(
          createMemoryEntry("tool", failureOutput, {
            toolName: "filesystem",
            toolCallId: preparation.request.input.changeSetId as string,
          }),
        );
        await context.memory.append(createMemoryEntry("assistant", failureOutput));
      } catch {
        // A persistence failure must not hide the original apply failure.
      }
      this.onToolResult?.({ name: "filesystem", output: failureOutput }, context);
      this.emitRuntimeEvent(context, "tool.failed", {
        tool: "filesystem",
        error: message,
      }, runId);
      this.emitRuntimeEvent(context, "run.status", { status: "error" }, runId);
      this.emitRuntimeEvent(context, "run.failed", {
        error: message,
        code: "plan_apply_failed",
      }, runId);
      return {
        ...context,
        state: { ...state, status: "error", lastError: message },
        updatedAt: new Date().toISOString(),
      };
    }
  }

  private async buildMessages(
    memory: AgentMemory,
    context: AgentContext,
    runState: RunState,
    toolAccess: RunState["toolAccess"] = runState.toolAccess,
  ): Promise<ChatMessage[]> {
    const entries = await memory.entries();
    const messages: ChatMessage[] = [];
    const systemPrompt = this.buildSystemPrompt(context, toolAccess);
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    if (runState.mode === "plan") {
      messages.push({
        role: "system",
        content:
          "PLAN MODE: Work in read-only analysis mode. Inspect the workspace and produce a concrete implementation plan. " +
          "Do not modify files, run mutating commands, or claim that changes were applied. " +
          "When concrete file mutations are known, use the filesystem tool with action preview and one changes array " +
          "to create a reviewable change set; preview is read-only. Never call write, edit, patch, mkdir, apply, " +
          "or rollback in plan mode. If a preview is not possible, explain the exact files and edits instead.",
      });
    }
    if (runState.attachedContext) {
      messages.push({ role: "system", content: runState.attachedContext });
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
    this.emitRuntimeEvent(runState.context, "usage.reported", {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      ...(usage.cachedPromptTokens === undefined
        ? {}
        : { cachedPromptTokens: usage.cachedPromptTokens }),
    }, runState.runId);
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
    signal: AbortSignal | undefined,
    runId: string
  ): Promise<ValidationResult | undefined> {
    const review = preparation?.request.review;
    if (!this.validation || !review || !isPreparedApply(preparation.executeInput, review) || !isSuccessfulApply(toolResult, review)) {
      return undefined;
    }
    const validationId = createValidationId(review.changeSetId);
    this.emitRuntimeEvent(context, "run.status", { status: "validating" }, runId);
    this.emitRuntimeEvent(context, "validation.started", {
      validationId,
      detail: review.changeSetId,
    }, runId);
    const result = await runValidationAttempt(this.validation, review, context, { signal });
    this.emitRuntimeEvent(context, "validation.completed", {
      validationId: result.validationId,
      status: result.status,
      detail: result.summary,
    }, runId);
    return result;
  }

  private async runToolSafely(
    call: ToolCall,
    context: ToolExecutionContext,
    signal: AbortSignal | undefined,
    agentContext: AgentContext,
    runId: string,
  ): Promise<ToolExecutionResult> {
    let attempt = 0;
    let executionContext = context;
    while (true) {
      try {
        return {
          output: await runTool(this.tools!, call, executionContext, this.toolDefaults),
          failed: false,
        };
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        if (
          attempt === 0 &&
          executionContext.sandbox !== undefined &&
          isSandboxDeniedError(error)
        ) {
          const request: SandboxExpansionRequest = {
            toolName: call.name,
            input: call.input,
            sessionId: agentContext.sessionId,
            workingDirectory: agentContext.workingDirectory,
            profile: executionContext.sandbox,
            error: {
              message: error.message,
              ...(error.code === undefined ? {} : { code: error.code }),
              ...(error.originalCode === undefined ? {} : { originalCode: error.originalCode }),
              capability: error.capability,
              ...(error.command === undefined ? {} : { command: error.command }),
            },
          };
          const callback = this.onSandboxExpansion;
          if (callback !== undefined) {
            this.emitRuntimeEvent(agentContext, "tool.sandbox-expansion-requested", {
              tool: call.name,
              capability: error.capability,
              reason: error.message,
              input: call.input,
              profile: {
                name: executionContext.sandbox.name,
                ...(executionContext.sandbox.network === undefined
                  ? {}
                  : { network: executionContext.sandbox.network }),
              },
            }, runId);
            this.emitRuntimeEvent(agentContext, "run.status", {
              status: "waiting-approval",
              detail: `sandbox expansion: ${error.capability}`,
            }, runId);
            this.onApprovalStatus?.("waiting");

            let decision: SandboxExpansionDecision;
            try {
              decision = await callback(request, agentContext);
            } catch (callbackError) {
              decision = {
                decision: "deny",
                reason: callbackError instanceof Error
                  ? callbackError.message
                  : String(callbackError),
              };
            }
            this.onApprovalStatus?.("resolved");
            const canRetry = decision.decision === "allow" && decision.profile !== undefined;
            this.emitRuntimeEvent(agentContext, "tool.sandbox-expansion-resolved", {
              tool: call.name,
              capability: error.capability,
              decision: canRetry ? "allow" : "deny",
              ...(canRetry
                ? {}
                : {
                    reason:
                      decision.reason ??
                      "sandbox expansion was denied or did not provide a bounded profile",
                  }),
            }, runId);
            if (canRetry) {
              attempt += 1;
              executionContext = { ...executionContext, sandbox: decision.profile };
              this.emitRuntimeEvent(agentContext, "run.status", {
                status: "tool-running",
              }, runId);
              continue;
            }
            const deniedMessage =
              decision.reason ?? "sandbox expansion was denied";
            return {
              output: JSON.stringify({ error: deniedMessage }),
              failed: true,
              errorMessage: deniedMessage,
            };
          }
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          output: JSON.stringify({ error: message }),
          failed: true,
          errorMessage: message,
        };
      }
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
      const messages = await this.buildMessages(memory, context, runState, "none");
      messages.push({
        role: "user",
        content:
          "The tool-call budget is exhausted. Do not call any tools. " +
          "Answer the current request using only verified evidence already present in this conversation. " +
          "Do not invent a defect from normal type aliases, shared imports, repeated props, or generic maintainability concerns. " +
          "If the evidence does not prove incorrect behavior, a violated contract, a failing test, or a concrete security impact, " +
          "use 问题：未验证到可复现缺陷 and 严重性：不适用 as the first two fields, and say 无需修复 instead of guessing.",
      });
      const modelOperationId = `model-${randomUUID()}`;
      await this.runHook(
        "before.model",
        {
          sessionId: context.sessionId,
          runId: runState.runId,
          operationId: modelOperationId,
          turn: state.turns,
          status: "finalizing",
        },
        runState.signal,
      );
      const completion = await this.model.chat(messages, {
        tools: [],
        signal: runState.signal,
      });
      await this.runHook(
        "after.model",
        {
          sessionId: context.sessionId,
          runId: runState.runId,
          operationId: modelOperationId,
          turn: state.turns,
          status: "streaming",
          ...(completion.usage === undefined ? {} : { usage: completion.usage }),
          ...(completion.providerTiming === undefined
            ? {}
            : { providerTiming: completion.providerTiming }),
        },
        runState.signal,
      );
      if (completion.usage) {
        await this.recordUsage(runState, completion.usage);
      }
      runState.budget?.recordModelOutput(completion.content, completion.usage);
      if (!completion.content.trim() || (completion.toolCalls?.length ?? 0) > 0) {
        return undefined;
      }
      await memory.append(createMemoryEntry("assistant", completion.content, { toolCalls: [] }));
      this.emitRuntimeEvent(context, "assistant.completed", {
        text: completion.content,
      }, runState.runId);
      this.emitRuntimeEvent(context, "run.status", { status: "ready" }, runState.runId);
      this.emitRuntimeEvent(context, "run.completed", { turns: state.turns }, runState.runId);
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

  private sequenceFor(sessionId: string): RuntimeEventSequence {
    const existing = this.eventSequences.get(sessionId);
    if (existing) {
      return existing;
    }
    const sequence = this.eventSequences.size === 0 && this.eventSequence
      ? this.eventSequence
      : new RuntimeEventSequence(sessionId);
    this.eventSequences.set(sessionId, sequence);
    return sequence;
  }

  private emitRuntimeEvent<TType extends keyof RuntimeEventPayloads>(
    context: AgentContext,
    type: TType,
    data: RuntimeEventPayloads[TType],
    runId?: string
  ): void {
    if (!this.eventSink) {
      return;
    }
    try {
      const event = this.sequenceFor(context.sessionId).create(
        type,
        data,
        runId === undefined ? {} : { runId },
      );
      this.eventSink(event as RuntimeEvent);
    } catch {
      // Observability must never change the agent's execution result.
    }
  }

  private async runHook(
    name: AgentHookName,
    context: AgentHookContext,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await this.hooks?.run(
      name,
      {
        ...context,
        occurredAt: context.occurredAt ?? new Date().toISOString(),
      },
      signal,
    );
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

  private buildSystemPrompt(context: AgentContext, toolAccess: RunState["toolAccess"]): string {
    const runtime = `Runtime: ${process.platform} / Node ${process.version}`;
    const toolCount = toolAccess === "none"
      ? "Available tools: 0"
      : this.tools ? `Available tools: ${this.tools.list().length}` : "Available tools: 0";
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

  private getToolMetadata(name: string): AgentToolMetadata | undefined {
    const tool = this.tools?.get(name);
    if (!tool) {
      return undefined;
    }
    return this.tools?.metadata?.(name) ?? normalizeToolMetadata(tool);
  }
}

function toRuntimeToolMetadata(
  metadata: AgentToolMetadata | undefined,
): RuntimeEventPayloads["tool.started"]["metadata"] {
  return metadata === undefined
    ? undefined
    : {
        risk: metadata.risk,
        confirmation: metadata.confirmation,
        resultFormat: metadata.resultFormat,
        supportsProgress: metadata.supportsProgress,
      };
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

function parsePlanReviewResult(output: string): PlanReview | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const candidate = isRecord(parsed.review) ? parsed.review : parsed;
  if (
    typeof candidate.changeSetId !== "string" ||
    candidate.changeSetId.length === 0 ||
    !Array.isArray(candidate.files) ||
    candidate.files.length === 0 ||
    !isNonNegativeInteger(candidate.additions) ||
    !isNonNegativeInteger(candidate.deletions)
  ) {
    return undefined;
  }
  const files = candidate.files
    .filter(isRecord)
    .slice(0, 64)
    .map((file) => ({
      path: typeof file.path === "string" ? file.path : "",
      kind: file.kind === "directory" ? "directory" as const : "file" as const,
      ...(typeof file.beforeHash === "string" ? { beforeHash: file.beforeHash } : {}),
      afterHash: typeof file.afterHash === "string" ? file.afterHash : "",
      diff: typeof file.diff === "string" ? file.diff.slice(0, 24_000) : "",
      additions: isNonNegativeInteger(file.additions) ? file.additions : 0,
      deletions: isNonNegativeInteger(file.deletions) ? file.deletions : 0,
      beforeExists: file.beforeExists === true,
      afterExists: file.afterExists !== false,
    }));
  if (
    files.length === 0 ||
    files.some((file) =>
      file.path.length === 0 ||
      file.afterHash.length === 0 ||
      !isNonNegativeInteger(file.additions) ||
      !isNonNegativeInteger(file.deletions)
    )
  ) {
    return undefined;
  }
  return {
    changeSetId: candidate.changeSetId,
    files,
    additions: candidate.additions,
    deletions: candidate.deletions,
    createdAt: typeof candidate.createdAt === "string"
      ? candidate.createdAt
      : new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createToolFailureKey(name: string, input: unknown, error: string): string {
  return `${name}\u0000${stableSerialize(input)}\u0000${error}`;
}

function isReadOnlyToolCall(
  call: ToolCall,
  metadata: AgentToolMetadata | undefined,
): boolean {
  if (call.name === "filesystem") {
    const action = readToolAction(call.input);
    return action === "read" ||
      action === "list" ||
      action === "stat" ||
      action === "preview";
  }
  if (call.name === "git") {
    return isReadOnlyGitCall(call.input);
  }
  return metadata?.risk === "read-only";
}

function readToolAction(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const action = (input as Record<string, unknown>).action;
  return typeof action === "string" ? action : undefined;
}

function isReadOnlyGitCall(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const args = (input as Record<string, unknown>).args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    return false;
  }
  const [command, option] = args as string[];
  if (
    command === "status" ||
    command === "diff" ||
    command === "log" ||
    command === "show" ||
    command === "rev-parse" ||
    command === "ls-files" ||
    command === "ls-tree" ||
    command === "cat-file" ||
    command === "describe"
  ) {
    return !args.some((arg) =>
      arg === "--ext-diff" ||
      arg === "--output" ||
      arg.startsWith("--output="),
    );
  }
  if (command === "branch") {
    return !args.some((arg) =>
      arg === "-d" ||
      arg === "-D" ||
      arg === "-m" ||
      arg === "-M" ||
      arg === "-c" ||
      arg === "-C" ||
      arg === "--delete" ||
      arg === "--move" ||
      arg === "--copy",
    );
  }
  if (command === "remote") {
    return option === "show" || option === "-v" || option === "--verbose";
  }
  if (command === "tag") {
    return option === "--list" || option === "-l";
  }
  return false;
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

function summarizeHookValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return summarizeHookText(JSON.stringify(value));
  } catch {
    return summarizeHookText(String(value));
  }
}

function summarizeHookText(value: string): string {
  const redacted = value.replace(
    /(["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*)(["'][^"']+["']|[^\s,}]+)/gi,
    "$1[redacted]",
  );
  return redacted.length <= 256 ? redacted : `${redacted.slice(0, 253)}...`;
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
