import { Buffer } from "node:buffer";

export const MAX_STREAM_LINE_BYTES = 1024 * 1024; // 1 MiB

export async function assertBoundedLineBuffer(
  buffer: string,
  maxBytes: number,
  reader?: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  if (Buffer.byteLength(buffer, "utf8") <= maxBytes) return;
  if (reader) await reader.cancel().catch(() => undefined);
  throw new Error(
    `stream line exceeded the ${maxBytes / (1024 * 1024)} MiB limit`
  );
}
