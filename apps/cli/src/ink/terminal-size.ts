export interface InkTerminalSize {
  readonly columns: number;
  readonly rows: number;
}

export interface InkTerminalOutput {
  columns?: number;
  rows?: number;
  getWindowSize?: () => readonly [number, number];
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const INK_FULLSCREEN_ROW_GUARD = 1;

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

/**
 * Ink treats a zero row count as a full-screen terminal. Some PTY wrappers
 * expose zero dimensions briefly during process startup, so normalize them
 * before the first render and again whenever the terminal resizes.
 */
export function normalizeInkTerminalSize(
  output: InkTerminalOutput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): InkTerminalSize {
  let windowSize: readonly [number, number] | undefined;
  try {
    windowSize = output.getWindowSize?.();
  } catch {
    windowSize = undefined;
  }

  const columns =
    positiveInteger(output.columns) ??
    positiveInteger(windowSize?.[0]) ??
    positiveInteger(environment.COLUMNS) ??
    DEFAULT_COLUMNS;
  const rows =
    positiveInteger(output.rows) ??
    positiveInteger(windowSize?.[1]) ??
    positiveInteger(environment.LINES) ??
    DEFAULT_ROWS;

  if (positiveInteger(output.columns) === undefined) {
    output.columns = columns;
  }
  if (positiveInteger(output.rows) === undefined) {
    output.rows = rows;
  }

  return { columns, rows };
}

/**
 * Ink treats a frame whose height is equal to `stdout.rows` as fullscreen and
 * clears the terminal before repainting it. A one-row virtual guard prevents
 * that cleanup from destroying scrollback, while the app can keep laying out
 * against the real terminal height.
 */
export function createInkRenderOutput<T extends NodeJS.WriteStream>(
  output: T,
): T {
  return new Proxy(output, {
    get(target, property, receiver) {
      if (property === "rows") {
        const rows = Reflect.get(target, property, receiver);
        return positiveInteger(rows) === undefined
          ? rows
          : rows + INK_FULLSCREEN_ROW_GUARD;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
