import { Buffer } from "node:buffer";

export const MAX_STREAM_OUTPUT_BYTES = 16 * 1024 * 1024;

export class StreamOutputLimitError extends Error {
  readonly code: "stream_output_limit" = "stream_output_limit";

  constructor(
    readonly limitBytes: number,
    readonly observedBytes: number
  ) {
    super(`stream output exceeded the ${limitBytes / (1024 * 1024)} MiB limit`);
    this.name = "StreamOutputLimitError";
  }
}

export class StreamOutputBudget {
  constructor(readonly limitBytes = MAX_STREAM_OUTPUT_BYTES) {}

  private observedBytes = 0;

  addText(value: string): void {
    this.addBytes(Buffer.byteLength(value, "utf8"));
  }

  addJson(value: unknown): void {
    const serialized = JSON.stringify(value);
    this.addBytes(Buffer.byteLength(serialized ?? "", "utf8"));
  }

  private addBytes(bytes: number): void {
    const observedBytes = this.observedBytes + bytes;
    if (observedBytes > this.limitBytes) {
      throw new StreamOutputLimitError(this.limitBytes, observedBytes);
    }
    this.observedBytes = observedBytes;
  }
}
