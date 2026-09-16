/** Maximum payload size for a single newline-delimited MCP JSON frame. */
export const DEFAULT_MCP_MAX_FRAME_BYTES = 8 * 1024 * 1024;
/** JSON-RPC-ish code used when a frame cannot be accepted safely. */
export const MCP_FRAME_TOO_LARGE_CODE = -32002;

export class McpFrameTooLargeError extends Error {
  readonly code = MCP_FRAME_TOO_LARGE_CODE;
  readonly frameBytes: number;
  readonly maxFrameBytes: number;

  constructor(frameBytes: number, maxFrameBytes: number) {
    super(
      `MCP frame exceeds maximum of ${maxFrameBytes} bytes (received ${frameBytes} bytes)`
    );
    this.name = "McpFrameTooLargeError";
    this.frameBytes = frameBytes;
    this.maxFrameBytes = maxFrameBytes;
  }
}

export function resolveMaxFrameBytes(
  value: number | undefined,
  label = "maxFrameBytes"
): number {
  if (value === undefined) {
    return DEFAULT_MCP_MAX_FRAME_BYTES;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

export function frameByteLength(frame: string): number {
  return Buffer.byteLength(frame, "utf8");
}

export function assertFrameSize(frame: string, maxFrameBytes: number): void {
  const frameBytes = frameByteLength(frame);
  if (frameBytes > maxFrameBytes) {
    throw new McpFrameTooLargeError(frameBytes, maxFrameBytes);
  }
}
