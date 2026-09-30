import type { ChatCompletion, ChatMessage, ChatOptions, ChatStreamOptions, ModelProvider, ModelSpeedMode } from "@dev-agent/model";
import { ModelSpeedModeController } from "@dev-agent/model";
import type { SessionModelBudget } from "./model-budget.js";

export type ModelRouteReason = "greeting" | "standard" | "complex" | "large-request" | "manual";
export interface ModelRouteDecision { readonly mode: ModelSpeedMode; readonly reason: ModelRouteReason; }
export type ModelRoutingPolicy = "auto" | "manual";
export interface ModelRoutingConfig {
  readonly mode?: ModelRoutingPolicy;
  readonly profiles: Readonly<Partial<Record<ModelSpeedMode, string>>>;
  readonly budget: { readonly maxTokens?: number; readonly maxCostUsd?: number; readonly maxDurationMs?: number };
}

const GREETING = /^(?:hi|hello|hey|howdy|good\s+(?:morning|afternoon|evening)|你好|您好|嗨|哈喽|早上好|早安|下午好|晚上好|晚安)[\s,!.?。！？~～]*$/iu;
const COMPLEX = /\b(refactor|rewrite|migration|migrate|architecture|security|concurrency|concurrent|race\s+condition|deadlock|debug|diagnos|failing\s+tests?|regression|multi[- ]?file|redesign|performance|benchmark|dependency|upgrade)\b|重构|迁移|架构|安全|并发|竞态|死锁|调试|诊断|失败测试|回归|多文件|重设计|性能|依赖|升级/iu;

export function classifyPromptRoute(prompt: string): ModelRouteDecision {
  const normalized = prompt.normalize("NFKC").trim();
  if (GREETING.test(normalized)) return { mode: "fast", reason: "greeting" };
  if (normalized.length > 16_384) return { mode: "deep", reason: "large-request" };
  if (COMPLEX.test(normalized)) return { mode: "deep", reason: "complex" };
  return { mode: "balanced", reason: "standard" };
}

export class ModelRoutingController {
  private policy: ModelRoutingPolicy = "auto";
  private manualMode: ModelSpeedMode;
  constructor(private readonly speed: ModelSpeedModeController = new ModelSpeedModeController()) {
    this.manualMode = speed.mode;
  }
  get mode(): ModelRoutingPolicy { return this.policy; }
  get currentMode(): ModelSpeedMode { return this.speed.mode; }
  setAutoMode(): void { this.policy = "auto"; }
  setManualMode(mode: ModelSpeedMode): void { this.policy = "manual"; this.manualMode = mode; this.speed.setMode(mode); }
  select(prompt: string): ModelRouteDecision {
    if (this.policy === "manual") return { mode: this.manualMode, reason: "manual" };
    const decision = classifyPromptRoute(prompt);
    this.speed.setMode(decision.mode);
    return decision;
  }
  describe(): string { return `Routing: ${this.policy} · mode=${this.speed.mode}`; }
}

export interface AdaptiveModelProviderOptions {
  readonly controller: ModelRoutingController;
  readonly initial: ModelProvider;
  readonly getProvider: (mode: ModelSpeedMode, policy: ModelRoutingPolicy, previous: ModelProvider) => ModelProvider;
}

/** Selects a speed tier from the last user message without persisting prompt text. */
export class AdaptiveModelProvider implements ModelProvider {
  private active: ModelProvider;
  constructor(private readonly options: AdaptiveModelProviderOptions) { this.active = options.initial; }
  get id() { return this.active.id; }
  get model() { return this.active.model; }
  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<ChatCompletion> {
    return this.invoke("chat", messages, options);
  }
  streamChat(messages: readonly ChatMessage[], options?: ChatStreamOptions): Promise<ChatCompletion> {
    return this.invoke("streamChat", messages, options);
  }
  private invoke(method: "chat" | "streamChat", messages: readonly ChatMessage[], options?: ChatOptions | ChatStreamOptions): Promise<ChatCompletion> {
    const prompt = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const decision = this.options.controller.select(prompt);
    this.active = this.options.getProvider(decision.mode, this.options.controller.mode, this.active);
    if (method === "streamChat" && typeof this.active.streamChat === "function") return this.active.streamChat(messages, options);
    return this.active.chat(messages, options);
  }
}

export function resolveModelRoutingConfig(input: unknown): ModelRoutingConfig {
  const raw = isRecord(input) && isRecord(input.routing) ? input.routing : input;
  if (raw === undefined) return { profiles: {}, budget: {} };
  if (!isRecord(raw)) throw new Error("routing configuration must be an object");
  const mode = raw.mode === undefined ? undefined : raw.mode === "auto" || raw.mode === "manual" ? raw.mode : invalid("routing mode");
  const profiles: Partial<Record<ModelSpeedMode, string>> = {};
  if (raw.profiles !== undefined) {
    if (!isRecord(raw.profiles)) throw new Error("routing profiles must be an object");
    for (const tier of ["fast", "balanced", "deep"] as const) {
      const value = raw.profiles[tier];
      if (value !== undefined) { if (typeof value !== "string" || !value.trim() || value.length > 128) throw new Error("routing profile is invalid"); profiles[tier] = value.trim(); }
    }
    if (Object.keys(raw.profiles).some((key) => !["fast", "balanced", "deep"].includes(key))) throw new Error("routing profiles contain an unknown field");
  }
  const budget: ModelRoutingConfig["budget"] = {};
  if (raw.budget !== undefined) {
    if (!isRecord(raw.budget)) throw new Error("routing budget must be an object");
    for (const key of ["maxTokens", "maxDurationMs"] as const) {
      const value = raw.budget[key];
      if (value !== undefined) { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`routing budget ${key} is invalid`); (budget as Record<string, number>)[key] = value; }
    }
    const maxCostUsd = raw.budget.maxCostUsd;
    if (maxCostUsd !== undefined) { if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd < 0) throw new Error("routing budget maxCostUsd is invalid"); (budget as { maxCostUsd?: number }).maxCostUsd = maxCostUsd; }
    if (Object.keys(raw.budget).some((key) => !["maxTokens", "maxDurationMs", "maxCostUsd"].includes(key))) throw new Error("routing budget contains an unknown field");
  }
  return { ...(mode === undefined ? {} : { mode }), profiles, budget };
}

export function executeModelRoutingCommand(command: string, routing: ModelRoutingController, budget: SessionModelBudget): string | undefined {
  command = command.trim().replace(/^\//u, ":");
  if (command === ":route") return `${routing.describe()} · auto picks fast greetings, balanced normal work, deep complex work.`;
  if (command === ":route auto") { routing.setAutoMode(); return "Routing: auto enabled."; }
  if (command === ":route manual") { routing.setManualMode(routing.currentMode); return `Routing: manual · mode=${routing.currentMode}.`; }
  if (command.startsWith(":route ")) return "Usage: :route [auto|manual]";
  if (command === ":budget") { const snapshot = budget.snapshot(); return `Budget: tokens=${snapshot.tokens}${snapshot.limits.maxTokens === undefined ? "" : `/${snapshot.limits.maxTokens}`} cost=$${snapshot.estimatedCostUsd.toFixed(6)}${snapshot.limits.maxCostUsd === undefined ? "" : `/$${snapshot.limits.maxCostUsd}`} duration=${snapshot.durationMs}ms${snapshot.limits.maxDurationMs === undefined ? "" : `/${snapshot.limits.maxDurationMs}`} requests=${snapshot.requests}`; }
  if (!command.startsWith(":budget ")) return undefined;
  const parts = command.slice(":budget ".length).trim().split(/\s+/u);
  if (parts.length !== 2 || !["tokens", "cost", "duration"].includes(parts[0]!)) return "Usage: :budget <tokens|cost|duration> <value|off>";
  const key = parts[0] === "tokens" ? "maxTokens" : parts[0] === "cost" ? "maxCostUsd" : "maxDurationMs";
  if (parts[1] === "off") { budget.setLimit(key, undefined); return `Budget ${parts[0]}: unlimited.`; }
  const value = Number(parts[1]);
  if (!Number.isFinite(value) || value < 0 || ((key !== "maxCostUsd") && !Number.isSafeInteger(value))) return "Usage: :budget <tokens|cost|duration> <value|off>";
  budget.setLimit(key, value);
  return `Budget ${parts[0]}: ${value}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function invalid(label: string): never { throw new Error(`${label} is invalid`); }
