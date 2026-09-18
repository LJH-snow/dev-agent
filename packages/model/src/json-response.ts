import { Buffer } from "node:buffer";

export async function readBoundedJsonResponse<T>(
  response: Response,
  maxBytes: number
): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("response has no readable body");

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`response exceeded the ${maxBytes / (1024 * 1024)} MiB limit`);
    }
    chunks.push(value);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
