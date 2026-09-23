import { randomUUID } from "node:crypto";

import type { ModelProvider } from "@dev-agent/model";
import { AgentLoop } from "./loop.js";
import type { AgentLoopBudget } from "./budget.js";
import { createAgentContext } from "./context.js";
import { InMemoryMemory, type AgentMemory } from "./memory.js";
import type { ToolCollection } from "./tools.js";

const DEFAULT_MAX_PARALLEL = 3;
const MAX_PARALLEL = 8;
const MAX_ROLE_TEXT_CHARS = 12_000;
const MAX_SYNTHESIS_CHARS = 40_000;

export interface CollaborationRole {
  readonly id: string;
  readonly instructions: string;
  /** Trusted caller-owned model override for this named role. */
  readonly model?: ModelProvider;
  /** Trusted caller-owned tool subset; planner-generated fields cannot set it. */
  readonly tools?: ToolCollection;
  readonly budget?: AgentLoopBudget;
}

export interface CollaborationRoleResult {
  readonly id: string;
  readonly status: "done" | "error";
  readonly text: string;
  readonly durationMs: number;
  readonly error?: string;
}

export interface CollaborationRoleEvent {
  readonly roleId: string;
  readonly phase: "started" | "completed" | "failed";
  readonly result?: CollaborationRoleResult;
}

export interface CollaborativePlanOptions {
  readonly model: ModelProvider;
  readonly tools?: ToolCollection;
  readonly workingDirectory: string;
  readonly sessionId: string;
  readonly roles?: readonly CollaborationRole[];
  readonly maxParallel?: number;
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
  readonly attachedContext?: string;
  readonly createMemory?: (role: CollaborationRole) => AgentMemory;
  readonly onRoleEvent?: (event: CollaborationRoleEvent) => void;
}

export interface CollaborativePlanResult {
  readonly prompt: string;
  readonly roles: readonly CollaborationRoleResult[];
  readonly synthesis: string;
}

export const DEFAULT_COLLABORATION_ROLES: readonly CollaborationRole[] = [
  {
    id: "architect",
    instructions:
      "Decompose the request into a concrete implementation plan. Identify affected files, interfaces, and sequencing.",
  },
  {
    id: "reviewer",
    instructions:
      "Review the request for correctness, compatibility, security, and failure modes. Call out assumptions and risks.",
  },
  {
    id: "tester",
    instructions:
      "Design focused verification for the request. Cover regression tests, manual checks, and important edge cases.",
  },
];

export async function runCollaborativePlan(
  prompt: string,
  options: CollaborativePlanOptions,
): Promise<CollaborativePlanResult> {
  const roles = options.roles?.length ? options.roles : DEFAULT_COLLABORATION_ROLES;
  const maxParallel = normalizeParallel(options.maxParallel);
  const results: CollaborationRoleResult[] = new Array(roles.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      throwIfAborted(options.signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= roles.length) return;
      const role = roles[index]!;
      const startedAt = Date.now();
      options.onRoleEvent?.({ roleId: role.id, phase: "started" });
      try {
        const memory = options.createMemory?.(role) ?? new InMemoryMemory();
        const loop = new AgentLoop({
          model: role.model ?? options.model,
          tools: role.tools ?? options.tools,
          maxTurns: role.budget?.maxTurns ?? options.maxTurns ?? 4,
          ...(role.budget === undefined ? {} : { budget: role.budget }),
        });
        const context = createAgentContext(
          `${options.sessionId}-${safeId(role.id)}-${randomUUID().slice(0, 8)}`,
          memory,
          {
            sessionId: options.sessionId,
            workingDirectory: options.workingDirectory,
          },
        );
        const result = await loop.run(context, prompt, {
          mode: "plan",
          signal: options.signal,
          attachedContext: [
            `COLLABORATION ROLE: ${role.id}`,
            role.instructions,
            "Return concise, source-grounded findings for a lead agent.",
            ...(options.attachedContext?.trim()
              ? ["Additional request context:", options.attachedContext.trim()]
              : []),
          ].join("\n"),
        });
        const text = await latestAssistantText(memory);
        const roleResult: CollaborationRoleResult = result.state.status === "error"
          ? {
              id: role.id,
              status: "error",
              text,
              durationMs: Math.max(0, Date.now() - startedAt),
              error: result.state.lastError ?? "role failed",
            }
          : {
              id: role.id,
              status: "done",
              text,
              durationMs: Math.max(0, Date.now() - startedAt),
            };
        results[index] = roleResult;
        options.onRoleEvent?.({
          roleId: role.id,
          phase: roleResult.status === "done" ? "completed" : "failed",
          result: roleResult,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const roleResult: CollaborationRoleResult = {
          id: role.id,
          status: "error",
          text: "",
          durationMs: Math.max(0, Date.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        };
        results[index] = roleResult;
        options.onRoleEvent?.({ roleId: role.id, phase: "failed", result: roleResult });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(maxParallel, roles.length) }, () => worker()));
  throwIfAborted(options.signal);

  const evidence = results
    .map((result) => {
      const details = result.error
        ? `status=error\nerror=${result.error}`
        : `status=${result.status}\nfindings=${result.text}`;
      return `### ${result.id}\n${details}`;
    })
    .join("\n\n")
    .slice(0, MAX_SYNTHESIS_CHARS);
  const synthesis = await options.model.chat(
    [
      {
        role: "system",
        content:
          "COLLABORATION SYNTHESIS\nYou are the lead agent. Combine specialist findings into one actionable implementation plan. " +
          "Keep role disagreements explicit, do not invent evidence, and separate implementation steps from verification.",
      },
      {
        role: "user",
        content: `Original request:\n${prompt}\n\nSpecialist findings:\n${evidence}`,
      },
    ],
    { signal: options.signal },
  );

  return {
    prompt,
    roles: results,
    synthesis: synthesis.content.slice(0, MAX_ROLE_TEXT_CHARS),
  };
}

async function latestAssistantText(memory: AgentMemory): Promise<string> {
  const entries = await memory.entries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.role === "assistant" &&
      entry.content.trim() !== "" &&
      !entry.content.trimStart().startsWith("[error]")
    ) {
      return entry.content.slice(0, MAX_ROLE_TEXT_CHARS);
    }
  }
  return "";
}

function normalizeParallel(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_PARALLEL;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("maxParallel must be a positive integer");
  }
  return Math.min(value, MAX_PARALLEL);
}

function safeId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return id === "" ? "role" : id.slice(0, 48);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Collaborative planning was interrupted.");
  }
}
