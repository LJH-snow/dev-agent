import { createAgentState } from "./agent-state.js";
import type { AgentState } from "./agent-state.js";
import type { AgentMemory } from "./memory.js";

export interface AgentContext {
  readonly state: AgentState;
  readonly memory: AgentMemory;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface AgentContextOptions {
  readonly sessionId?: string;
  readonly workingDirectory?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export function createAgentContext(
  id: string,
  memory: AgentMemory,
  options: AgentContextOptions = {}
): AgentContext {
  const now = new Date().toISOString();
  return {
    state: createAgentState(id),
    memory,
    sessionId: options.sessionId ?? id,
    workingDirectory: options.workingDirectory ?? process.cwd(),
    createdAt: now,
    updatedAt: now,
    metadata: options.metadata ?? {},
  };
}
