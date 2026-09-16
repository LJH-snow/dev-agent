/**
 * Retry support shared by every model provider.
 *
 * The wrapper only covers the initial HTTP request (fetch plus the status
 * check), never a partially consumed stream: retrying after tokens were handed
 * to the caller would duplicate output.
 */

export interface RetryOptions {
  /** Number of retries after the first attempt. Defaults to 2. */
  readonly retries?: number;
  /** Base delay for the exponential backoff. Defaults to 250ms. */
  readonly baseDelayMs?: number;
  /** Upper bound for a single delay, including `Retry-After`. Defaults to 2000ms. */
  readonly maxDelayMs?: number;
  readonly signal?: AbortSignal;
  readonly onRetry?: (info: RetryInfo) => void;
  /** Injectable sleep, used by tests to avoid real waiting. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable jitter source, used by tests to make delays deterministic. */
  readonly random?: () => number;
}

export interface RetryInfo {
  /** 1-based number of the attempt that just failed. */
  readonly attempt: number;
  readonly delayMs: number;
  readonly reason: string;
}

/** An HTTP response the provider refused to use, carrying its status. */
export class ModelRequestError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { readonly status: number; readonly retryAfterMs?: number }) {
    super(message);
    this.name = "ModelRequestError";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 2000;
const MAX_ERROR_BODY_CHARS = 2000;

const SENSITIVE_KEY_PATTERN =
  /((?:["']?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*)(["']))[^"'\\]*(?:\\.[^"'\\]*)*\2/gi;
const SENSITIVE_UNQUOTED_KEY_PATTERN =
  /((?:["']?(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|password|passphrase|secret|token|private[-_ ]?key)["']?\s*[:=]\s*))(?!["'])([^"'\s,}\]]+)/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]+ PRIVATE KEY-----/g;
const TOKEN_SHAPE_PATTERN =
  /\b(?:sk|pk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/gi;

/**
 * Runs `operation` until it succeeds, the retry budget is exhausted, or the
 * error is not retryable.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const hasBudget = attempt <= retries;
      if (!hasBudget || !isRetryable(error) || options.signal?.aborted) {
        throw error;
      }
      const delayMs = retryDelayMs(error, attempt, { baseDelayMs, maxDelayMs, random });
      options.onRetry?.({
        attempt,
        delayMs,
        reason: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs, options.signal);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new Error("retry loop exhausted without a result");
}

/**
 * Performs one HTTP request, retrying rate limits, server errors, and network
 * failures. Non-OK responses become `ModelRequestError`s carrying the status
 * and any `Retry-After` hint.
 */
export async function requestWithRetry(
  label: string,
  perform: () => Promise<Response>,
  options: RetryOptions = {}
): Promise<Response> {
  return withRetry(async () => {
    const response = await perform();
    if (!response.ok) {
      const body = summarizeErrorBody(await response.text().catch(() => ""));
      const detail = body ? `: ${body}` : "";
      throw new ModelRequestError(`${label} failed (${response.status})${detail}`, {
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      });
    }
    return response;
  }, options);
}

/**
 * Provider error responses are untrusted input. Keep enough detail to debug
 * normal API failures, but do not copy credentials or unbounded response
 * bodies into agent memory, CLI JSON, or Desktop error events.
 */
function summarizeErrorBody(value: string): string {
  const redacted = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(SENSITIVE_KEY_PATTERN, "$1$2[redacted]$2")
    .replace(SENSITIVE_UNQUOTED_KEY_PATTERN, "$1[redacted]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(TOKEN_SHAPE_PATTERN, "[redacted-token]")
    .trim();

  if (redacted.length <= MAX_ERROR_BODY_CHARS) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_ERROR_BODY_CHARS)}…`;
}

/** 429 and 5xx are worth retrying; other 4xx are not. Network errors are retried. */
export function isRetryable(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }
  if (error instanceof ModelRequestError) {
    return error.status === 429 || error.status >= 500;
  }
  return isNetworkError(error);
}

/** Parses a `Retry-After` header in either delta-seconds or HTTP-date form. */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now()
): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - now);
  }

  return undefined;
}

function retryDelayMs(
  error: unknown,
  attempt: number,
  config: {
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly random: () => number;
  }
): number {
  const hinted = error instanceof ModelRequestError ? error.retryAfterMs : undefined;
  if (hinted !== undefined) {
    return Math.min(config.maxDelayMs, hinted);
  }

  const exponential = config.baseDelayMs * 2 ** (attempt - 1);
  const jitter = 0.5 + config.random() * 0.5;
  return Math.min(config.maxDelayMs, Math.round(exponential * jitter));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(
    error.message
  );
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("The operation was aborted");
}
