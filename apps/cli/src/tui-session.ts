export type TuiRunState =
  | "ready"
  | "thinking"
  | "streaming"
  | "tool-running"
  | "waiting-approval"
  | "validating"
  | "done"
  | "error"
  | "interrupted";

export type CardStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "approval"
  | "validation"
  | "passed"
  | "blocked";

export interface ToolCard {
  readonly id: string;
  readonly kind: "tool" | "approval" | "validation";
  readonly name: string;
  readonly status: CardStatus;
  readonly input?: string;
  readonly output?: string;
  readonly diff?: string;
  readonly detail?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

export interface UsageSummary {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface TuiStateSnapshot {
  readonly state: TuiRunState;
  readonly cards: readonly ToolCard[];
  readonly usage?: UsageSummary;
  readonly error?: string;
}

export type TuiSessionEvent =
  | { readonly type: "turn-start" }
  | { readonly type: "assistant-token"; readonly text: string }
  | { readonly type: "tool-start"; readonly name: string; readonly input?: string }
  | { readonly type: "tool-progress"; readonly id: string; readonly detail?: string }
  | { readonly type: "tool-finish"; readonly id: string; readonly output?: string }
  | { readonly type: "tool-error"; readonly id: string; readonly error: string }
  | { readonly type: "tool-cancel"; readonly id: string; readonly reason?: string }
  | {
      readonly type: "approval-request";
      readonly tool: string;
      readonly detail?: string;
      readonly id?: string;
    }
  | {
      readonly type: "approval-resolved";
      readonly decision: string;
      readonly id?: string;
    }
  | {
      readonly type: "validation-start";
      readonly detail?: string;
      readonly id?: string;
    }
  | {
      readonly type: "validation-result";
      readonly status: "passed" | "failed" | "blocked";
      readonly detail?: string;
      readonly id?: string;
    }
  | { readonly type: "turn-complete"; readonly usage?: UsageSummary }
  | { readonly type: "turn-done" }
  | { readonly type: "turn-error"; readonly message: string }
  | { readonly type: "turn-interrupted"; readonly reason?: string }
  | { readonly type: "ready" };

function now(): number {
  return Date.now();
}

function isTerminalState(state: TuiRunState): boolean {
  return state === "done" || state === "error" || state === "interrupted";
}

export class TuiSessionModel {
  private state: TuiRunState = "ready";
  private cards: ToolCard[] = [];
  private usage: UsageSummary | undefined;
  private error: string | undefined;
  private closed = false;
  private sequence = 0;

  dispatch(
    event: Extract<
      TuiSessionEvent,
      { readonly type: "tool-start" | "approval-request" | "validation-start" }
    >
  ): string;
  dispatch(
    event: Exclude<
      TuiSessionEvent,
      { readonly type: "tool-start" | "approval-request" | "validation-start" }
    >
  ): void;
  dispatch(event: TuiSessionEvent): string | void {
    switch (event.type) {
      case "turn-start":
        this.state = "thinking";
        this.error = undefined;
        this.closed = false;
        return;
      case "assistant-token":
        if (this.closed || !event.text) return;
        this.state = "streaming";
        return;
      case "tool-start": {
        if (this.closed) return;
        const id = `tool-${++this.sequence}`;
        this.cards.push({
          id,
          kind: "tool",
          name: event.name,
          status: "running",
          ...(event.input === undefined ? {} : { input: event.input }),
          startedAt: now(),
        });
        this.state = "tool-running";
        return id;
      }
      case "tool-progress":
        if (this.closed) return;
        this.updateCard(event.id, (card) => ({
          ...card,
          detail: event.detail,
        }));
        return;
      case "tool-finish":
        if (this.closed) return;
        this.updateCard(event.id, (card) => ({
          ...card,
          status: "completed",
          ...(event.output === undefined ? {} : { output: event.output }),
          finishedAt: now(),
        }));
        this.state = "streaming";
        return;
      case "tool-error":
        if (this.closed) return;
        this.updateCard(event.id, (card) => ({
          ...card,
          status: "failed",
          detail: event.error,
          finishedAt: now(),
        }));
        this.state = "streaming";
        return;
      case "tool-cancel":
        if (this.closed) return;
        this.updateCard(event.id, (card) => ({
          ...card,
          status: "cancelled",
          ...(event.reason === undefined ? {} : { detail: event.reason }),
          finishedAt: now(),
        }));
        this.state = "interrupted";
        this.closed = true;
        return;
      case "approval-request": {
        if (this.closed) return;
        const id = event.id ?? `approval-${++this.sequence}`;
        this.cards.push({
          id,
          kind: "approval",
          name: event.tool,
          status: "approval",
          ...(event.detail === undefined ? {} : { detail: event.detail }),
          startedAt: now(),
        });
        this.state = "waiting-approval";
        return id;
      }
      case "approval-resolved": {
        if (this.closed) return;
        const card = this.findLatestCard("approval");
        if (card) {
          this.updateCard(card.id, (current) => ({
            ...current,
            status: event.decision.toLowerCase().startsWith("allow")
              ? "completed"
              : "failed",
            detail: event.decision,
            finishedAt: now(),
          }));
        }
        this.state = "thinking";
        return;
      }
      case "validation-start": {
        if (this.closed) return;
        const id = event.id ?? `validation-${++this.sequence}`;
        this.cards.push({
          id,
          kind: "validation",
          name: "validation",
          status: "validation",
          ...(event.detail === undefined ? {} : { detail: event.detail }),
          startedAt: now(),
        });
        this.state = "validating";
        return id;
      }
      case "validation-result": {
        if (this.closed) return;
        const card = event.id === undefined
          ? this.findLatestCard("validation")
          : this.cards.find((candidate) => candidate.id === event.id);
        if (card) {
          this.updateCard(card.id, (current) => ({
            ...current,
            status: event.status,
            ...(event.detail === undefined ? {} : { detail: event.detail }),
            finishedAt: now(),
          }));
        }
        this.state = "streaming";
        return;
      }
      case "turn-complete":
        if (this.closed) return;
        this.usage = event.usage;
        this.state = "ready";
        this.closed = true;
        return;
      case "turn-done":
        if (this.closed) return;
        this.state = "done";
        this.closed = true;
        return;
      case "turn-error":
        if (this.closed) return;
        this.state = "error";
        this.error = event.message;
        this.closed = true;
        return;
      case "turn-interrupted":
        if (this.closed) return;
        this.cards = this.cards.map((card) => (
          card.status === "running" || card.status === "approval" || card.status === "validation"
            ? { ...card, status: "cancelled", finishedAt: now() }
            : card
        ));
        this.state = "interrupted";
        this.error = event.reason;
        this.closed = true;
        return;
      case "ready":
        this.state = "ready";
        this.error = undefined;
        this.closed = false;
        return;
    }
  }

  snapshot(): TuiStateSnapshot {
    return {
      state: this.state,
      cards: this.cards.map((card) => ({ ...card })),
      ...(this.usage === undefined ? {} : { usage: this.usage }),
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  private findLatestCard(kind: ToolCard["kind"]): ToolCard | undefined {
    return [...this.cards].reverse().find((card) => card.kind === kind);
  }

  private updateCard(id: string, update: (card: ToolCard) => ToolCard): void {
    const index = this.cards.findIndex((card) => card.id === id);
    const card = this.cards[index];
    if (index < 0 || card === undefined) return;
    this.cards[index] = update(card);
  }
}

export { renderToolCard } from "./tui-renderer.js";
