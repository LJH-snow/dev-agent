import type { InkThemeName } from "./ink/theme.js";

export interface InkPromptItem {
  readonly value: string;
  readonly queued: boolean;
}

export interface InkUiSnapshot {
  readonly busy: boolean;
  readonly queuedPrompts: readonly string[];
  readonly theme: InkThemeName;
  readonly sessionId?: string;
  readonly approvalPrompt?: string;
  readonly textPrompt?: string;
}

type PromptWaiter = (item: InkPromptItem | null) => void;

/**
 * Small controller shared by the Ink composer and the interactive runner.
 * Input is always accepted by the composer; the runner decides when a queued
 * item is consumed, which keeps the active model request isolated from later
 * prompts.
 */
export class InkUiController {
  private readonly queued: string[] = [];
  private waiter: PromptWaiter | undefined;
  private approvalWaiter: ((value: string) => void) | undefined;
  private textWaiter: ((value: string) => void) | undefined;
  private busy = false;
  private approvalPrompt: string | undefined;
  private textPrompt: string | undefined;
  private snapshotValue: InkUiSnapshot = {
    busy: false,
    queuedPrompts: [],
    theme: "signal",
  };
  private readonly listeners = new Set<() => void>();

  nextPrompt(): Promise<InkPromptItem | null> {
    const queued = this.queued.shift();
    if (queued !== undefined) {
      this.notify();
      return Promise.resolve({ value: queued, queued: true });
    }
    return new Promise<InkPromptItem | null>((resolve) => {
      this.waiter = resolve;
      this.notify();
    });
  }

  submit(value: string): void {
    if (this.approvalWaiter) {
      const resolve = this.approvalWaiter;
      this.approvalWaiter = undefined;
      this.approvalPrompt = undefined;
      resolve(value);
      this.notify();
      return;
    }
    if (this.textWaiter) {
      const resolve = this.textWaiter;
      this.textWaiter = undefined;
      this.textPrompt = undefined;
      resolve(value);
      this.notify();
      return;
    }

    const waiter = this.waiter;
    if (waiter) {
      this.waiter = undefined;
      waiter({ value, queued: false });
      this.notify();
      return;
    }

    this.queued.push(value);
    this.notify();
  }

  askApproval(prompt: string, signal?: AbortSignal): Promise<string> {
    if (this.approvalWaiter || this.textWaiter) {
      throw new Error("an approval request is already waiting");
    }
    this.approvalPrompt = prompt;
    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = (value: string): void => {
        if (settled) return;
        settled = true;
        if (this.approvalWaiter === finish) this.approvalWaiter = undefined;
        this.approvalPrompt = undefined;
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
        this.notify();
      };
      const onAbort = (): void => finish("");
      this.approvalWaiter = finish;
      signal?.addEventListener("abort", onAbort, { once: true });
      this.notify();
      if (signal?.aborted) onAbort();
    });
  }

  askText(prompt: string, signal?: AbortSignal): Promise<string> {
    if (this.approvalWaiter || this.textWaiter) {
      throw new Error("an input request is already waiting");
    }
    if (signal?.aborted) return Promise.resolve("");
    this.textPrompt = prompt;
    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = (value: string): void => {
        if (settled) return;
        settled = true;
        if (this.textWaiter === finish) this.textWaiter = undefined;
        this.textPrompt = undefined;
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
        this.notify();
      };
      const onAbort = (): void => finish("");
      this.textWaiter = finish;
      signal?.addEventListener("abort", onAbort, { once: true });
      this.notify();
      if (signal?.aborted) onAbort();
    });
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.notify();
  }

  setTheme(theme: InkThemeName): void {
    this.snapshotValue = {
      ...this.snapshotValue,
      theme,
    };
    this.notify();
  }

  setSessionId(sessionId: string): void {
    this.snapshotValue = {
      ...this.snapshotValue,
      sessionId,
    };
    this.notify();
  }

  close(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.(null);
    const approvalWaiter = this.approvalWaiter;
    this.approvalWaiter = undefined;
    this.approvalPrompt = undefined;
    approvalWaiter?.("");
    const textWaiter = this.textWaiter;
    this.textWaiter = undefined;
    this.textPrompt = undefined;
    textWaiter?.("");
    this.queued.length = 0;
    this.notify();
  }

  snapshot = (): InkUiSnapshot => {
    return this.snapshotValue;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    this.snapshotValue = {
      busy: this.busy,
      queuedPrompts: [...this.queued],
      theme: this.snapshotValue.theme,
      ...(this.snapshotValue.sessionId === undefined
        ? {}
        : { sessionId: this.snapshotValue.sessionId }),
      ...(this.approvalPrompt === undefined ? {} : { approvalPrompt: this.approvalPrompt }),
      ...(this.textPrompt === undefined ? {} : { textPrompt: this.textPrompt }),
    };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
