export type AgentStatus = "idle" | "running" | "done" | "error";

export interface AgentState {
  readonly id: string;
  readonly status: AgentStatus;
  readonly turns: number;
  readonly currentTask?: string;
  readonly lastError?: string;
}

export function createAgentState(id: string): AgentState {
  return { id, status: "idle", turns: 0 };
}
