import { renderAssistantMessage } from "./tui-renderer.js";

type Schedule = (callback: () => void, delayMs: number) => unknown;
type CancelSchedule = (handle: unknown) => void;

export interface LiveAssistantRendererOptions {
  label?: string;
  width?: number;
  /** Delay between coalesced live repaints. Set to 0 to repaint immediately. */
  throttleMs?: number;
  /** Injectable timer hooks keep throttling deterministic in tests. */
  schedule?: Schedule;
  cancelSchedule?: CancelSchedule;
}

/**
 * Repaints the current assistant answer in place while tokens arrive.
 *
 * This deliberately keeps terminal control local to the rich TTY path. The
 * line-oriented CLI never instantiates this class, so pipes and JSON output
 * remain byte-for-byte compatible with the existing interface.
 */
export class LiveAssistantRenderer {
  private readonly label: string;
  private readonly width?: number;
  private readonly throttleMs: number;
  private readonly schedule: Schedule;
  private readonly cancelSchedule: CancelSchedule;
  private text = "";
  private renderedText = "";
  private renderedLineCount = 0;
  private active = false;
  private flushScheduled = false;
  private scheduledHandle: unknown;
  private scheduledToken = 0;
  private nextScheduleToken = 0;

  constructor(
    private readonly write: (chunk: string) => void,
    options: LiveAssistantRendererOptions = {}
  ) {
    this.label = options.label ?? "Assistant";
    this.width = options.width;
    this.throttleMs = normalizeThrottle(options.throttleMs);
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  append(token: string): void {
    if (token.length === 0) return;
    this.text += token;

    if (!this.active || this.throttleMs === 0) {
      this.repaint();
      return;
    }

    this.scheduleRepaint();
  }

  /** Finish the current block and return the text that was rendered. */
  finish(): string {
    const content = this.text;
    this.cancelPendingRepaint();

    if (content.length > 0 && (!this.active || this.renderedText !== content)) {
      this.repaint();
    }
    if (this.active) {
      this.write("\n");
    }

    this.text = "";
    this.renderedText = "";
    this.renderedLineCount = 0;
    this.active = false;
    return content;
  }

  isActive(): boolean {
    return this.active;
  }

  private scheduleRepaint(): void {
    if (this.flushScheduled) return;

    const token = ++this.nextScheduleToken;
    this.flushScheduled = true;
    this.scheduledToken = token;
    const flush = (): void => {
      if (!this.flushScheduled || this.scheduledToken !== token) return;
      this.flushScheduled = false;
      this.scheduledToken = 0;
      this.scheduledHandle = undefined;
      this.repaint();
    };

    try {
      const handle = this.schedule(flush, this.throttleMs);
      // A test scheduler (or an unusual host scheduler) may invoke the
      // callback synchronously before returning its handle. Do not retain a
      // stale handle after that callback has already completed.
      if (this.flushScheduled && this.scheduledToken === token) {
        this.scheduledHandle = handle;
      }
    } catch (error) {
      if (this.scheduledToken === token) {
        this.flushScheduled = false;
        this.scheduledToken = 0;
        this.scheduledHandle = undefined;
      }
      throw error;
    }
  }

  private cancelPendingRepaint(): void {
    if (!this.flushScheduled) return;

    const handle = this.scheduledHandle;
    this.flushScheduled = false;
    this.scheduledToken = 0;
    this.scheduledHandle = undefined;
    this.cancelSchedule(handle);
  }

  private repaint(): void {
    const rendered = renderAssistantMessage(this.text, {
      label: this.label,
      width: this.width,
    });
    const lines = rendered.split("\n");

    if (this.renderedLineCount > 0) {
      this.write(clearRenderedBlock(this.renderedLineCount));
    }
    this.write(`${rendered}\n`);
    this.renderedText = this.text;
    this.renderedLineCount = lines.length;
    this.active = true;
  }
}

function normalizeThrottle(throttleMs: number | undefined): number {
  if (throttleMs === undefined || !Number.isFinite(throttleMs)) return 24;
  return Math.max(0, throttleMs);
}

function clearRenderedBlock(lineCount: number): string {
  if (lineCount <= 0) return "";

  const chunks = [`\u001b[${lineCount}A`];
  for (let index = 0; index < lineCount; index += 1) {
    chunks.push("\u001b[2K\r");
    if (index < lineCount - 1) {
      chunks.push("\n");
    }
  }
  if (lineCount > 1) {
    chunks.push(`\u001b[${lineCount - 1}A`);
  }
  return chunks.join("");
}
