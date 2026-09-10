import type { AgentState } from "./agent-state.js";
import type { AgentContext } from "./context.js";
import { createMemoryEntry, type AgentMemory, type MemoryEntry } from "./memory.js";
import type { ChatMessage, ModelProvider, ToolSchema } from "@dev-agent/model";
import { runTool, type ToolCollection } from "./tools.js";

export interface AgentLoopOptions {
  readonly model: ModelProvider;
  readonly tools?: ToolCollection;
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly onTurn?: (turn: number, context: AgentContext) => void;
}

export class AgentLoop {
  private readonly model: ModelProvider;
  private readonly tools?: ToolCollection;
  private readonly systemPrompt?: string;
  private readonly maxTurns: number;
  private readonly onTurn?: (turn: number, context: AgentContext) => void;

  constructor(options: AgentLoopOptions) {
    if (options.maxTurns !== undefined && options.maxTurns < 1) {
      throw new Error("maxTurns must be at least 1");
    }
    this.model = options.model;
    this.tools = options.tools;
    this.systemPrompt = options.systemPrompt;
    this.maxTurns = options.maxTurns ?? 10;
    this.onTurn = options.onTurn;
  }

  async run(context: AgentContext, input: string): Promise<AgentContext> {
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

    try {
      for (let turn = 0; turn < this.maxTurns && !completed; turn += 1) {
        const messages = await this.buildMessages(memory, context);
        const completion = await this.model.chat(messages, {
          tools: this.buildToolSchemas(),
        });
        const toolCalls = completion.toolCalls ?? [];

        await memory.append(createMemoryEntry("assistant", completion.content, { toolCalls }));
        state = { ...state, turns: state.turns + 1 };
        this.onTurn?.(state.turns, context);

        for (const call of toolCalls) {
          if (!this.tools) {
            throw new Error(`Agent requested tool "${call.name}" but no tools are configured.`);
          }
          const result = await runTool(this.tools, call, context);
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
      return { ...context, state, updatedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await memory.append(createMemoryEntry("assistant", `[error] ${message}`));
      updatedAt = new Date().toISOString();
      return {
        ...context,
        state: { ...state, status: "error", lastError: message },
        updatedAt,
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
    for (const entry of entries) {
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

function toChatMessage(entry: MemoryEntry): ChatMessage {
  return {
    role: entry.role,
    content: entry.content,
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    toolCalls: entry.toolCalls,
  };
}
